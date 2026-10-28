"""PATCH /api/v1/drafts/{draft_id} — 교사가 문장을 직접 고치거나 새 문장을 덧붙인다 (FR-17)."""

import uuid
from collections.abc import Iterator
from datetime import date
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth.middleware import get_current_user
from domains.auth.service import TeacherProfile
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionLog,
)
from domains.documents.service import get_draft_version
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _draft(
    db: Session, *sentence_ids: str, status: DraftStatus = DraftStatus.VERIFIED
) -> DraftDocument:
    """같은 어린이집 원아의 초안. 그 어린이집 교사로 로그인해 둔다."""
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name="가나",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    draft = DraftDocument(
        child_id=child.id,
        author_teacher_id=uuid.uuid4(),
        doc_type=DocType.PARENT_NOTE.value,
        record_date=date(2026, 10, 27),
        status=status.value,
        ai_version=1,
        version=3,
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=sid, position=n, text=f"{sid} 원래 문장")
        for n, sid in enumerate(sentence_ids or ("s1", "s2"))
    )
    db.commit()
    _login_as_teacher(center.id)
    return draft


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _patch(client: TestClient, draft: DraftDocument, **body):
    return client.patch(f"/api/v1/drafts/{draft.id}", json={"expected_version": 3, **body})


def _stored(db: Session, draft: DraftDocument) -> list[tuple[str, str, bool]]:
    rows = db.scalars(
        select(DraftSentence)
        .where(DraftSentence.draft_id == draft.id)
        .execution_options(populate_existing=True)
        .order_by(DraftSentence.position)
    )
    return [(row.sentence_id, row.text, row.is_edited_by_teacher) for row in rows]


def _logs(db: Session, draft: DraftDocument) -> list[tuple[str, str | None, str | None, str]]:
    rows = db.scalars(select(RevisionLog).where(RevisionLog.draft_id == draft.id))
    return [
        (row.target_sentence_id, row.before_content, row.after_content, row.edit_method)
        for row in rows
    ]


def test_문장을_고치면_수정됨_표시와_이력이_남고_버전이_오른다(client, db):
    draft = _draft(db)

    response = _patch(client, draft, sentences=[{"sentence_id": "s2", "text": "고친 문장"}])

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 4
    assert [(s["sentence_id"], s["is_edited_by_teacher"]) for s in body["sentences"]] == [
        ("s1", False),
        ("s2", True),
    ]
    assert _stored(db, draft) == [("s1", "s1 원래 문장", False), ("s2", "고친 문장", True)]
    assert _logs(db, draft) == [("s2", "s2 원래 문장", "고친 문장", "manual")]
    # 고친 문서는 AI 재생성이 덮어쓰지 않는다 (_has_teacher_edits)
    info = get_draft_version(
        db, child_id=draft.child_id, doc_type=DocType.PARENT_NOTE, record_date=draft.record_date
    )
    assert info.has_teacher_edits is True


def test_새_문장은_맨_뒤에_t_번호_최댓값_다음부터_붙는다(client, db):
    draft = _draft(db, "s1", "t1")

    response = _patch(
        client, draft, added_sentences=[{"text": "첫 새 문장"}, {"text": "둘째 새 문장"}]
    )

    assert response.status_code == 200
    assert _stored(db, draft)[2:] == [("t2", "첫 새 문장", False), ("t3", "둘째 새 문장", False)]
    assert _logs(db, draft) == [
        ("t2", None, "첫 새 문장", "manual"),
        ("t3", None, "둘째 새 문장", "manual"),
    ]


def test_교사가_쓴_문장도_고치면_수정됨이다(client, db):
    draft = _draft(db, "s1", "t1")

    _patch(client, draft, sentences=[{"sentence_id": "t1", "text": "다시 고친 문장"}])

    assert _stored(db, draft)[1] == ("t1", "다시 고친 문장", True)


@pytest.mark.parametrize(
    "text", ["s1 원래 문장", " s1 원래 문장\n"], ids=["같음", "앞뒤_공백만_다름"]
)
def test_글자가_그대로인_문장은_고친_것으로_보지_않는다(client, db, text):
    draft = _draft(db)

    _patch(client, draft, sentences=[{"sentence_id": "s1", "text": text}])

    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
    assert _logs(db, draft) == []


def test_없는_문장이면_400이고_아무것도_바꾸지_않는다(client, db):
    draft = _draft(db)

    response = _patch(
        client,
        draft,
        sentences=[
            {"sentence_id": "s1", "text": "고친 문장"},
            {"sentence_id": "s9", "text": "없는 문장"},
        ],
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_SENTENCE_ID"
    db.refresh(draft)
    assert draft.version == 3
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
    assert _logs(db, draft) == []


@pytest.mark.parametrize(
    "status, expected_version, code",
    [
        (DraftStatus.VERIFIED, 2, "DRAFT_VERSION_CONFLICT"),
        (DraftStatus.DRAFT, 3, "DRAFT_NOT_READY"),
        (DraftStatus.APPROVED, 3, "DRAFT_ALREADY_APPROVED"),
    ],
)
def test_고칠_수_없는_상태면_409(client, db, status, expected_version, code):
    draft = _draft(db, status=status)

    response = _patch(
        client,
        draft,
        expected_version=expected_version,
        sentences=[{"sentence_id": "s1", "text": "고친 문장"}],
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == code
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"sentences": [{"sentence_id": "s1", "text": "a"}, {"sentence_id": "s1", "text": "b"}]},
        {"selected_media_ids": [str(uuid.uuid4())]},
        {"sentences": [{"sentence_id": "s1", "text": "  \n"}]},
        {"added_sentences": [{"text": " "}]},
    ],
    ids=["바꿀_것_없음", "같은_문장_두_번", "사진_선택_아직_미지원", "공백만_고침", "공백만_추가"],
)
def test_요청이_맞지_않으면_422(client, db, body):
    draft = _draft(db)

    response = _patch(client, draft, **body)

    assert response.status_code == 422
    db.refresh(draft)
    assert draft.version == 3


def test_다른_어린이집_교사는_고칠_수_없다(client, db):
    draft = _draft(db)
    _login_as_teacher(uuid.uuid4())

    response = _patch(client, draft, sentences=[{"sentence_id": "s1", "text": "고친 문장"}])

    assert response.status_code == 403
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
