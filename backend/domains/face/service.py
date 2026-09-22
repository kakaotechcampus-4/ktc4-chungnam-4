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
from datetime import UTC, datetime
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import get_settings
from core.exceptions import EmbeddingDecryptionFailed, EmbeddingKeyNotConfigured
from domains.face.models import EmbeddingLifecycleLog, FaceEmbedding

_FORMAT_VERSION = 1
_NONCE_SIZE = 12
_KEY_SIZE = 32  # AES-256
_FLOAT_SIZE = 4  # float32로 직렬화. ArcFace 임베딩은 512차원
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
        key = base64.b64decode(
            settings.face_embedding_key.get_secret_value(), validate=True
        )
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
        raise EmbeddingDecryptionFailed(
            f"Unsupported embedding format version: {version}"
        )

    key = _load_key(key_ref)
    nonce = embedding_enc[1:_HEADER_SIZE]
    try:
        plaintext = AESGCM(key).decrypt(nonce, embedding_enc[_HEADER_SIZE:], None)
    except InvalidTag as error:
        # 위조·훼손·키 불일치를 구분하지 않습니다. 구분 정보를 주면 공격자에게 단서가 됩니다
        raise EmbeddingDecryptionFailed(
            "Stored embedding failed integrity check"
        ) from error

    if len(plaintext) % _FLOAT_SIZE != 0:
        raise EmbeddingDecryptionFailed(
            "Decrypted embedding length is not a multiple of float32"
        )
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
    # TODO(donggeon): organization.service.get_consented_children 대기 (issue 미등록)
    raise NotImplementedError("organization 동의 판정 함수 대기 중")


def _record_access(db: Session, child_ids: Sequence[UUID]) -> None:
    """임베딩 열람을 AccessLog에 남깁니다 (NFR-05, H-4).

    audit 담당(한상균)에게 요청할 함수로 교체합니다. 기록 대상·보존 기간이
    아직 미정이라(docs/open-questions.md) 무엇을 넘길지도 함께 확인이 필요합니다.
    """
    # TODO(donggeon): audit.service.record_access 대기 (issue 미등록)
    raise NotImplementedError("audit 열람 기록 함수 대기 중")


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


def load_embedding_cache(db: Session, class_id: UUID) -> dict[UUID, list[float]]:
    """분류 배치 시작 시 브라우저로 내려보낼 기준 임베딩 (파이프라인 0단계).

    **동의 레코드와 임베딩을 함께 확인합니다.** 철회 처리가 중간에 실패해 임베딩이
    남아 있더라도 미동의 원아가 대조 대상에 들어가지 않도록, 두 값이 어긋나면
    제외되는 쪽으로 실패시킵니다 (테크스펙 0단계).
    """
    consented = _consented_child_ids(db, class_id)
    if not consented:
        return {}

    rows = db.scalars(
        select(FaceEmbedding).where(FaceEmbedding.child_id.in_(consented))
    ).all()
    _record_access(db, [row.child_id for row in rows])
    return {
        row.child_id: decrypt_embedding(row.embedding_enc, row.key_ref) for row in rows
    }


def get_embedded_child_ids(db: Session, child_ids: Sequence[UUID]) -> set[UUID]:
    """임베딩이 등록된 원아만 골라 돌려줍니다.

    organization의 원아 목록 화면이 "임베딩 등록됨" 표시를 하려면 필요합니다 —
    face 테이블을 직접 조회하지 않도록 이 함수를 제공합니다. 벡터는 넘기지 않습니다.
    """
    if not child_ids:
        return set()
    rows = db.scalars(
        select(FaceEmbedding.child_id).where(FaceEmbedding.child_id.in_(child_ids))
    )
    return set(rows)
