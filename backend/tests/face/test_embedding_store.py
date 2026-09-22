"""임베딩 저장·조회 (NFR-01, H-2, H-3).

다른 도메인 함수(동의 판정·열람 기록)는 아직 없어 목으로 대체합니다.
"""

import base64
import os
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.config import get_settings
from domains.face import service
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding

VECTOR = [0.1, -0.25, 0.5] * 170 + [0.0, 1.0]  # 512차원


@pytest.fixture(autouse=True)
def 테스트용_키(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("FACE_EMBEDDING_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("FACE_EMBEDDING_KEY_REF", "test-1")
    yield
    get_settings.cache_clear()


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine, tables=[FaceEmbedding.__table__, EmbeddingLifecycleLog.__table__]
    )
    with Session(engine) as session:
        yield session


def test_등록하면_암호문으로_저장되고_이력이_남는다(db: Session) -> None:
    child_id = uuid.uuid4()

    embedding = service.register_embedding(db, child_id, VECTOR, model_version="buffalo_l-1.0")
    db.commit()

    assert VECTOR[0] != 0 and bytes(str(VECTOR[0]), "utf-8") not in embedding.embedding_enc
    logs = db.query(EmbeddingLifecycleLog).all()
    assert [log.event_type for log in logs] == ["register"]


def test_다시_등록하면_갱신되고_재등록_이력이_쌓인다(db: Session) -> None:
    child_id = uuid.uuid4()
    service.register_embedding(db, child_id, VECTOR, model_version="buffalo_l-1.0")
    db.commit()

    service.register_embedding(db, child_id, VECTOR, model_version="buffalo_l-2.0")
    db.commit()

    assert db.query(FaceEmbedding).count() == 1  # 원아당 1개
    assert [log.event_type for log in db.query(EmbeddingLifecycleLog).all()] == [
        "register",
        "re_register",
    ]


def test_동의한_원아의_임베딩만_캐시로_내려간다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """미동의 원아는 임베딩이 남아 있어도 대조 대상에서 빠집니다 (H-2, 테크스펙 0단계)."""
    동의한_원아 = uuid.uuid4()
    미동의_원아 = uuid.uuid4()
    for child_id in (동의한_원아, 미동의_원아):
        service.register_embedding(db, child_id, VECTOR, model_version="buffalo_l-1.0")
    db.commit()
    monkeypatch.setattr(service, "_consented_child_ids", lambda db, class_id: [동의한_원아])
    monkeypatch.setattr(service, "_record_access", lambda db, child_ids: None)

    cache = service.load_embedding_cache(db, uuid.uuid4())

    assert set(cache) == {동의한_원아}
    assert cache[동의한_원아] == pytest.approx(VECTOR, abs=1e-6)


def test_동의_판정_함수가_없으면_조회가_실패한다(db: Session) -> None:
    """목이 값을 돌려주면 미동의 원아가 조용히 통과하므로, 구현 전에는 터져야 합니다."""
    with pytest.raises(NotImplementedError):
        service.load_embedding_cache(db, uuid.uuid4())


def test_임베딩이_등록된_원아만_골라준다(db: Session) -> None:
    등록됨 = uuid.uuid4()
    미등록 = uuid.uuid4()
    service.register_embedding(db, 등록됨, VECTOR, model_version="buffalo_l-1.0")
    db.commit()

    assert service.get_embedded_child_ids(db, [등록됨, 미등록]) == {등록됨}
