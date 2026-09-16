"""얼굴 임베딩 암복호화 (NFR-01, H-3).

벡터는 애플리케이션 레벨 AES-GCM으로 암호화해 `FaceEmbedding.embedding_enc`(bytea)에 넣습니다.
평문 벡터는 DB·로그·예외 메시지 어디에도 남기지 않습니다 (H-4).

저장 형식: `버전(1바이트) || nonce(12바이트) || 암호문+태그`
버전을 앞에 둬서 나중에 형식이 바뀌어도 기존 행을 구분해 읽을 수 있습니다.
"""

import base64
import os
import struct
from collections.abc import Sequence

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from core.config import get_settings
from core.exceptions import EmbeddingDecryptionFailed, EmbeddingKeyNotConfigured

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

    key = base64.b64decode(settings.face_embedding_key.get_secret_value(), validate=True)
    if len(key) != _KEY_SIZE:
        raise EmbeddingKeyNotConfigured(f"FACE_EMBEDDING_KEY must be {_KEY_SIZE} bytes when decoded")
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
