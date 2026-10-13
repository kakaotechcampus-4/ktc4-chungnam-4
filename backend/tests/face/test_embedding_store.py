"""임베딩 저장·조회 (NFR-01, H-2, H-3).

반 접근과 동의는 organization 판정 함수가 실제 행으로 판단하게 둡니다.
"""

import base64
import os
import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.config import get_settings
from core.exceptions import ClassAccessDenied, EmbeddingDecryptionFailed
from domains.audit.models import AccessLog, DeletionLog
from domains.face import service
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding
from domains.organization.models import Center, Child, ConsentRecord, Klass

VECTOR = [0.1, -0.25, 0.5] * 341 + [1.0]  # 1024차원(HUMAN faceres, #120)


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
    with Session(engine) as session:
        yield session


def test_등록하면_암호문으로_저장되고_이력이_남는다(db: Session) -> None:
    child_id = uuid.uuid4()

    embedding = service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    db.commit()

    assert VECTOR[0] != 0 and bytes(str(VECTOR[0]), "utf-8") not in embedding.embedding_enc
    logs = db.query(EmbeddingLifecycleLog).all()
    assert [log.event_type for log in logs] == ["register"]


def test_다시_등록하면_갱신되고_재등록_이력이_쌓인다(db: Session) -> None:
    child_id = uuid.uuid4()
    service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    db.commit()

    service.register_embedding(db, child_id, VECTOR, model_version="test-model-2")
    db.commit()

    assert db.query(FaceEmbedding).count() == 1  # 원아당 1개
    assert [log.event_type for log in db.query(EmbeddingLifecycleLog).all()] == [
        "register",
        "re_register",
    ]


