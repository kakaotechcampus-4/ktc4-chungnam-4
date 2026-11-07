"""POST /api/v1/drafts/{draft_id}/revoke — 게시 회수와 회수 뒤 다시 게시 (파이프라인 9단계, H-1).

학부모–원아 확인은 organization의 진짜 함수를 쓴다. 이름·본문은 합성 값만 쓴다.
서버처럼 autoflush=False인 세션으로 돌린다 (core/database.py, #224).
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents.models import SentenceEvidence
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
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
from domains.organization.models import Center, Child, Klass, ParentChildRelation
from main import app

TEACHER_ID = uuid.uuid4()
PARENT_ID = uuid.uuid4()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [
        Center,
        Klass,
        Child,
        ParentChildRelation,
        DraftDocument,
        DraftSentence,
        DocumentPublication,
        RevisionLog,
        SentenceEvidence,
        AccessLog,
    ]
    # 상세·학부모 응답이 작성 교사 이름을 auth에서 읽는다(#228)
    Base.metadata.create_all(engine, tables=[LookupAccount.__table__, LookupTeacher.__table__])
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine, autoflush=False)()
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


def _login_as_parent() -> None:
    profile = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=PARENT_ID
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _approved_draft(db: Session) -> tuple[UUID, DraftDocument]:
    """보호자가 연결된 원아의 승인된 알림장. (center_id, 초안)을 돌려준다."""
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
    db.add(ParentChildRelation(parent_id=PARENT_ID, child_id=child.id, is_legal_guardian=True))
    draft = DraftDocument(
        child_id=child.id,
        author_teacher_id=TEACHER_ID,
        doc_type=DocType.PARENT_NOTE.value,
        record_date=date(2026, 10, 27),
        status=DraftStatus.APPROVED.value,
        ai_version=1,
        version=3,
    )
    db.add(draft)
    db.flush()
    db.add(DraftSentence(draft_id=draft.id, sentence_id="s1", position=0, text="블록을 쌓았어요."))
    db.commit()
    return center.id, draft


def _publish(client: TestClient, draft: DraftDocument, version: int) -> dict:
    response = client.post(
        "/api/v1/publications",
        json={
            "request_id": str(uuid.uuid4()),
            "include_photos": False,
            "items": [{"draft_id": str(draft.id), "expected_version": version}],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["results"][0]


@pytest.fixture
def published(client: TestClient, db: Session) -> tuple[UUID, DraftDocument]:
    center_id, draft = _approved_draft(db)
    _login_as_teacher(center_id)
    assert _publish(client, draft, 3)["status"] == "published"
    return center_id, draft


def _revoke(client: TestClient, draft: DraftDocument, version: int = 4):
    return client.post(f"/api/v1/drafts/{draft.id}/revoke", json={"expected_version": version})


def _publication(db: Session, draft: DraftDocument) -> DocumentPublication:
    # 테스트가 세션을 공유하므로, 커밋하지 않은 회수가 커밋된 것처럼 보이지 않게 버린다.
    db.rollback()
    return db.scalars(
        select(DocumentPublication)
        .where(DocumentPublication.draft_id == draft.id)
        .order_by(DocumentPublication.round_number.desc())
    ).first()


def _actions(db: Session, draft: DraftDocument) -> list[str]:
    return list(db.scalars(select(RevisionLog.action).where(RevisionLog.draft_id == draft.id)))


def test_회수하면_회차와_상태와_이력이_함께_바뀐다(client, db, published):
    _, draft = published

    response = _revoke(client, draft)

    assert response.status_code == 200, response.text
    body = response.json()
    publication = _publication(db, draft)
    assert (body["draft_id"], body["publication_id"], body["version"]) == (
        str(draft.id),
        str(publication.id),
        5,
    )
    assert publication.revoked_at is not None
    assert (draft.status, draft.version, draft.approved_at) == (
        DraftStatus.REVOKED.value,
        5,
        None,
    )
    assert _actions(db, draft) == [RevisionAction.REVOKE.value]
    assert db.scalar(select(RevisionLog.editor_id)) == TEACHER_ID


def test_H1_회수한_알림장은_학부모_목록과_본문에서_사라진다(client, db, published):
    center_id, draft = published
    _login_as_parent()
    assert len(client.get(f"/api/v1/children/{draft.child_id}/parent-notes").json()["items"]) == 1

    _login_as_teacher(center_id)
    assert _revoke(client, draft).status_code == 200

    _login_as_parent()
    assert client.get(f"/api/v1/children/{draft.child_id}/parent-notes").json()["items"] == []
    response = client.get(f"/api/v1/parent-notes/{draft.id}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PARENT_NOTE_NOT_FOUND"


def test_학부모가_본문을_열었어도_기한_안이면_회수하고_학부모에게서_사라진다(client, db, published):
    """잘못 나간 알림장을 학부모가 먼저 열면 고칠 길이 없어서 열람과 상관없이 회수한다 (#266)."""
    center_id, draft = published
    _login_as_parent()
    assert client.get(f"/api/v1/parent-notes/{draft.id}").status_code == 200

    _login_as_teacher(center_id)
    response = _revoke(client, draft)

    assert response.status_code == 200
    assert _publication(db, draft).revoked_at is not None
    assert (draft.status, draft.version) == (DraftStatus.REVOKED.value, 5)
    _login_as_parent()
    assert client.get(f"/api/v1/parent-notes/{draft.id}").status_code == 404


def test_학부모가_목록만_봤으면_회수할_수_있다(client, db, published):
    center_id, draft = published
    _login_as_parent()
    assert client.get(f"/api/v1/children/{draft.child_id}/parent-notes").status_code == 200

    _login_as_teacher(center_id)

    assert _revoke(client, draft).status_code == 200


def test_기한이_지나면_회수할_수_없다(client, db, published):
    _, draft = published
    db.execute(
        update(DocumentPublication)
        .where(DocumentPublication.draft_id == draft.id)
        .values(revoke_deadline=datetime.now(UTC) - timedelta(seconds=1))
    )
    db.commit()

    response = _revoke(client, draft)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REVOKE_DEADLINE_PASSED"
    assert _publication(db, draft).revoked_at is None


def test_게시하지_않은_알림장은_회수할_수_없다(client, db):
    center_id, draft = _approved_draft(db)
    _login_as_teacher(center_id)

    response = _revoke(client, draft, version=3)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_NOT_PUBLISHED"


def test_두_번_회수하면_두_번째는_409다(client, db, published):
    _, draft = published
    assert _revoke(client, draft).status_code == 200

    response = _revoke(client, draft, version=5)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_NOT_PUBLISHED"
    assert _actions(db, draft) == [RevisionAction.REVOKE.value]


def test_버전이_다르면_회차도_회수되지_않는다(client, db, published):
    _, draft = published

    response = _revoke(client, draft, version=3)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_VERSION_CONFLICT"
    assert _publication(db, draft).revoked_at is None
    assert draft.status == DraftStatus.APPROVED.value
    assert _actions(db, draft) == []


def test_다른_어린이집_교사는_회수할_수_없다(client, db, published):
    _, draft = published
    _login_as_teacher(uuid.uuid4())

    response = _revoke(client, draft)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert _publication(db, draft).revoked_at is None


def test_학부모는_회수할_수_없다(client, db, published):
    _, draft = published
    _login_as_parent()

    response = _revoke(client, draft)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"
    assert _publication(db, draft).revoked_at is None


def test_없는_초안은_404(client, db, published):
    response = client.post(f"/api/v1/drafts/{uuid.uuid4()}/revoke", json={"expected_version": 1})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DRAFT_NOT_FOUND"


def test_회수한_알림장은_되돌리기_전에는_고치거나_승인하거나_게시할_수_없다(client, db, published):
    _, draft = published
    assert _revoke(client, draft).status_code == 200

    edited = client.patch(
        f"/api/v1/drafts/{draft.id}",
        json={"expected_version": 5, "sentences": [{"sentence_id": "s1", "text": "고친 문장."}]},
    )
    approved = client.post(
        f"/api/v1/drafts/{draft.id}/approve", json={"expected_version": 5, "reviewed": True}
    )
    result = _publish(client, draft, 5)

    assert edited.status_code == 409
    assert edited.json()["error"]["code"] == "DRAFT_REVOKED"
    assert approved.status_code == 409
    assert approved.json()["error"]["code"] == "DRAFT_NOT_APPROVABLE"
    assert (result["status"], result["error_code"]) == ("failed", "DRAFT_NOT_APPROVED")


def test_학부모가_본_알림장도_회수해_고쳐_다시_게시하면_새_회차로_간다(client, db, published):
    """#266의 흐름 — 잘못 나간 알림장을 학부모가 먼저 열었어도 내리고, 고쳐서, 다시 보낸다."""
    center_id, draft = published
    _login_as_parent()
    first = client.get(f"/api/v1/parent-notes/{draft.id}")
    assert (first.status_code, first.json()["is_resent"]) == (200, False)
    _login_as_teacher(center_id)
    assert _revoke(client, draft).status_code == 200

    reopened = client.post(f"/api/v1/drafts/{draft.id}/reopen", json={"expected_version": 5})
    assert reopened.status_code == 200, reopened.text
    assert (reopened.json()["status"], reopened.json()["version"]) == ("verified", 6)
    edited = client.patch(
        f"/api/v1/drafts/{draft.id}",
        json={"expected_version": 6, "sentences": [{"sentence_id": "s1", "text": "고친 문장."}]},
    )
    assert edited.status_code == 200, edited.text
    approved = client.post(
        f"/api/v1/drafts/{draft.id}/approve",
        json={"expected_version": edited.json()["version"], "reviewed": True},
    )
    assert approved.status_code == 200, approved.text
    result = _publish(client, draft, approved.json()["version"])

    assert result["status"] == "published"
    publication = _publication(db, draft)
    # 새 회차는 학부모가 아직 열지 않았다 — 고친 글을 처음 보는 것이다
    assert (publication.round_number, publication.revoked_at, publication.first_viewed_at) == (
        2,
        None,
        None,
    )
    assert _actions(db, draft)[-1] == RevisionAction.RESEND.value
    assert RevisionAction.REVOKE.value in _actions(db, draft)
    assert RevisionAction.REOPEN.value in _actions(db, draft)
    _login_as_parent()
    # 전에 읽었어도 새 회차라 다시 안 읽음이고, 화면이 "선생님이 내용을 고쳤어요"를 띄운다
    (item,) = client.get(f"/api/v1/children/{draft.child_id}/parent-notes").json()["items"]
    assert (item["is_read"], item["is_resent"]) == (False, True)
    opened = client.get(f"/api/v1/parent-notes/{draft.id}")
    assert opened.status_code == 200, opened.text
    assert opened.json()["is_resent"] is True
    assert "고친 문장." in opened.text
    assert "블록을 쌓았어요." not in opened.text


def test_회수한_알림장은_AI_재생성이_덮어쓰지_않는다(client, db, published):
    _, draft = published
    assert _revoke(client, draft).status_code == 200

    info = get_draft_version(
        db, child_id=draft.child_id, doc_type=DocType.PARENT_NOTE, record_date=draft.record_date
    )

    assert info.has_teacher_edits is True


def test_상세는_회수_가능_여부와_기한을_알려_준다(client, db, published):
    center_id, draft = published
    detail = client.get(f"/api/v1/drafts/{draft.id}").json()
    assert detail["can_revoke"] is True
    assert detail["revoke_deadline"] is not None

    # 학부모가 열어 봐도 기한 안이면 그대로 회수할 수 있다 (#266)
    _login_as_parent()
    assert client.get(f"/api/v1/parent-notes/{draft.id}").status_code == 200
    _login_as_teacher(center_id)
    assert client.get(f"/api/v1/drafts/{draft.id}").json()["can_revoke"] is True


def test_기한이_지나거나_회수하면_상세의_회수_가능이_꺼진다(client, db, published):
    _, draft = published
    deadline = _publication(db, draft).revoke_deadline
    db.execute(
        update(DocumentPublication)
        .where(DocumentPublication.draft_id == draft.id)
        .values(revoke_deadline=datetime.now(UTC) - timedelta(seconds=1))
    )
    db.commit()
    assert client.get(f"/api/v1/drafts/{draft.id}").json()["can_revoke"] is False

    db.execute(
        update(DocumentPublication)
        .where(DocumentPublication.draft_id == draft.id)
        .values(revoke_deadline=deadline)
    )
    db.commit()
    assert _revoke(client, draft).status_code == 200

    detail = client.get(f"/api/v1/drafts/{draft.id}").json()
    assert (detail["status"], detail["can_revoke"], detail["revoke_deadline"]) == (
        "revoked",
        False,
        None,
    )
