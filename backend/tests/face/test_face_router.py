"""face 라우터 — 임베딩 캐시 조회, 얼굴 정보 등록·삭제 (FR-04, FR-22, NFR-05, H-3).

로그인 교사만 바꿔 끼우고, 반·원아 접근과 동의는 organization 판정 함수가 실제 행으로
판단하게 둡니다. 에러는 FE가 받는 HTTP 상태와 `error.code`로 확인합니다.
"""

import base64
import os
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.config import get_settings
from core.database import get_db
from domains.audit.models import AccessLog, DeletionLog
from domains.auth.middleware import get_current_teacher
from domains.auth.service import TeacherProfile
from domains.face import service
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding
from domains.organization.models import Center, Child, ConsentRecord, Klass
from main import app

VECTOR = [0.1, -0.25, 0.5] * 341 + [1.0]  # 1024차원(HUMAN faceres, #120)
TEACHER_ID = uuid.uuid4()
NOW = datetime(2026, 10, 13, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def 테스트용_키(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    get_settings.cache_clear()
    monkeypatch.setenv("FACE_EMBEDDING_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("FACE_EMBEDDING_KEY_REF", "test-1")
    yield
    get_settings.cache_clear()


@pytest.fixture
def session_factory() -> sessionmaker[Session]:
    # TestClient는 동기 라우트를 다른 스레드에서 돌리므로 연결 하나를 같이 씁니다.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            FaceEmbedding.__table__,
            EmbeddingLifecycleLog.__table__,
            AccessLog.__table__,
            DeletionLog.__table__,
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ConsentRecord.__table__,
        ],
    )
    return sessionmaker(bind=engine)


@pytest.fixture
def center_id(session_factory: sessionmaker[Session]) -> uuid.UUID:
    """로그인 교사가 속한 어린이집."""
    with session_factory() as db:
        return _center(db)


def _login_as(center_id: uuid.UUID | None) -> None:
    app.dependency_overrides[get_current_teacher] = lambda: TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )


@pytest.fixture
def anonymous_client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    """로그인하지 않은 요청. 도메인 예외를 500으로 터뜨리지 않고 응답으로 받습니다."""

    def override_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


@pytest.fixture
def client(anonymous_client: TestClient, center_id: uuid.UUID) -> TestClient:
    _login_as(center_id)
    return anonymous_client


def _center(db: Session) -> uuid.UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.commit()
    return center.id


def _class(db: Session, center_id: uuid.UUID) -> uuid.UUID:
    klass = Klass(center_id=center_id, teacher_id=TEACHER_ID, name="해바라기반", age_group="만 4세")
    db.add(klass)
    db.commit()
    return klass.id


