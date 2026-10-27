"""POST /api/v1/publications — 승인된 알림장을 학부모에게 게시한다(일괄, 건별 결과) (FR-08·FR-09)."""

import uuid
from collections.abc import Iterator
from datetime import date, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
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
from domains.organization.models import Center, Child, Klass
from main import app


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


@pytest.fixture
def class_id(db: Session) -> UUID:
    """한 어린이집의 반. 그 어린이집 교사로 로그인해 둔다."""
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.commit()
    _login_as_teacher(center.id)
    return klass.id


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _draft(
    db: Session,
    class_id: UUID,
    status: DraftStatus = DraftStatus.APPROVED,
    doc_type: DocType = DocType.PARENT_NOTE,
) -> DraftDocument:
    child = Child(
        class_id=class_id,
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
        doc_type=doc_type.value,
        record_date=date(2026, 10, 27),
        status=status.value,
        ai_version=1,
        version=5,
    )
    db.add(draft)
    db.commit()
    return draft


def _publish(client: TestClient, *drafts: DraftDocument, request_id: str = "req-1", **overrides):
    items = [{"draft_id": str(draft.id), "expected_version": draft.version} for draft in drafts]
    body = {"request_id": request_id, "include_photos": True, "items": items, **overrides}
    return client.post("/api/v1/publications", json=body)


def _rounds(db: Session, draft: DraftDocument) -> list[DocumentPublication]:
    return list(
        db.scalars(select(DocumentPublication).where(DocumentPublication.draft_id == draft.id))
    )


def test_승인된_알림장을_게시하면_회차가_생기고_버전이_오른다(client, db, class_id):
    draft = _draft(db, class_id)

    response = _publish(client, draft)

    assert response.status_code == 200
    [result] = response.json()["results"]
    assert result["status"] == "published"
    assert (result["draft_id"], result["parent_note_id"]) == (str(draft.id), str(draft.id))
    assert (result["child_id"], result["version"], result["error_code"]) == (
        str(draft.child_id),
        6,
        None,
    )
    [publication] = _rounds(db, draft)
    assert (publication.round_number, publication.published_version) == (1, 6)
    assert publication.include_photos is True
    assert publication.revoke_deadline - publication.published_at == timedelta(hours=24)
    db.refresh(draft)
    # 게시해도 상태는 approved 그대로다 — 게시 여부는 회차로 본다
    assert (draft.status, draft.version) == (DraftStatus.APPROVED.value, 6)


def test_건별로_실패해도_나머지는_게시된다(client, db, class_id):
    ok = _draft(db, class_id)
    verified = _draft(db, class_id, status=DraftStatus.VERIFIED)
    log = _draft(db, class_id, doc_type=DocType.OBSERVATION_LOG)
    stale = _draft(db, class_id)
    items = [
        {"draft_id": str(draft.id), "expected_version": 5} for draft in (ok, verified, log)
    ] + [
        {"draft_id": str(stale.id), "expected_version": 4},  # 화면이 본 버전이 오래됐다
        {"draft_id": str(uuid.uuid4()), "expected_version": 1},
    ]

    response = _publish(client, items=items)

    results = response.json()["results"]
    assert [(r["status"], r["error_code"]) for r in results] == [
        ("published", None),
        ("failed", "DRAFT_NOT_APPROVED"),
        ("failed", "NOT_PARENT_NOTE"),
        ("failed", "DRAFT_VERSION_CONFLICT"),
        ("failed", "DRAFT_NOT_FOUND"),
    ]
    assert results[3]["version"] == 5  # 실패해도 지금 버전을 알려 준다
    assert results[4]["child_id"] is None
    assert db.scalar(select(func.count()).select_from(DocumentPublication)) == 1


def test_이미_게시_중이면_새_요청이어도_다시_게시하지_않는다(client, db, class_id):
    draft = _draft(db, class_id)
    _publish(client, draft, request_id="req-1")
    db.refresh(draft)

    response = _publish(client, draft, request_id="req-2")

    assert response.json()["results"][0]["error_code"] == "DRAFT_ALREADY_PUBLISHED"
    assert len(_rounds(db, draft)) == 1


def test_같은_요청을_다시_보내면_새_회차_없이_처음_결과를_돌려준다(client, db, class_id):
    draft = _draft(db, class_id)
    first = _publish(client, draft).json()["results"][0]

    again = _publish(client, draft).json()["results"][0]

    assert again == first
    assert len(_rounds(db, draft)) == 1


def test_다른_어린이집_교사는_게시할_수_없다(client, db, class_id):
    draft = _draft(db, class_id)
    _login_as_teacher(uuid.uuid4())

    result = _publish(client, draft).json()["results"][0]

    assert (result["status"], result["error_code"]) == ("failed", "CHILD_ACCESS_DENIED")
    assert _rounds(db, draft) == []


@pytest.mark.parametrize("items", [[], "same_twice"], ids=["항목_없음", "같은_초안_두_번"])
def test_항목이_없거나_같은_초안이_두_번이면_422(client, db, class_id, items):
    draft = _draft(db, class_id)
    if items == "same_twice":
        response = _publish(client, draft, draft)
    else:
        response = _publish(client, items=items)

    assert response.status_code == 422


def test_H1_학부모는_게시할_수_없다(client, db, class_id):
    draft = _draft(db, class_id)
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = _publish(client, draft)

    assert response.status_code == 403
    assert _rounds(db, draft) == []
