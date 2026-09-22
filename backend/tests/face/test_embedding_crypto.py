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


def test_키_자리에_안내_문구가_남아_있으면_설정_누락으로_올라간다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`.env.example`을 복사한 뒤 키를 생성하지 않은 상태입니다.

    base64 디코드 실패(`binascii.Error`)가 그대로 새어나가면 받는 사람이
    "글자가 이상하다"로 읽어 무엇을 해야 할지 알 수 없습니다.
    """
    get_settings.cache_clear()
    monkeypatch.setenv("FACE_EMBEDDING_KEY", "replace-with-a-generated-base64-key")

    with pytest.raises(EmbeddingKeyNotConfigured) as error:
        encrypt_embedding([0.1, 0.2, 0.3])

    assert "base64" in str(error.value)  # 생성 명령을 함께 안내합니다
    assert "replace-with-a-generated-base64-key" not in str(error.value)  # 키 값 미포함 (H-4)
