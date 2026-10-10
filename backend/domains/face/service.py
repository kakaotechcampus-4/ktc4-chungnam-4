"""얼굴 임베딩 암복호화 (NFR-01, H-3).

벡터는 애플리케이션 레벨 AES-GCM으로 암호화해 `FaceEmbedding.embedding_enc`(bytea)에 넣습니다.
평문 벡터는 DB·로그·예외 메시지 어디에도 남기지 않습니다 (H-4).

저장 형식: `버전(1바이트) || nonce(12바이트) || 암호문+태그`
버전을 앞에 둬서 나중에 형식이 바뀌어도 기존 행을 구분해 읽을 수 있습니다.
"""

import base64
import binascii
import os
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from core.exceptions import (
    EmbeddingDecryptionFailed,
    EmbeddingKeyNotConfigured,
    FaceConsentRequired,
)
from domains.audit import service as audit
from domains.audit.models import DeletionReason
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding

_FORMAT_VERSION = 1
_NONCE_SIZE = 12
_KEY_SIZE = 32  # AES-256
_FLOAT_SIZE = (
    4  # float32로 직렬화. 차원 수는 모델마다 달라 고정하지 않습니다(HUMAN faceres는 1024, #120)
)
_HEADER_SIZE = 1 + _NONCE_SIZE


def _load_key(key_ref: str) -> bytes:
    """key_ref에 해당하는 AES 키를 설정에서 읽습니다.

    현재는 키 하나만 지원합니다. 요청된 key_ref가 설정값과 다르면 거부합니다 —
    조용히 현재 키로 복호화를 시도하면 키 교체 시 실패를 놓칩니다.
    """
    settings = get_settings()
    if key_ref != settings.face_embedding_key_ref:
        # TODO(donggeon): 키 교체(rotation)를 도입하면 과거 key_ref도 읽을 수 있어야 합니다
        raise EmbeddingKeyNotConfigured(f"Unknown key_ref: {key_ref}")
    if settings.face_embedding_key is None:
        raise EmbeddingKeyNotConfigured("FACE_EMBEDDING_KEY is not set")

    try:
        key = base64.b64decode(settings.face_embedding_key.get_secret_value(), validate=True)
    except binascii.Error as error:
        # .env.example의 안내 문구가 그대로 들어온 경우가 대부분입니다. 위 `is None` 검사는
        # 값이 "있으므로" 통과하고 여기서 터지므로, 무엇을 해야 하는지 메시지로 알려줍니다.
        # 키 값 자체는 메시지에 넣지 않습니다 (H-4).
        raise EmbeddingKeyNotConfigured(
            "FACE_EMBEDDING_KEY is not valid base64. Generate one with: "
            'python3 -c "import base64,os;print(base64.b64encode(os.urandom(32)).decode())"'
        ) from error
    if len(key) != _KEY_SIZE:
        raise EmbeddingKeyNotConfigured(
            f"FACE_EMBEDDING_KEY must be {_KEY_SIZE} bytes when decoded"
        )
    return key


def encrypt_embedding(vector: Sequence[float]) -> tuple[bytes, str]:
    """임베딩 벡터를 암호화해 (암호문, key_ref)를 돌려줍니다.

    반환한 두 값을 각각 `FaceEmbedding.embedding_enc`·`key_ref`에 그대로 저장합니다.
    """
    if not vector:
        raise ValueError("Embedding vector must not be empty")

    key_ref = get_settings().face_embedding_key_ref
    key = _load_key(key_ref)

    plaintext = struct.pack(f"<{len(vector)}f", *vector)
    nonce = os.urandom(_NONCE_SIZE)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return bytes([_FORMAT_VERSION]) + nonce + ciphertext, key_ref


def decrypt_embedding(embedding_enc: bytes, key_ref: str) -> list[float]:
    """저장된 암호문을 복호화해 임베딩 벡터를 돌려줍니다.

    실패 사유(키 불일치·훼손)를 예외 메시지에 벡터 값 없이 남깁니다 (H-4).
    """
    if len(embedding_enc) <= _HEADER_SIZE:
        raise EmbeddingDecryptionFailed("Stored embedding is too short to be valid")

    version = embedding_enc[0]
    if version != _FORMAT_VERSION:
        raise EmbeddingDecryptionFailed(f"Unsupported embedding format version: {version}")

    key = _load_key(key_ref)
    nonce = embedding_enc[1:_HEADER_SIZE]
    try:
        plaintext = AESGCM(key).decrypt(nonce, embedding_enc[_HEADER_SIZE:], None)
    except InvalidTag as error:
        # 위조·훼손·키 불일치를 구분하지 않습니다. 구분 정보를 주면 공격자에게 단서가 됩니다
        raise EmbeddingDecryptionFailed("Stored embedding failed integrity check") from error

    if len(plaintext) % _FLOAT_SIZE != 0:
        raise EmbeddingDecryptionFailed("Decrypted embedding length is not a multiple of float32")
    return list(struct.unpack(f"<{len(plaintext) // _FLOAT_SIZE}f", plaintext))