def _child(db: Session, class_id: uuid.UUID, *, consent: str | None = "agreed") -> uuid.UUID:
    """원아 한 명. `consent`는 ③ 얼굴특징정보처리 동의 상태(agreed/revoked, None은 행 없음)."""
    child = Child(
        class_id=class_id,
        name="합성원아",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    if consent is not None:
        db.add(
            ConsentRecord(
                child_id=child.id,
                parent_id=uuid.uuid4(),
                consent_type="face_feature",
                status=consent,
                agreed_at=NOW,
                revoked_at=NOW if consent == "revoked" else None,
            )
        )
    db.commit()
    return child.id


def _error_code(response) -> str:
    return response.json()["error"]["code"]


# ---- 캐시 조회 ----


def _path(class_id: uuid.UUID) -> str:
    return f"/api/v1/classes/{class_id}/face-embeddings"


def test_face_라우터가_main_app에_등록된다() -> None:
    assert ("/api/v1/classes/{class_id}/face-embeddings", "get") in {
        (path, method) for path, methods in app.openapi()["paths"].items() for method in methods
    }


def test_동의_원아의_임베딩과_모델_버전만_내려준다(
    client: TestClient, session_factory: sessionmaker[Session], center_id: uuid.UUID
) -> None:
    """미동의 원아는 임베딩이 남아 있어도 대조 대상에서 빠집니다 (H-3, 테크스펙 0단계)."""
    with session_factory() as db:
        class_id = _class(db, center_id)
        동의한_원아 = _child(db, class_id)
        미동의_원아 = _child(db, class_id, consent=None)
        for child_id in (동의한_원아, 미동의_원아):
            service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
        db.commit()

    response = client.get(_path(class_id))

    assert response.status_code == 200
    body = response.json()
    assert body["next_cursor"] is None
    [item] = body["items"]
    assert item["child_id"] == str(동의한_원아)
    assert item["model_version"] == "test-model-1"
    assert item["embedding"] == pytest.approx(VECTOR, abs=1e-6)
    # 브라우저·프록시가 벡터를 디스크 캐시에 남기지 않게 합니다 (H-3).
    assert response.headers["cache-control"] == "no-store"


def test_응답을_보내기_전에_열람_기록이_커밋된다(
    client: TestClient, session_factory: sessionmaker[Session], center_id: uuid.UUID
) -> None:
    """모든 열람 API 호출이 AccessLog를 남긴다 (NFR-05, backend 필수 테스트 4)."""
    with session_factory() as db:
        child_id = _child(db, _class(db, center_id))
        service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
        db.commit()
        class_id = db.get(Child, child_id).class_id

    response = client.get(_path(class_id))

    assert response.status_code == 200
    # 요청이 쓴 세션과 다른 세션에서 보여야 커밋된 것입니다.
    with session_factory() as db:
        [log] = db.query(AccessLog).all()
        assert (log.actor_id, log.target_type) == (TEACHER_ID, "face_embedding")


def test_다른_어린이집의_반은_403_CLASS_ACCESS_DENIED이고_열람_기록이_없다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """반 id만 바꿔 남의 어린이집 임베딩을 받아 가지 못합니다 (FR-25)."""
    with session_factory() as db:
        other_class = _class(db, _center(db))
        service.register_embedding(db, _child(db, other_class), VECTOR, model_version="m")
        db.commit()

    response = client.get(_path(other_class))

    assert response.status_code == 403
    assert _error_code(response) == "CLASS_ACCESS_DENIED"
    with session_factory() as db:
        assert db.query(AccessLog).count() == 0


def test_없는_반은_404_CLASS_NOT_FOUND(client: TestClient) -> None:
    response = client.get(_path(uuid.uuid4()))

    assert response.status_code == 404
    assert _error_code(response) == "CLASS_NOT_FOUND"


def test_소속_어린이집이_없는_교사는_어느_반에도_접근하지_못한다(
    anonymous_client: TestClient, session_factory: sessionmaker[Session], center_id: uuid.UUID
) -> None:
    """가입 코드로 소속을 확정하기 전(center_id 없음)에는 막습니다 (FR-23)."""
    with session_factory() as db:
        class_id = _class(db, center_id)
    _login_as(None)

    response = anonymous_client.get(_path(class_id))

    assert response.status_code == 403
    assert _error_code(response) == "CLASS_ACCESS_DENIED"


def test_로그인하지_않으면_401_UNAUTHENTICATED(anonymous_client: TestClient) -> None:
    response = anonymous_client.get(_path(uuid.uuid4()))

    assert response.status_code == 401
    assert _error_code(response) == "UNAUTHENTICATED"


def test_반_id가_UUID가_아니면_422(client: TestClient) -> None:
    assert client.get("/api/v1/classes/not-a-uuid/face-embeddings").status_code == 422


# ---- 등록·삭제 ----


def _register_path(child_id: uuid.UUID) -> str:
    return f"/api/v1/children/{child_id}/face-embedding"


def _register(client: TestClient, child_id: uuid.UUID, model_version: str = "human-1"):
    return client.put(
        _register_path(child_id), json={"embedding": VECTOR, "model_version": model_version}
    )


@pytest.fixture
def child_id(session_factory: sessionmaker[Session], center_id: uuid.UUID) -> uuid.UUID:
    """로그인 교사의 어린이집에 있는 ③ 동의 원아."""
    with session_factory() as db:
        return _child(db, _class(db, center_id))


def test_등록하면_벡터는_돌려주지_않고_모델_버전과_시각만_준다(
    client: TestClient, session_factory: sessionmaker[Session], child_id: uuid.UUID
) -> None:
    response = _register(client, child_id)

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"child_id", "model_version", "registered_at"}  # 벡터 없음 (H-3)
    assert (body["child_id"], body["model_version"]) == (str(child_id), "human-1")
    with session_factory() as other:  # 커밋됐는지
        assert other.query(FaceEmbedding).filter_by(child_id=child_id).count() == 1


