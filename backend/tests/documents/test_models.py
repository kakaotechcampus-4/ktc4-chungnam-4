from datetime import UTC, date, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.base import Base
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftStatus,
    EditMethod,
    Notice,
    RevisionAction,
    RevisionLog,
    UnclassifiedItem,
)

_TABLES = [
    DraftDocument.__table__,
    DocumentPublication.__table__,
    RevisionLog.__table__,
    UnclassifiedItem.__table__,
    Notice.__table__,
]


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=_TABLES)
    return Session(engine)


def _draft(
    child_id=None,
    doc_type=DocType.OBSERVATION_LOG,
    record_date=date(2026, 9, 15),
    author_teacher_id=None,
) -> DraftDocument:
    return DraftDocument(
        child_id=child_id or uuid4(),
        author_teacher_id=author_teacher_id or uuid4(),
        doc_type=doc_type.value,
        record_date=record_date,
        status=DraftStatus.DRAFT.value,
    )


def test_초안_기본값이_DRAFT이고_저장된다():
    db = _session()
    draft = _draft()

    db.add(draft)
    db.flush()

    row = db.query(DraftDocument).one()
    assert row.status == DraftStatus.DRAFT.value
    assert row.ai_version == 1
    assert row.version == 1
    assert row.content == ""
    assert row.author_teacher_id is not None


def test_DraftStatus에는_PUBLISHED가_없다():
    # 게시 게이트는 CLAUDE.md H-1대로 status==APPROVED로만 검사한다 — 게시는
    # status를 바꾸지 않고 DocumentPublication 행으로만 표현한다.
    assert {status.value for status in DraftStatus} == {
        "draft",
        "in_review",
        "approved",
        "revoked",
    }


def test_같은_원아_문서종류_날짜_중복은_거부된다():
    db = _session()
    child_id = uuid4()
    db.add(_draft(child_id=child_id))
    db.flush()

    db.add(_draft(child_id=child_id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_다른_문서종류는_같은_원아_같은_날짜여도_허용된다():
    db = _session()
    child_id = uuid4()
    db.add(_draft(child_id=child_id, doc_type=DocType.OBSERVATION_LOG))
    db.add(_draft(child_id=child_id, doc_type=DocType.PARENT_NOTE))

    db.flush()  # 예외 없이 통과해야 한다

    assert db.query(DraftDocument).count() == 2


def _publication(
    draft_id, *, round_number, request_id, now=None
) -> DocumentPublication:
    now = now or datetime.now(UTC)
    return DocumentPublication(
        draft_id=draft_id,
        round_number=round_number,
        publish_request_id=request_id,
        published_version=1,
        published_at=now,
        revoke_deadline=now + timedelta(hours=24),
    )


def test_같은_draft에_같은_요청ID_재전송은_중복_생성되지_않는다():
    db = _session()
    draft = _draft()
    db.add(draft)
    db.flush()

    db.add(_publication(draft.id, round_number=1, request_id="req-1"))
    db.flush()

    db.add(_publication(draft.id, round_number=2, request_id="req-1"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_한_요청ID로_여러_draft를_한번에_게시할_수_있다():
    # POST /letters/publish는 하나의 request_id로 여러 문서를 함께 게시한다 —
    # publish_request_id 단독 유니크였다면 두 번째 draft부터 막혔을 시나리오.
    db = _session()
    draft_a, draft_b = (
        _draft(doc_type=DocType.OBSERVATION_LOG),
        _draft(child_id=uuid4(), doc_type=DocType.OBSERVATION_LOG),
    )
    db.add_all([draft_a, draft_b])
    db.flush()

    db.add(_publication(draft_a.id, round_number=1, request_id="req-batch"))
    db.add(_publication(draft_b.id, round_number=1, request_id="req-batch"))

    db.flush()  # 예외 없이 통과해야 한다

    assert db.query(DocumentPublication).count() == 2


def test_같은_draft에_같은_회차번호는_중복_생성되지_않는다():
    db = _session()
    draft = _draft()
    db.add(draft)
    db.flush()

    db.add(_publication(draft.id, round_number=1, request_id="req-1"))
    db.flush()

    db.add(_publication(draft.id, round_number=1, request_id="req-2"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_revision_log은_수정_전후_내용을_남긴다():
    db = _session()
    draft = _draft()
    db.add(draft)
    db.flush()

    db.add(
        RevisionLog(
            draft_id=draft.id,
            editor_id=uuid4(),
            action=RevisionAction.EDIT.value,
            edit_method=EditMethod.MANUAL.value,
            before_content="수정 전 본문",
            after_content="수정 후 본문",
        )
    )
    db.flush()

    row = db.query(RevisionLog).one()
    assert row.before_content == "수정 전 본문"
    assert row.after_content == "수정 후 본문"
    assert row.draft_id == draft.id


def test_revision_log은_승인_회수_재게시도_기록한다():
    # 테크스펙 ERD: action에 edit뿐 아니라 approve/revoke/resend도 있다.
    db = _session()
    draft = _draft()
    db.add(draft)
    db.flush()

    for action in (
        RevisionAction.APPROVE,
        RevisionAction.REVOKE,
        RevisionAction.RESEND,
    ):
        db.add(RevisionLog(draft_id=draft.id, editor_id=uuid4(), action=action.value))
    db.flush()

    logged_actions = {row.action for row in db.query(RevisionLog).all()}
    assert logged_actions == {"approve", "revoke", "resend"}


def test_unclassified_item은_폴리모픽_참조로_저장된다():
    # 테크스펙 ERD: ref_type/ref_id 폴리모픽. 서버 도달 이후 사유만 기록한다
    # (얼굴미매칭 등 업로드 전 판정은 프론트에서만 관리되고 서버로 오지 않는다).
    db = _session()

    db.add(
        UnclassifiedItem(
            ref_type="draft_document",
            ref_id=uuid4(),
            reason="insufficient_evidence",
        )
    )
    db.flush()

    row = db.query(UnclassifiedItem).one()
    assert row.status == "pending"
    assert row.resolved_at is None
    assert row.resolved_by is None


def test_unclassified_item_처리자와_처리시각을_기록할_수_있다():
    db = _session()
    resolver_id = uuid4()

    db.add(
        UnclassifiedItem(
            ref_type="draft_document",
            ref_id=uuid4(),
            reason="verification_failed",
            status="resolved",
            resolved_by=resolver_id,
            resolved_at=datetime.now(UTC),
        )
    )
    db.flush()

    row = db.query(UnclassifiedItem).one()
    assert row.status == "resolved"
    assert row.resolved_by == resolver_id


def test_notice는_승인_게시_워크플로가_없다():
    db = _session()

    db.add(
        Notice(
            class_id=uuid4(),
            teacher_id=uuid4(),
            title="가정통신문",
            content="다음 주 소풍 안내",
        )
    )
    db.flush()

    row = db.query(Notice).one()
    assert row.title == "가정통신문"
    assert not hasattr(row, "published_at")