# ---------------------------------------------------------------------------
# 저장·조회 (DB)
# ---------------------------------------------------------------------------
#
# 다른 도메인의 테이블은 직접 조회하지 않습니다. 필요한 것은 아래 목 함수로 두고
# 담당자에게 함수를 요청합니다. **값을 돌려주는 임시 구현을 넣지 않습니다** —
# 동의 판정이 임시로 통과되면 미동의 원아가 조용히 대조 대상에 들어갑니다 (H-2, H-3).


def _consented_child_ids(db: Session, class_id: UUID) -> list[UUID]:
    """반에서 ③`얼굴특징정보처리` 동의가 유효한 재원 원아 id.

    organization 담당(이한나)에게 요청한 함수로 교체합니다:
        get_consented_children(db, class_id, consent_type) -> list[UUID]
    """
    # TODO(donggeon): organization.service.get_consented_children 대기 (#105)
    raise NotImplementedError("organization 동의 판정 함수 대기 중")


def _ensure_class_access(db: Session, class_id: UUID, teacher_id: UUID) -> None:
    """교사가 이 반을 볼 수 있는지 확인하고, 아니면 예외를 올립니다.

    같은 어린이집(center) 소속 교사는 모든 반에 접근합니다(FR-25, 담당교사 개념 폐지).
    반은 organization, 교사는 auth 소유라 face가 직접 조회하지 않습니다. 담당자에게 요청할
    함수로 교체합니다. 없는 반은 `CLASS_NOT_FOUND`(404), 다른 어린이집 반은
    `CLASS_ACCESS_DENIED`(403)입니다 (docs/api/media-face.md).

    `_consented_child_ids`와 같은 이유로 통과시키는 임시 구현을 넣지 않습니다 — 임시로
    통과되면 다른 어린이집 교사가 반 id만 바꿔 임베딩을 받아 갑니다.
    """
    # TODO(donggeon): organization 반 접근 판정 함수 요청 예정 (이슈 미작성)
    raise NotImplementedError("반 접근 판정 함수 대기 중")


def _ensure_child_access(db: Session, child_id: UUID, teacher_id: UUID) -> None:
    """교사가 이 원아의 얼굴 정보를 다룰 수 있는지 확인합니다.

    원아가 교사와 같은 어린이집의 반에 있어야 합니다(FR-25). 없는 원아는 `CHILD_NOT_FOUND`,
    다른 어린이집 원아는 `CHILD_ACCESS_DENIED`입니다(docs/api/media-face.md).
    원아는 organization, 교사는 auth 소유라 담당자 함수로 교체합니다. 통과시키는 임시 구현을
    넣지 않습니다 — 다른 어린이집 교사가 원아 id만 바꿔 얼굴 정보를 등록·삭제할 수 있게 됩니다.
    """
    # TODO(donggeon): organization 원아 접근 판정 함수 요청 예정 (이슈 미작성, 반 접근 판정과 함께)
    raise NotImplementedError("원아 접근 판정 함수 대기 중")


def _has_face_consent(db: Session, child_id: UUID) -> bool:
    """원아의 ③ 얼굴특징정보처리 동의가 지금 유효한지.

    동의 판정은 organization이 맡습니다(#105는 반 단위, 이 자리는 원아 하나). 값을 돌려주는
    임시 구현을 넣지 않습니다 — 미동의 원아의 얼굴 정보가 조용히 저장됩니다(H-3).
    """
    # TODO(donggeon): organization 원아 단위 동의 판정 함수 요청 예정 (#105와 함께)
    raise NotImplementedError("원아 동의 판정 함수 대기 중")


