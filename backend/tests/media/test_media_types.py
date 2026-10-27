"""업로드 형식 — MIME 대표값 맞추기와 파일 시그니처 (FR-15).

브라우저의 `file.type`은 확장자에서 온 이름표라 값이 여러 개이고 내용과 다를 수 있습니다.
"""

import pytest

from core.exceptions import MediaTypeNotAllowed
from domains.media import service


@pytest.mark.parametrize(
    ("media_type", "sent", "expected"),
    [
        ("photo", "image/jpeg", "image/jpeg"),
        ("photo", "image/jpg", "image/jpeg"),
        ("photo", "IMAGE/PNG", "image/png"),
        ("photo", "image/heif", "image/heic"),
        ("video", "video/quicktime", "video/quicktime"),
        ("voice_memo", "audio/x-m4a", "audio/mp4"),
        ("voice_memo", "audio/x-wav", "audio/wav"),
        ("voice_memo", "audio/wav; codecs=1", "audio/wav"),
    ],
)
def test_허용된_형식은_대표값으로_바꾼다(media_type: str, sent: str, expected: str) -> None:
    assert service.normalize_content_type(media_type, sent) == expected


@pytest.mark.parametrize(
    ("media_type", "sent"),
    [
        ("photo", "text/html"),
        ("photo", "image/svg+xml"),  # 스크립트를 담을 수 있는 이미지 형식
        ("photo", "video/mp4"),  # 종류와 형식이 맞지 않음
        ("photo", ""),  # 브라우저가 형식을 몰라 비운 경우 — FE가 확장자로 채워야 함
        ("document", "application/pdf"),  # 없는 종류
    ],
)
def test_허용하지_않은_형식은_거절한다(media_type: str, sent: str) -> None:
    with pytest.raises(MediaTypeNotAllowed) as exc:
        service.normalize_content_type(media_type, sent)

    # 클라이언트가 보낸 값이 메시지(=로그)에 그대로 남지 않습니다 (H-4)
    assert sent not in str(exc.value) or sent == ""


def _ftyp(brand: bytes) -> bytes:
    return b"\x00\x00\x00\x18ftyp" + brand + bytes(52)


@pytest.mark.parametrize(
    ("content_type", "head"),
    [
        ("image/jpeg", b"\xff\xd8\xff\xe1" + bytes(60)),
        ("image/png", b"\x89PNG\r\n\x1a\n" + bytes(56)),
        ("image/heic", _ftyp(b"heic")),
        ("image/heic", _ftyp(b"mif1")),
        ("video/mp4", _ftyp(b"isom")),
        ("video/mp4", _ftyp(b"mp42")),
        ("video/quicktime", _ftyp(b"qt  ")),
        ("video/quicktime", b"\x00\x00\x00\x08wide" + bytes(56)),
        ("audio/mp4", _ftyp(b"M4A ")),
        ("audio/wav", b"RIFF\x24\x08\x00\x00WAVEfmt " + bytes(48)),
    ],
)
def test_형식과_앞부분이_맞으면_통과(content_type: str, head: bytes) -> None:
    assert service.matches_signature(content_type, head) is True


@pytest.mark.parametrize(
    ("content_type", "head"),
    [
        ("image/jpeg", b"<!doctype html><html>"),  # 이름만 .jpg로 바꾼 HTML
        ("image/jpeg", b"MZ\x90\x00" + bytes(60)),  # 실행 파일
        ("image/png", b"\xff\xd8\xff\xe0" + bytes(60)),  # JPEG를 png라고 올림
        ("image/heic", _ftyp(b"isom")),  # 영상을 사진이라고 올림
        ("video/mp4", b"\xff\xd8\xff\xe0" + bytes(60)),
        ("audio/wav", b"RIFF\x24\x08\x00\x00AVI LIST" + bytes(48)),  # 같은 RIFF라도 AVI
        ("image/jpeg", b""),  # 빈 파일
    ],
)
def test_형식과_앞부분이_다르면_실패(content_type: str, head: bytes) -> None:
    assert service.matches_signature(content_type, head) is False
