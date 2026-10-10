"""face 라우터 — 임베딩 캐시 조회, 얼굴 정보 등록·삭제 (FR-04, FR-22, NFR-05, H-3).

인증·반 접근·동의 판정은 아직 다른 담당의 함수가 없어 테스트에서만 바꿔 끼웁니다.
"""

import base64
import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.config import get_settings
from core.database import get_db
from core.exceptions import FaceConsentRequired
from domains.audit.models import AccessLog, DeletionLog
from domains.face import router as face_router
from domains.face import service
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding
from main import app

VECTOR = [0.1, -0.25, 0.5] * 341 + [1.0]  # 1024차원(HUMAN faceres, #120)
TEACHER_ID = uuid.uuid4()
CLASS_ID = uuid.uuid4()


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
        ],
    )
    return sessionmaker(bind=engine)


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    def override_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[face_router.get_current_teacher_id] = lambda: TEACHER_ID
    # 실제 함수가 없는 동안 예외가 그대로 보이도록 500으로 바꾸지 않습니다.
    yield TestClient(app)
    app.dependency_overrides.clear()


def _path(class_id: uuid.UUID = CLASS_ID) -> str:
    return f"/classes/{class_id}/face-embeddings"


def test_face_라우터가_main_app에_등록된다() -> None:
    assert ("/classes/{class_id}/face-embeddings", "get") in {
        (path, method) for path, methods in app.openapi()["paths"].items() for method in methods
    }


def test_동의_원아의_임베딩과_모델_버전을_내려준다(
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    동의한_원아 = uuid.uuid4()
    미동의_원아 = uuid.uuid4()
    with session_factory() as db:
        service.register_embedding(db, 동의한_원아, VECTOR, model_version="test-model-1")
        service.register_embedding(db, 미동의_원아, VECTOR, model_version="test-model-1")
        db.commit()
    monkeypatch.setattr(service, "_ensure_class_access", lambda db, class_id, teacher_id: None)
    monkeypatch.setattr(service, "_consented_child_ids", lambda db, class_id: [동의한_원아])

    response = client.get(_path())

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
    client: TestClient,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """모든 열람 API 호출이 AccessLog를 남긴다 (NFR-05, backend 필수 테스트 4)."""
    child_id = uuid.uuid4()
    with session_factory() as db:
        service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
        db.commit()
    monkeypatch.setattr(service, "_ensure_class_access", lambda db, class_id, teacher_id: None)
    monkeypatch.setattr(service, "_consented_child_ids", lambda db, class_id: [child_id])

    client.get(_path())

    # 요청이 쓴 세션과 다른 세션에서 보여야 커밋된 것입니다.
    with session_factory() as db:
        [log] = db.query(AccessLog).all()
        assert (log.actor_id, log.target_type) == (TEACHER_ID, "face_embedding")


def test_반_접근_검사에_로그인한_교사와_경로의_반을_넘긴다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[uuid.UUID, uuid.UUID]] = []

    def 기록(db: Session, class_id: uuid.UUID, teacher_id: uuid.UUID) -> None:
        seen.append((class_id, teacher_id))

    monkeypatch.setattr(service, "_ensure_class_access", 기록)
    monkeypatch.setattr(service, "_consented_child_ids", lambda db, class_id: [])

    response = client.get(_path())

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert seen == [(CLASS_ID, TEACHER_ID)]


def test_판정_함수가_없으면_빈_목록이_아니라_실패한다(client: TestClient) -> None:
    """빈 목록으로 대신하면 FE가 '등록된 원아 없음'으로 착각하고 전부 수동 분류로 보냅니다."""
    with pytest.raises(NotImplementedError):
        client.get(_path())


def test_반_id가_UUID가_아니면_422(client: TestClient) -> None:
    assert client.get("/classes/not-a-uuid/face-embeddings").status_code == 422


CHILD_ID = uuid.uuid4()
실제_원아_동의_판정 = service._has_face_consent


def _register_path(child_id: uuid.UUID = CHILD_ID) -> str:
    return f"/children/{child_id}/face-embedding"


@pytest.fixture
def 원아_접근_통과(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "_ensure_child_access", lambda db, child_id, teacher_id: None)
    monkeypatch.setattr(service, "_has_face_consent", lambda db, child_id: True)


@pytest.mark.usefixtures("원아_접근_통과")
def test_등록하면_벡터는_돌려주지_않고_모델_버전과_시각만_준다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"child_id", "model_version", "registered_at"}  # 벡터 없음 (H-3)
    assert (body["child_id"], body["model_version"]) == (str(CHILD_ID), "human-1")
    with session_factory() as other:  # 커밋됐는지
        assert other.query(FaceEmbedding).filter_by(child_id=CHILD_ID).count() == 1


@pytest.mark.usefixtures("원아_접근_통과")
def test_다시_등록하면_덮어쓰고_갱신_시각을_준다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    first = client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})

    again = client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-2"})

    assert again.json()["model_version"] == "human-2"
    assert again.json()["registered_at"] >= first.json()["registered_at"]
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 1  # 원아당 한 개


def test_동의가_없는_원아는_등록하지_않는다(
    client: TestClient, session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """③ 미동의 원아의 얼굴 정보가 서버에 저장되면 안 됩니다 (H-3, FR-28)."""
    monkeypatch.setattr(service, "_ensure_child_access", lambda db, child_id, teacher_id: None)
    monkeypatch.setattr(service, "_has_face_consent", lambda db, child_id: False)

    # TODO(엄태은): 전역 예외 핸들러가 생기면 403 FACE_CONSENT_REQUIRED 응답 확인으로 바꿉니다.
    with pytest.raises(FaceConsentRequired):
        client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 0


@pytest.mark.parametrize(
    "body",
    [
        {"embedding": [], "model_version": "human-1"},
        {"embedding": ["a"], "model_version": "human-1"},
        {"embedding": VECTOR, "model_version": ""},
        {"embedding": VECTOR},
    ],
)
def test_등록_요청_모양이_틀리면_422(client: TestClient, body: dict) -> None:
    assert client.put(_register_path(), json=body).status_code == 422


@pytest.mark.usefixtures("원아_접근_통과")
def test_삭제하면_204이고_파기_기록이_남는다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})

    response = client.delete(_register_path())

    assert response.status_code == 204
    with session_factory() as other:
        assert other.query(FaceEmbedding).count() == 0
        [deletion] = other.query(DeletionLog).all()
        assert deletion.reason == "teacher_removed"  # 교사가 얼굴 정보만 지움, 동의는 그대로


@pytest.mark.usefixtures("원아_접근_통과")
def test_지울_것이_없어도_204(client: TestClient) -> None:
    assert client.delete(_register_path(uuid.uuid4())).status_code == 204


def test_원아_접근_판정_함수가_없으면_등록도_삭제도_막힌다(client: TestClient) -> None:
    """임시로 통과시키면 다른 어린이집 교사가 원아 id만 바꿔 얼굴 정보를 다룹니다."""
    with pytest.raises(NotImplementedError, match="원아 접근"):
        client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})
    with pytest.raises(NotImplementedError, match="원아 접근"):
        client.delete(_register_path())


def test_동의_판정_함수가_없으면_등록이_막힌다(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "_ensure_child_access", lambda db, child_id, teacher_id: None)
    monkeypatch.setattr(service, "_has_face_consent", 실제_원아_동의_판정)

    with pytest.raises(NotImplementedError, match="동의"):
        client.put(_register_path(), json={"embedding": VECTOR, "model_version": "human-1"})