# 감사 로그 코드. audit 담당과 코드 목록을 맞추는 중이라(#32, #74) 값은 여기 한곳에만 둡니다.
_AUDIT_TARGET_TYPE = "face_embedding"
_AUDIT_ACTION_LOAD = "load_for_classification"
# 임베딩을 지우는 이유. DeletionLog.reason과 EmbeddingLifecycleLog.event_type에 같은 값을 남깁니다.
# 사유는 부르는 쪽이 정합니다 — face는 동의 상태를 모르므로 "지웠으니 철회"라고 추측하지 않습니다(#74).
DELETE_REASONS = frozenset({DeletionReason.CONSENT_REVOKED, DeletionReason.TEACHER_REMOVED})


def _record_access(db: Session, teacher_id: UUID, embedding_ids: Sequence[UUID]) -> None:
    """내려보낸 임베딩마다 AccessLog를 남깁니다 (NFR-05, H-4). 벡터 값은 넘기지 않습니다."""
    for embedding_id in embedding_ids:
        audit.record_access(
            db,
            actor_type="teacher",
            actor_id=teacher_id,
            target_type=_AUDIT_TARGET_TYPE,
            target_id=embedding_id,
            action=_AUDIT_ACTION_LOAD,
        )


def register_embedding(
    db: Session,
    child_id: UUID,
    vector: Sequence[float],
    model_version: str,
    device_id: str | None = None,
) -> FaceEmbedding:
    """브라우저가 계산한 임베딩 벡터를 암호화해 저장합니다 (H-3).

    등록용 원본 사진은 이 함수에 들어오지 않습니다 — 벡터만 받습니다.
    원아당 1개라 이미 있으면 갱신하고, 이력에는 재등록으로 남깁니다.
    """
    embedding_enc, key_ref = encrypt_embedding(vector)
    now = datetime.now(UTC)

    embedding = db.scalars(
        select(FaceEmbedding).where(FaceEmbedding.child_id == child_id)
    ).one_or_none()
    if embedding is None:
        embedding = FaceEmbedding(child_id=child_id, registered_at=now)
        db.add(embedding)
        event_type = "register"
    else:
        embedding.updated_at = now
        event_type = "re_register"

    embedding.embedding_enc = embedding_enc
    embedding.key_ref = key_ref
    embedding.model_version = model_version

    db.add(
        EmbeddingLifecycleLog(
            child_id=child_id,
            device_id=device_id,
            event_type=event_type,
            created_at=now,
        )
    )
    db.flush()
    return embedding


@dataclass(frozen=True)
class CachedEmbedding:
    """브라우저로 내려보낼 기준 임베딩 한 건.

    `model_version`을 함께 싣는 이유: 벡터는 같은 모델로 만든 것끼리만 비교할 수 있습니다.
    FE는 브라우저 모델과 버전이 다른 원아를 자동 분류에서 빼고 수동 분류로 보냅니다
    (docs/api/media-face.md, 제안).
    """

    child_id: UUID
    embedding: list[float]
    model_version: str


def load_embedding_cache(db: Session, class_id: UUID, teacher_id: UUID) -> list[CachedEmbedding]:
    """분류 배치 시작 시 브라우저로 내려보낼 기준 임베딩 (파이프라인 0단계).

    **반 접근 권한을 먼저 확인합니다.** 다른 어린이집 교사가 반 id만 바꿔 남의 반 임베딩을
    받아 가지 못하게 하려는 것입니다.

    **동의 레코드와 임베딩을 함께 확인합니다.** 철회 처리가 중간에 실패해 임베딩이
    남아 있더라도 미동의 원아가 대조 대상에 들어가지 않도록, 두 값이 어긋나면
    제외되는 쪽으로 실패시킵니다 (테크스펙 0단계).

    내려보낸 임베딩마다 열람 기록을 남깁니다. 기록은 같은 Session에 flush만 하므로
    커밋은 부른 쪽(라우터)이 합니다. **라우터는 커밋이 성공한 뒤에 임베딩을 응답으로
    돌려줘야 합니다** — 응답이 먼저 나가고 커밋이 실패하면 열람 기록 없이 임베딩이 나갑니다 (NFR-05).
    복호화는 기록보다 먼저 합니다. 하나라도 실패하면 아무것도 내보내지 않고 기록도 남지 않습니다.
    """
    _ensure_class_access(db, class_id, teacher_id)
    consented = _consented_child_ids(db, class_id)
    if not consented:
        return []

    rows = db.scalars(select(FaceEmbedding).where(FaceEmbedding.child_id.in_(consented))).all()
    cache = [
        CachedEmbedding(
            child_id=row.child_id,
            embedding=decrypt_embedding(row.embedding_enc, row.key_ref),
            model_version=row.model_version,
        )
        for row in rows
    ]
    _record_access(db, teacher_id, [row.id for row in rows])
    return cache


