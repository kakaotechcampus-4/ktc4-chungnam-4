"""동의 철회 (FR-22, #225 ⑥) — ③ 철회와 얼굴 임베딩 삭제가 한 트랜잭션으로 묶이는지."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from core.exceptions import ChildAccessDenied, ChildNotFound
from domains.audit.models import DeletionLog
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.face import service as face_service
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding
from domains.organization import service
from domains.organization.models import Center, Child, ConsentRecord, Klass
from main import app

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ConsentRecord.__table__,
            FaceEmbedding.__table__,
            EmbeddingLifecycleLog.__table__,
            DeletionLog.__table__,
        ],
    )
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
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _login_as_parent() -> None:
    profile = ParentProfile(
        account_id=uuid.uuid4(),
        email="parent@example.com",
        name="보호자A",
        parent_id=uuid.uuid4(),
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _center(db: Session) -> UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _child(db: Session, center_id: UUID) -> UUID:
    klass = Klass(center_id=center_id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name="김하나",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    return child.id


def _agree(
    db: Session, child_id: UUID, consent_type: str, *, parent_id: UUID | None = None
) -> None:
    db.add(
        ConsentRecord(
            child_id=child_id,
            parent_id=parent_id or uuid.uuid4(),
            consent_type=consent_type,
            status="agreed",
            agreed_at=datetime(2026, 10, 1, tzinfo=UTC),
        )
    )
    db.flush()


def _register_face(db: Session, child_id: UUID) -> UUID:
    embedding = FaceEmbedding(
        child_id=child_id,
        embedding_enc=b"encrypted-test-vector",
        key_ref="test-key",
        model_version="human-face-test",
        registered_at=datetime(2026, 10, 2, tzinfo=UTC),
    )
    db.add(embedding)
    db.flush()
    return embedding.id


def _consented_child(db: Session) -> tuple[UUID, UUID, UUID]:
    """세 동의를 모두 받고 얼굴을 등록한 원아. (center_id, child_id, embedding_id)"""
    center_id = _center(db)
    child_id = _child(db, center_id)
    for kind in ("personal_info", "activity_media", "face_feature"):
        _agree(db, child_id, kind)
    embedding_id = _register_face(db, child_id)
    db.commit()
    return center_id, child_id, embedding_id


def _count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model))


def test_얼굴_동의를_철회하면_임베딩을_지우고_파기와_생애주기를_남긴다(db: Session):
    center_id, child_id, embedding_id = _consented_child(db)

    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert service.has_consent(db, child_id, "face_feature") is False
    face = db.scalar(select(ConsentRecord).where(ConsentRecord.consent_type == "face_feature"))
    assert face.status == "revoked"
    assert face.revoked_at.replace(tzinfo=UTC) == NOW
    assert _count(db, FaceEmbedding) == 0
    deletion = db.scalar(select(DeletionLog))
    assert (deletion.target_type, deletion.target_id, deletion.reason) == (
        "face_embedding",
        embedding_id,
        "consent_revoked",
    )
    assert db.scalar(select(EmbeddingLifecycleLog.event_type)) == "consent_revoked"


def test_필수_동의는_그대로_두고_얼굴_동의만_철회한다(db: Session):
    center_id, child_id, _ = _consented_child(db)

    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert service.has_consent(db, child_id, "personal_info") is True
    assert service.has_consent(db, child_id, "activity_media") is True


def test_보호자가_여럿이면_모든_보호자의_얼굴_동의를_철회한다(db: Session):
    center_id, child_id, _ = _consented_child(db)
    _agree(db, child_id, "face_feature", parent_id=uuid.uuid4())
    db.commit()

    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert service.has_consent(db, child_id, "face_feature") is False
    statuses = db.scalars(
        select(ConsentRecord.status).where(ConsentRecord.consent_type == "face_feature")
    ).all()
    assert statuses == ["revoked", "revoked"]


def test_철회를_다시_불러도_오류없이_기록이_늘지_않는다(db: Session):
    center_id, child_id, _ = _consented_child(db)
    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert _count(db, DeletionLog) == 1
    assert _count(db, EmbeddingLifecycleLog) == 1


def test_얼굴을_등록하지_않은_원아도_동의만_철회한다(db: Session):
    center_id = _center(db)
    child_id = _child(db, center_id)
    _agree(db, child_id, "face_feature")
    db.commit()

    service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert service.has_consent(db, child_id, "face_feature") is False
    assert _count(db, DeletionLog) == 0


def test_임베딩_삭제가_실패하면_동의_철회도_되돌린다(db: Session, monkeypatch: pytest.MonkeyPatch):
    center_id, child_id, _ = _consented_child(db)

    def fail(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("삭제 실패")

    monkeypatch.setattr(face_service, "delete_embedding", fail)

    with pytest.raises(RuntimeError):
        service.revoke_face_consent(db, child_id, center_id, now=NOW)

    assert service.has_consent(db, child_id, "face_feature") is True
    assert _count(db, FaceEmbedding) == 1
    assert _count(db, DeletionLog) == 0


def test_다른_어린이집_원아는_철회할_수_없다(db: Session):
    _, child_id, _ = _consented_child(db)

    with pytest.raises(ChildAccessDenied):
        service.revoke_face_consent(db, child_id, _center(db), now=NOW)

    assert service.has_consent(db, child_id, "face_feature") is True
    assert _count(db, FaceEmbedding) == 1


def test_없는_원아는_404(db: Session):
    with pytest.raises(ChildNotFound):
        service.revoke_face_consent(db, uuid.uuid4(), _center(db), now=NOW)


def test_철회_API는_204이고_원아_상세를_다시_불러_확인한다(client: TestClient, db: Session):
    center_id, child_id, _ = _consented_child(db)
    _login_as_teacher(center_id)

    response = client.post(
        f"/api/v1/children/{child_id}/consents/revoke", json={"consent_type": "face_feature"}
    )

    assert response.status_code == 204
    assert response.content == b""
    assert service.has_consent(db, child_id, "face_feature") is False
    assert _count(db, FaceEmbedding) == 0


@pytest.mark.parametrize("consent_type", ["personal_info", "activity_media", "unknown"])
def test_얼굴_동의_외의_철회는_422(client: TestClient, db: Session, consent_type: str):
    center_id, child_id, _ = _consented_child(db)
    _login_as_teacher(center_id)

    response = client.post(
        f"/api/v1/children/{child_id}/consents/revoke", json={"consent_type": consent_type}
    )

    assert response.status_code == 422
    assert service.has_consent(db, child_id, consent_type) is (consent_type != "unknown")
    assert _count(db, FaceEmbedding) == 1


def test_다른_어린이집_교사의_철회_API는_403(client: TestClient, db: Session):
    _, child_id, _ = _consented_child(db)
    _login_as_teacher(_center(db))

    response = client.post(
        f"/api/v1/children/{child_id}/consents/revoke", json={"consent_type": "face_feature"}
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert _count(db, FaceEmbedding) == 1


def test_학부모는_아직_철회_API를_부를_수_없다(client: TestClient, db: Session):
    _, child_id, _ = _consented_child(db)
    _login_as_parent()

    response = client.post(
        f"/api/v1/children/{child_id}/consents/revoke", json={"consent_type": "face_feature"}
    )

    assert response.status_code == 403
    assert _count(db, FaceEmbedding) == 1
