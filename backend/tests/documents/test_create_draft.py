"""POST /api/v1/children/{child_id}/drafts — 자료 없는 원아의 초안을 교사가 직접 쓴다."""

import uuid
from collections.abc import Iterator
from datetime import date
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
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
    RevisionLog,
)
from domains.documents.service import get_draft_version
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
RECORD_DATE = date(2026, 10, 28)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    tables.append(SentenceEvidence)  # 상세 응답이 문장별 근거를 읽는다(agents)
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    # 서버 세션(core/database.py SessionLocal)처럼 autoflush를 끕니다 — 켜 두면 커밋 전 조회가
    # 새 문장을 알아서 보여 줘서, 응답에서 새 문장이 빠지는 버그를 못 잡습니다(#206 멘토 리뷰)
    session = sessionmaker(bind=engine, autoflush=False)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def child_id(db: Session) -> UUID:
    """한 어린이집 원아. 그 어린이집 교사로 로그인해 둔다."""
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
    db.commit()
    _login_as_teacher(center.id)
    return child.id


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _create(client: TestClient, child_id: UUID, **overrides):
    body = {
        "record_date": RECORD_DATE.isoformat(),
        "doc_type": "parent_note",
        "title": None,
        "sentences": [{"text": "친구와 그림책을 함께 보았어요."}, {"text": "한참 웃었어요."}],
        **overrides,
    }
    return client.post(f"/api/v1/children/{child_id}/drafts", json=body)


def _draft_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(DraftDocument))


def test_직접_쓴_초안은_검토_대기로_만들어지고_문장에_t_번호가_붙는다(client, db, child_id):
    response = _create(client, child_id)

    assert response.status_code == 201
    body = response.json()
    assert (body["child_id"], body["doc_type"], body["record_date"]) == (
        str(child_id),
        "parent_note",
        "2026-10-28",
    )
    assert (body["status"], body["version"], body["title"]) == ("verified", 1, None)
    assert [
        (s["sentence_id"], s["text"], s["is_edited_by_teacher"]) for s in body["sentences"]
    ] == [
        ("t1", "친구와 그림책을 함께 보았어요.", False),
        ("t2", "한참 웃었어요.", False),
    ]
    assert [s["evidences"] for s in body["sentences"]] == [[], []]
    assert (body["selected_media_ids"], body["media"]) == ([], [])
    assert body["author_teacher_id"] == str(TEACHER_ID)
    # 수정이 아니라 생성이라 이력을 남기지 않는다 (#139)
    assert db.scalar(select(func.count()).select_from(RevisionLog)) == 0


def test_직접_쓴_초안은_AI_재생성이_덮어쓰지_않는다(client, db, child_id):
    _create(client, child_id)

    info = get_draft_version(
        db, child_id=child_id, doc_type=DocType.PARENT_NOTE, record_date=RECORD_DATE
    )

    assert info.has_teacher_edits is True


def test_직접_쓴_초안은_바로_승인할_수_있다(client, db, child_id):
    draft_id = _create(client, child_id).json()["draft_id"]

    response = client.post(
        f"/api/v1/drafts/{draft_id}/approve", json={"expected_version": 1, "reviewed": True}
    )

    assert response.status_code == 200
    assert response.json()["status"] == DraftStatus.APPROVED.value


def test_같은_날짜에_같은_종류의_초안이_있으면_409이고_있던_초안은_그대로다(client, db, child_id):
    first = _create(client, child_id).json()

    response = _create(client, child_id, sentences=[{"text": "다시 쓴 문장"}])

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_ALREADY_EXISTS"
    assert _draft_count(db) == 1
    texts = db.scalars(
        select(DraftSentence.text).where(DraftSentence.draft_id == UUID(first["draft_id"]))
    )
    assert list(texts) == ["친구와 그림책을 함께 보았어요.", "한참 웃었어요."]


def test_같은_날짜라도_문서_종류가_다르면_만들_수_있다(client, db, child_id):
    _create(client, child_id)

    response = _create(client, child_id, doc_type="observation_log")

    assert response.status_code == 201
    assert _draft_count(db) == 2


def test_다른_어린이집_원아에게는_쓸_수_없다(client, db, child_id):
    _login_as_teacher(uuid.uuid4())

    response = _create(client, child_id)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert _draft_count(db) == 0


def test_없는_원아면_404(client, db, child_id):
    response = _create(client, uuid.uuid4())

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CHILD_NOT_FOUND"
    assert _draft_count(db) == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"sentences": []},
        {"sentences": [{"text": "  "}]},
        {"title": "제목"},
        {"doc_type": "journal"},
        {"record_date": "10/28"},
    ],
    ids=["문장_없음", "공백만_있는_문장", "제목", "모르는_문서_종류", "날짜_형식"],
)
def test_요청이_맞지_않으면_422(client, db, child_id, overrides):
    response = _create(client, child_id, **overrides)

    assert response.status_code == 422
    assert _draft_count(db) == 0


def test_H1_학부모는_쓸_수_없다(client, db, child_id):
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = _create(client, child_id)

    assert response.status_code == 403
    assert _draft_count(db) == 0