def delete_embedding(db: Session, child_id: UUID, reason: str) -> bool:
    """원아의 얼굴 임베딩을 물리 삭제합니다 (FR-22, H-4).

    - 교사의 "얼굴 정보 삭제": `teacher_removed`. 동의는 그대로입니다.
    - 동의 철회: organization이 철회를 저장하면서 `consent_revoked`로 부릅니다(#74).

    지우기 전에 `FaceEmbedding.id`로 파기 기록을 남기고, 생애주기 로그에는 같은 사유를
    남깁니다. flush만 하므로 동의 철회와 한 트랜잭션으로 묶어 부른 쪽이 커밋합니다.
    지울 임베딩이 없으면 아무것도 남기지 않고 False를 돌려줍니다(다시 불러도 결과가 같음).
    """
    if reason not in DELETE_REASONS:
        # 자유 문자열을 받으면 로그에 개인정보가 섞일 수 있습니다 (H-4).
        raise ValueError(
            f"Deletion reason must be one of: {sorted(reason.value for reason in DELETE_REASONS)}"
        )

    embedding = db.scalars(
        select(FaceEmbedding).where(FaceEmbedding.child_id == child_id)
    ).one_or_none()
    if embedding is None:
        return False

    audit.record_deletion(db, target_type=_AUDIT_TARGET_TYPE, target_id=embedding.id, reason=reason)
    db.delete(embedding)
    db.add(
        EmbeddingLifecycleLog(
            child_id=child_id,
            event_type=reason,
            created_at=datetime.now(UTC),
        )
    )
    db.flush()
    return True


def get_embedded_child_ids(db: Session, child_ids: Sequence[UUID]) -> set[UUID]:
    """임베딩이 등록된 원아만 골라 돌려줍니다.

    organization의 원아 목록 화면이 "임베딩 등록됨" 표시를 하려면 필요합니다 —
    face 테이블을 직접 조회하지 않도록 이 함수를 제공합니다. 벡터는 넘기지 않습니다.
    """
    if not child_ids:
        return set()
    rows = db.scalars(select(FaceEmbedding.child_id).where(FaceEmbedding.child_id.in_(child_ids)))
    return set(rows)


@dataclass(frozen=True)
class RegisteredEmbedding:
    """등록 결과. 벡터는 돌려주지 않습니다 (H-3)."""

    child_id: UUID
    model_version: str
    registered_at: datetime


def register_child_embedding(
    db: Session,
    *,
    child_id: UUID,
    teacher_id: UUID,
    vector: Sequence[float],
    model_version: str,
) -> RegisteredEmbedding:
    """얼굴 정보 등록 화면에서 브라우저가 뽑은 벡터를 저장합니다 (FR-04, H-3).

    원아 접근을 확인하고, ③ 동의가 없으면 `FaceConsentRequired`로 거절합니다. 이미 있으면
    덮어씁니다(원아당 한 개). `registered_at`은 마지막으로 등록한 시각이라, 다시 등록하면
    갱신 시각을 돌려줍니다. flush만 하므로 커밋은 부르는 쪽이 합니다.
    """
    _ensure_child_access(db, child_id, teacher_id)
    if not _has_face_consent(db, child_id):
        raise FaceConsentRequired("얼굴 정보 처리에 동의하지 않은 원아예요.")
    embedding = register_embedding(db, child_id, vector, model_version)
    return RegisteredEmbedding(
        child_id=child_id,
        model_version=embedding.model_version,
        registered_at=embedding.updated_at or embedding.registered_at,
    )


def delete_child_embedding(db: Session, *, child_id: UUID, teacher_id: UUID) -> None:
    """얼굴 정보 삭제 화면에서 원아의 임베딩을 지웁니다 (FR-22, H-4).

    교사가 얼굴 정보만 지우는 경우라 사유는 `teacher_removed`입니다(동의는 그대로).
    지울 것이 없어도 같은 결과입니다. flush만 하므로 커밋은 부르는 쪽이 합니다.
    """
    _ensure_child_access(db, child_id, teacher_id)
    delete_embedding(db, child_id, reason=DeletionReason.TEACHER_REMOVED)
