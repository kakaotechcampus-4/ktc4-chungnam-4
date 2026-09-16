import base64
import os

import pytest

from core.config import get_settings
from core.exceptions import EmbeddingDecryptionFailed, EmbeddingKeyNotConfigured
from domains.face.service import decrypt_embedding, encrypt_embedding


@pytest.fixture(autouse=True)
def 테스트용_키(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    monkeypatch.setenv("FACE_EMBEDDING_KEY", base64.b64encode(os.urandom(32)).decode())
    monkeypatch.setenv("FACE_EMBEDDING_KEY_REF", "test-1")
    yield
    get_settings.cache_clear()


def test_암호화한_임베딩은_원래_벡터로_복호화된다() -> None:
    vector = [0.1, -0.25, 0.5] * 170 + [0.0, 1.0]  # 512차원
    embedding_enc, key_ref = encrypt_embedding(vector)

    restored = decrypt_embedding(embedding_enc, key_ref)

    assert len(restored) == len(vector)
    assert restored == pytest.approx(vector, abs=1e-6)  # float32 저장이라 오차 허용


def test_같은_벡터라도_매번_다른_암호문이_나온다() -> None:
    vector = [0.1, 0.2, 0.3]

    first, _ = encrypt_embedding(vector)
    second, _ = encrypt_embedding(vector)

    assert first != second  # nonce가 매번 달라야 패턴이 드러나지 않습니다


def test_암호문이_훼손되면_복호화하지_않는다() -> None:
    vector = [0.1, 0.2, 0.3]
    embedding_enc, key_ref = encrypt_embedding(vector)
    훼손 = bytearray(embedding_enc)
    훼손[-1] ^= 0x01

    with pytest.raises(EmbeddingDecryptionFailed):
        decrypt_embedding(bytes(훼손), key_ref)


def test_모르는_key_ref는_거부한다() -> None:
    vector = [0.1, 0.2, 0.3]
    embedding_enc, _ = encrypt_embedding(vector)

    with pytest.raises(EmbeddingKeyNotConfigured):
        decrypt_embedding(embedding_enc, "unknown-key")


def test_빈_벡터는_암호화하지_않는다() -> None:
    with pytest.raises(ValueError):
        encrypt_embedding([])
