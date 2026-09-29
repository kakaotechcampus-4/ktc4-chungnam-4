from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import DraftVersionConflict
from domains.documents.models import DocType, DraftDocument, DraftStatus
from domains.documents.schemas import DraftSaveInput
from domains.documents.service import save_draft


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})

    # pysqlite는 기본 설정으로 SAVEPOINT가 동작하지 않는다 — SQLAlchemy 문서의
    # 권장 설정으로 트랜잭션 시작을 직접 제어한다. save_draft()의 중복 INSERT
    # 처리가 savepoint에 기대므로 테스트에서도 실제로 동작해야 한다.
    @event.listens_for(engine, "connect")
    def _disable_pysqlite_begin(dbapi_connection, _record):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _emit_begin(conn):
        conn.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine, tables=[DraftDocument.__table__])
    return Session(engine)


def _input(**overrides) -> DraftSaveInput:
    values = {
        "child_id": uuid4(),
        "author_teacher_id": uuid4(),
        "doc_type": DocType.PARENT_NOTE,
        "record_date": date(2026, 9, 29),
        "content": "블록을 여러 층으로 쌓았어요.",
        "ai_version": 1,
    }
    values.update(overrides)
    return DraftSaveInput(**values)


def _saved(db: Session, **overrides) -> DraftDocument:
    draft = save_draft(db, _input(**overrides), expected_version=None)
    db.commit()
    return draft


def test_최초_저장은_DRAFT_상태_버전1로_남는다():
    db = _session()
    data = _input(ai_version=2)

    draft = save_draft(db, data, expected_version=None)
    db.commit()

    row = db.query(DraftDocument).one()
    assert row.id == draft.id
    assert row.status == DraftStatus.DRAFT.value
    assert row.version == 1
    assert row.ai_version == 2
    assert row.content == data.content
    assert row.author_teacher_id == data.author_teacher_id


def test_최초_저장에_draft_id를_넘기면_그_ID를_쓴다():
    db = _session()
    draft_id = uuid4()

    draft = save_draft(db, _input(draft_id=draft_id), expected_version=None)

    assert draft.id == draft_id


def test_같은_원아_종류_날짜로_다시_최초_저장하면_충돌이고_기존_문서를_유지한다():
    db = _session()
    first = _saved(db)

    with pytest.raises(DraftVersionConflict):
        save_draft(
            db,
            _input(child_id=first.child_id, content="덮어쓰려는 내용"),
            expected_version=None,
        )

    db.commit()
    row = db.query(DraftDocument).one()
    assert row.id == first.id
    assert row.content != "덮어쓰려는 내용"


def test_중복_최초_저장이_실패해도_호출자_트랜잭션의_다른_쓰기는_남는다():
    db = _session()
    first = _saved(db)
    other = save_draft(db, _input(doc_type=DocType.OBSERVATION_LOG), expected_version=None)

    with pytest.raises(DraftVersionConflict):
        save_draft(db, _input(child_id=first.child_id), expected_version=None)

    db.commit()
    assert db.get(DraftDocument, other.id) is not None


def test_호출자의_대기_중인_변경이_실패하면_문서_중복이_아니라_원래_오류를_올린다():
    db = _session()
    # 필수값이 빠진 호출자 쪽 변경 — save_draft 전에 flush되지 않은 상태
    db.add(
        DraftDocument(
            child_id=None,
            author_teacher_id=uuid4(),
            doc_type=DocType.PARENT_NOTE.value,
            record_date=date(2026, 9, 29),
        )
    )

    with pytest.raises(IntegrityError):
        save_draft(db, _input(), expected_version=None)


def test_중복이_아닌_제약_위반은_충돌로_바꾸지_않는다():
    db = _session()
    first_id = _saved(db).id
    # 다른 요청에서 저장된 문서처럼, 세션이 기존 객체를 들고 있지 않은 상태로 만든다
    db.expunge_all()

    # 같은 ID지만 다른 원아의 문서 — 원아·종류·날짜 중복이 아니라 PK 충돌이다
    with pytest.raises(IntegrityError):
        save_draft(db, _input(draft_id=first_id), expected_version=None)

    # savepoint만 되돌렸으므로 호출자 트랜잭션은 계속 쓸 수 있다
    other = save_draft(db, _input(), expected_version=None)
    db.commit()
    assert db.get(DraftDocument, other.id) is not None