def _center(db: Session) -> uuid.UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _class(db: Session, center_id: uuid.UUID) -> uuid.UUID:
    klass = Klass(
        center_id=center_id, teacher_id=uuid.uuid4(), name="해바라기반", age_group="만 4세"
    )
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: uuid.UUID, *, consented: bool = True) -> uuid.UUID:
    """원아 한 명. 기준 임베딩도 함께 등록합니다. `consented`면 ③ 동의 행을 둡니다."""
    child = Child(
        class_id=class_id,
        name="합성원아",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    if consented:
        db.add(
            ConsentRecord(
                child_id=child.id,
                parent_id=uuid.uuid4(),
                consent_type="face_feature",
                status="agreed",
                agreed_at=datetime.now(UTC),
            )
        )
    service.register_embedding(db, child.id, VECTOR, model_version="test-model-1")
    db.commit()
    return child.id


def test_동의한_원아의_임베딩만_캐시로_내려간다(db: Session) -> None:
    """미동의 원아는 임베딩이 남아 있어도 대조 대상에서 빠집니다 (H-2, 테크스펙 0단계)."""
    center_id = _center(db)
    class_id = _class(db, center_id)
    동의한_원아 = _child(db, class_id)
    _child(db, class_id, consented=False)
    teacher_id = uuid.uuid4()

    [cached] = service.load_embedding_cache(
        db, class_id, teacher_id=teacher_id, center_id=center_id
    )

    assert cached.child_id == 동의한_원아
    assert cached.embedding == pytest.approx(VECTOR, abs=1e-6)
    assert cached.model_version == "test-model-1"
    # 내려보낸 임베딩만 열람 기록이 남고, 대상은 원아가 아니라 임베딩 id입니다 (#32).
    [log] = db.query(AccessLog).all()
    embedding_id = db.query(FaceEmbedding.id).filter_by(child_id=동의한_원아).scalar()
    assert (log.actor_id, log.target_type, log.target_id) == (
        teacher_id,
        "face_embedding",
        embedding_id,
    )


def test_다른_어린이집의_반이면_임베딩도_열람_기록도_남지_않는다(db: Session) -> None:
    """반 id만 바꿔 남의 어린이집 임베딩을 받아 가지 못합니다 (FR-25)."""
    class_id = _class(db, _center(db))
    _child(db, class_id)

    with pytest.raises(ClassAccessDenied):
        service.load_embedding_cache(db, class_id, teacher_id=uuid.uuid4(), center_id=_center(db))
    assert db.query(AccessLog).count() == 0


def test_복호화가_실패하면_열람_기록을_남기지_않는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """내보내지 못한 임베딩에 '열람했다'는 기록이 남으면 감사 로그가 사실과 달라집니다."""
    center_id = _center(db)
    class_id = _class(db, center_id)
    _child(db, class_id)
    monkeypatch.setenv("FACE_EMBEDDING_KEY", base64.b64encode(os.urandom(32)).decode())
    get_settings.cache_clear()  # 다른 키로 바꿔 복호화를 실패시킵니다

    with pytest.raises(EmbeddingDecryptionFailed):
        service.load_embedding_cache(db, class_id, teacher_id=uuid.uuid4(), center_id=center_id)
    assert db.query(AccessLog).count() == 0


def test_임베딩이_등록된_원아만_골라준다(db: Session) -> None:
    등록됨 = uuid.uuid4()
    미등록 = uuid.uuid4()
    service.register_embedding(db, 등록됨, VECTOR, model_version="test-model-1")
    db.commit()

    assert service.get_embedded_child_ids(db, [등록됨, 미등록]) == {등록됨}


def test_삭제하면_파기_기록과_생애주기_로그를_남긴다(db: Session) -> None:
    child_id = uuid.uuid4()
    embedding = service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    embedding_id = embedding.id
    db.commit()

    assert service.delete_embedding(db, child_id, reason="teacher_removed") is True
    db.commit()

    assert db.query(FaceEmbedding).count() == 0
    [deletion] = db.query(DeletionLog).all()
    # 지운 뒤에도 무엇을 지웠는지 알 수 있게 임베딩 id를 남깁니다(#74).
    assert (deletion.target_type, deletion.target_id, deletion.reason) == (
        "face_embedding",
        embedding_id,
        "teacher_removed",
    )
    assert [log.event_type for log in db.query(EmbeddingLifecycleLog).all()] == [
        "register",
        "teacher_removed",
    ]


def test_지울_임베딩이_없으면_아무것도_남기지_않는다(db: Session) -> None:
    assert service.delete_embedding(db, uuid.uuid4(), reason="consent_revoked") is False
    assert db.query(DeletionLog).count() == 0
    assert db.query(EmbeddingLifecycleLog).count() == 0


def test_정해진_사유가_아니면_지우지_않는다(db: Session) -> None:
    child_id = uuid.uuid4()
    service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    db.commit()

    with pytest.raises(ValueError) as exc:
        service.delete_embedding(db, child_id, reason="CHILD_A 부모 요청")

    # 잘못된 입력값이 예외 메시지(=로그)에 그대로 남지 않아야 합니다 (H-4).
    assert "CHILD_A" not in str(exc.value)
    assert db.query(FaceEmbedding).count() == 1


def test_호출자가_롤백하면_삭제와_로그가_모두_취소된다(db: Session) -> None:
    child_id = uuid.uuid4()
    service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    db.commit()

    service.delete_embedding(db, child_id, reason="teacher_removed")
    db.rollback()

    assert db.query(FaceEmbedding).count() == 1
    assert db.query(DeletionLog).count() == 0
    assert [log.event_type for log in db.query(EmbeddingLifecycleLog).all()] == ["register"]


def test_파기_기록이_실패하면_예외가_전달되고_임베딩이_남는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    child_id = uuid.uuid4()
    service.register_embedding(db, child_id, VECTOR, model_version="test-model-1")
    db.commit()

    def fail(*args: object, **kwargs: object) -> None:
        raise RuntimeError("audit failed")

    monkeypatch.setattr(service.audit, "record_deletion", fail)

    with pytest.raises(RuntimeError):
        service.delete_embedding(db, child_id, reason="teacher_removed")
    db.rollback()

    assert db.query(FaceEmbedding).count() == 1