def test_다시_등록하면_덮어쓰고_갱신_시각을_준다(
    client: TestClient, session_factory: sessionmaker[Session], child_id: uuid.UUID
) -> None:
    first = _register(client, child_id, "human-1")

    again = _register(client, child_id, "human-2")

    assert again.json()["model_version"] == "human-2"
    assert again.json()["registered_at"] >= first.json()["registered_at"]
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 1  # 원아당 한 개


@pytest.mark.parametrize("consent", [None, "revoked"], ids=["동의_없음", "철회"])
def test_동의가_없는_원아는_403_FACE_CONSENT_REQUIRED이고_저장하지_않는다(
    client: TestClient,
    session_factory: sessionmaker[Session],
    center_id: uuid.UUID,
    consent: str | None,
) -> None:
    """③ 미동의 원아의 얼굴 정보가 서버에 저장되면 안 됩니다 (H-3, FR-28)."""
    with session_factory() as db:
        미동의_원아 = _child(db, _class(db, center_id), consent=consent)

    response = _register(client, 미동의_원아)

    assert response.status_code == 403
    assert _error_code(response) == "FACE_CONSENT_REQUIRED"
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 0


def test_다른_어린이집_원아는_등록도_삭제도_403_CHILD_ACCESS_DENIED(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """원아 id만 바꿔 남의 어린이집 원아의 얼굴 정보를 다루지 못합니다 (FR-25)."""
    with session_factory() as db:
        남의_원아 = _child(db, _class(db, _center(db)))
        service.register_embedding(db, 남의_원아, VECTOR, model_version="m")
        db.commit()

    registered = _register(client, 남의_원아)
    deleted = client.delete(_register_path(남의_원아))

    assert (registered.status_code, _error_code(registered)) == (403, "CHILD_ACCESS_DENIED")
    assert (deleted.status_code, _error_code(deleted)) == (403, "CHILD_ACCESS_DENIED")
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 1  # 지워지지 않음
        assert other.query(DeletionLog).count() == 0


def test_없는_원아는_404_CHILD_NOT_FOUND(client: TestClient) -> None:
    response = _register(client, uuid.uuid4())

    assert response.status_code == 404
    assert _error_code(response) == "CHILD_NOT_FOUND"


@pytest.mark.parametrize(
    "body",
    [
        {"embedding": [], "model_version": "human-1"},
        {"embedding": ["a"], "model_version": "human-1"},
        {"embedding": VECTOR, "model_version": ""},
        {"embedding": VECTOR},
    ],
)
def test_등록_요청_모양이_틀리면_422(client: TestClient, child_id: uuid.UUID, body: dict) -> None:
    assert client.put(_register_path(child_id), json=body).status_code == 422


def test_삭제하면_204이고_파기_기록이_남는다(
    client: TestClient, session_factory: sessionmaker[Session], child_id: uuid.UUID
) -> None:
    _register(client, child_id)

    response = client.delete(_register_path(child_id))

    assert response.status_code == 204
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 0
        [deletion] = other.query(DeletionLog).all()
        assert deletion.reason == "teacher_removed"  # 교사가 얼굴 정보만 지움, 동의는 그대로


def test_지울_것이_없어도_204(client: TestClient, child_id: uuid.UUID) -> None:
    assert client.delete(_register_path(child_id)).status_code == 204