def test_재생성은_문서_ID를_유지하고_버전을_올린다():
    db = _session()
    first = _saved(db)

    draft = save_draft(
        db,
        _input(
            draft_id=first.id,
            child_id=first.child_id,
            author_teacher_id=uuid4(),
            content="재생성한 내용",
            ai_version=2,
        ),
        expected_version=1,
    )
    db.commit()

    assert draft.id == first.id
    assert draft.version == 2
    assert draft.ai_version == 2
    assert draft.content == "재생성한 내용"
    # 작성 교사는 최초 생성 시점 값을 유지한다 (FR-26)
    assert draft.author_teacher_id == first.author_teacher_id
    assert db.query(DraftDocument).count() == 1


@pytest.mark.parametrize(
    "field, value",
    [
        ("child_id", uuid4()),
        ("doc_type", DocType.OBSERVATION_LOG),
        ("record_date", date(2026, 9, 30)),
    ],
)
def test_대상이_다른_재생성_결과는_기존_문서에_저장하지_않는다(field, value):
    db = _session()
    first = _saved(db)
    same_target = {
        "draft_id": first.id,
        "child_id": first.child_id,
        "doc_type": DocType(first.doc_type),
        "record_date": first.record_date,
    }

    with pytest.raises(DraftVersionConflict):
        save_draft(
            db,
            _input(**{**same_target, field: value}, content="다른 원아의 내용", ai_version=2),
            expected_version=1,
        )

    db.commit()
    row = db.get(DraftDocument, first.id, populate_existing=True)
    assert row.content != "다른 원아의 내용"
    assert row.version == 1
    assert row.child_id == first.child_id


def test_교사가_먼저_수정했으면_재생성_결과로_덮어쓰지_않는다():
    db = _session()
    first = _saved(db)
    # 교사 직접 수정 — 잠금용 version이 오른다
    db.execute(
        update(DraftDocument)
        .where(DraftDocument.id == first.id)
        .values(content="교사가 고친 내용", version=2)
    )
    db.commit()

    with pytest.raises(DraftVersionConflict):
        save_draft(
            db,
            _input(
                draft_id=first.id,
                child_id=first.child_id,
                content="늦게 도착한 AI 결과",
                ai_version=2,
            ),
            expected_version=1,
        )

    db.commit()
    row = db.get(DraftDocument, first.id, populate_existing=True)
    assert row.content == "교사가 고친 내용"
    assert row.version == 2
    assert row.ai_version == 1


@pytest.mark.parametrize("status", [DraftStatus.APPROVED, DraftStatus.REVOKED])
def test_승인_회수된_문서는_버전이_같아도_재생성_결과로_덮어쓰지_않는다(status):
    db = _session()
    first = _saved(db)
    db.execute(
        update(DraftDocument).where(DraftDocument.id == first.id).values(status=status.value)
    )
    db.commit()

    with pytest.raises(DraftVersionConflict):
        save_draft(
            db,
            _input(
                draft_id=first.id,
                child_id=first.child_id,
                content="늦게 도착한 AI 결과",
                ai_version=2,
            ),
            expected_version=1,
        )

    row = db.get(DraftDocument, first.id, populate_existing=True)
    assert row.content != "늦게 도착한 AI 결과"
    assert row.version == 1


def test_없는_문서를_재생성으로_저장하면_충돌이다():
    db = _session()

    with pytest.raises(DraftVersionConflict):
        save_draft(db, _input(draft_id=uuid4()), expected_version=1)


def test_재생성_저장에_draft_id가_없으면_거부한다():
    db = _session()

    with pytest.raises(ValueError):
        save_draft(db, _input(), expected_version=1)


def test_save_draft는_커밋하지_않는다():
    db = _session()

    save_draft(db, _input(), expected_version=None)
    db.rollback()

    assert db.query(DraftDocument).count() == 0
