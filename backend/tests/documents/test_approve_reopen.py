"""POST /api/v1/drafts/{draft_id}/approve·reopen — 승인과 게시 전 승인 되돌리기 (FR-08, H-1)."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents.models import SentenceEvidence
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionAction,
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
    tables.append(SentenceEvidence)  # 상세 응답이 문장별 근거를 읽는다(agents)
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


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _draft(db: Session, status: DraftStatus = DraftStatus.VERIFIED) -> tuple[UUID, DraftDocument]:
    """같은 어린이집 원아의 초안 하나. (center_id, 초안)을 돌려준다."""
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
        DraftSentence(draft_id=draft.id, sentence_id=f"s{n}", position=n - 1, text=text)
        for n, text in enumerate(["블록을 쌓았어요.", "탑이 높아졌어요."], start=1)
    )
    db.commit()
    return center.id, draft


def _approve(client: TestClient, draft: DraftDocument, **body):
    return client.post(
        f"/api/v1/drafts/{draft.id}/approve",
        json={"expected_version": draft.version, "reviewed": True, **body},
    )


def _actions(db: Session, draft: DraftDocument) -> list[str]:
    return list(db.scalars(select(RevisionLog.action).where(RevisionLog.draft_id == draft.id)))


def test_검토_대기_초안을_승인하면_상세_모양으로_돌려주고_이력을_남긴다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    response = _approve(client, draft)

    assert response.status_code == 200
    body = response.json()
    assert (body["draft_id"], body["status"], body["version"]) == (str(draft.id), "approved", 4)
    assert body["approved_at"] is not None
    assert body["published_at"] is None  # 승인만으로는 게시되지 않는다
    assert [s["sentence_id"] for s in body["sentences"]] == ["s1", "s2"]
    assert db.scalar(select(RevisionLog.editor_id)) == TEACHER_ID
    assert _actions(db, draft) == [RevisionAction.APPROVE.value]


def test_승인한_초안은_AI_재생성이_덮어쓰지_않는다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)
    _approve(client, draft)

    info = get_draft_version(
        db, child_id=draft.child_id, doc_type=DocType.PARENT_NOTE, record_date=draft.record_date
    )

    assert info.has_teacher_edits is True


def test_reviewed가_true가_아니면_422(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    assert _approve(client, draft, reviewed=False).status_code == 422


@pytest.mark.parametrize(
    "status, expected_version, code",
    [
        (DraftStatus.VERIFIED, 2, "DRAFT_VERSION_CONFLICT"),
        (DraftStatus.DRAFT, 3, "DRAFT_NOT_APPROVABLE"),
        (DraftStatus.APPROVED, 3, "DRAFT_NOT_APPROVABLE"),
    ],
)
def test_승인할_수_없으면_409이고_아무것도_바꾸지_않는다(
    client, db, status, expected_version, code
):
    center_id, draft = _draft(db, status)
    _login_as_teacher(center_id)

    response = _approve(client, draft, expected_version=expected_version)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == code
    db.refresh(draft)
    assert (draft.status, draft.version) == (status.value, 3)
    assert _actions(db, draft) == []


def test_다른_어린이집_교사는_승인할_수_없다(client, db):
    _, draft = _draft(db)
    _login_as_teacher(uuid.uuid4())

    response = _approve(client, draft)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    db.refresh(draft)
    assert draft.status == DraftStatus.VERIFIED.value


def test_없는_초안은_404(client, db):
    center_id, _ = _draft(db)
    _login_as_teacher(center_id)

    response = client.post(
        f"/api/v1/drafts/{uuid.uuid4()}/approve", json={"expected_version": 1, "reviewed": True}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DRAFT_NOT_FOUND"


def test_H1_학부모는_승인할_수_없다(client, db):
    _, draft = _draft(db)
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = _approve(client, draft)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_게시_전_승인을_되돌리면_검토_대기로_돌아가고_이력을_남긴다(client, db):
    center_id, draft = _draft(db, DraftStatus.APPROVED)
    _login_as_teacher(center_id)

    response = client.post(f"/api/v1/drafts/{draft.id}/reopen", json={"expected_version": 3})

    assert response.status_code == 200
    body = response.json()
    assert (body["status"], body["version"], body["approved_at"]) == ("verified", 4, None)
    assert _actions(db, draft) == [RevisionAction.REOPEN.value]


def test_게시한_알림장은_되돌릴_수_없다(client, db):
    center_id, draft = _draft(db, DraftStatus.APPROVED)
    published_at = datetime(2026, 10, 27, 8, 40, tzinfo=UTC)
    db.add(
        DocumentPublication(
            draft_id=draft.id,
            round_number=1,
            publish_request_id="r1",
            published_version=3,
            published_at=published_at,
            revoke_deadline=published_at + timedelta(hours=24),
        )
    )
    db.commit()
    _login_as_teacher(center_id)

    response = client.post(f"/api/v1/drafts/{draft.id}/reopen", json={"expected_version": 3})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_ALREADY_PUBLISHED"
    db.refresh(draft)
    assert draft.status == DraftStatus.APPROVED.value


def test_승인되지_않은_초안은_되돌릴_수_없다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    response = client.post(f"/api/v1/drafts/{draft.id}/reopen", json={"expected_version": 3})

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_NOT_APPROVED"
