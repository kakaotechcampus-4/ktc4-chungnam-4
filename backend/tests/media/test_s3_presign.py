"""S3 presigned URL 발급·업로드 확인 (FR-15, presigned 스파이크).

서명은 AWS를 부르지 않는 로컬 계산이라 가짜 키로 검증합니다. HeadObject는 botocore
Stubber로 응답을 고정합니다. 테스트가 개발자 PC의 SSO 프로필이나 EC2 롤을 집어 가지 않게
자격증명 탐색 경로를 전부 막습니다.
"""

import io
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from botocore.stub import Stubber

from core.config import get_settings
from core.exceptions import StorageNotConfigured
from domains.media import service

BUCKET = "test-bucket"
KEY = "media/class/photo"


def _clear_caches() -> None:
    get_settings.cache_clear()
    service._s3_session.cache_clear()
    service._s3_client.cache_clear()


@pytest.fixture(autouse=True)
def 격리된_AWS(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[None]:
    for name in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_DEFAULT_PROFILE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATESTONLY")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-only-secret")
    monkeypatch.setenv("S3_BUCKET", BUCKET)
    monkeypatch.delenv("S3_REGION", raising=False)
    monkeypatch.delenv("S3_UPLOAD_URL_EXPIRES_SECONDS", raising=False)
    _clear_caches()
    yield
    _clear_caches()


def _query(url: str) -> dict[str, str]:
    return {name: values[0] for name, values in parse_qs(urlparse(url).query).items()}


def test_서울_리전_호스트로_서명한다() -> None:
    """글로벌 호스트로 서명하면 S3가 307을 주고, 브라우저에서는 CORS 에러처럼 보입니다 (§7)."""
    upload = service.presign_upload(KEY, "image/jpeg", 2048)

    assert urlparse(upload.url).netloc == f"{BUCKET}.s3.ap-northeast-2.amazonaws.com"
    assert "/ap-northeast-2/s3/aws4_request" in _query(upload.url)["X-Amz-Credential"]


def test_크기와_형식을_서명에_못_박는다() -> None:
    """선언한 크기와 1바이트라도 다르면 S3가 거절하도록 서명 대상에 넣습니다 (§10)."""
    upload = service.presign_upload(KEY, "image/jpeg", 2048)

    signed = _query(upload.url)["X-Amz-SignedHeaders"].split(";")
    assert {"content-length", "content-type", "host"} <= set(signed)
    # 브라우저는 Content-Length를 스스로 붙이므로 돌려주는 헤더에는 형식만 있습니다.
    assert upload.headers == {"Content-Type": "image/jpeg"}


def test_기본_유효기간은_1시간이다() -> None:
    before = datetime.now(UTC)

    upload = service.presign_upload(KEY, "video/mp4", 30_000_000)

    assert _query(upload.url)["X-Amz-Expires"] == "3600"
    assert before + timedelta(seconds=3599) <= upload.expires_at
    assert upload.expires_at <= datetime.now(UTC) + timedelta(seconds=3600)


def test_자격증명보다_오래_사는_URL은_잘라낸다(monkeypatch: pytest.MonkeyPatch) -> None:
    """잘라내지 않으면 발급은 성공하고, 자격증명이 만료되는 순간 조용히 죽습니다 (§5)."""
    monkeypatch.setattr(service, "_credential_seconds_left", lambda region: 1000)

    upload = service.presign_upload(KEY, "image/jpeg", 2048)

    assert _query(upload.url)["X-Amz-Expires"] == "700"  # 1000초 - 여유 300초


@pytest.mark.parametrize(
    ("requested", "left", "expected"),
    [
        (3600, None, 3600),  # 고정 키: 만료가 없으니 그대로
        (3600, 28_800, 3600),  # SSO 8시간: 요청값이 더 짧음
        (3600, 1000, 700),
        (3600, 200, 60),  # 곧 만료: 최소 60초는 남겨 발급 자체는 됨
    ],
)
def test_유효기간_잘라내기_규칙(requested: int, left: int | None, expected: int) -> None:
    assert service._clamp_expires_in(requested, left) == expected


def test_만료_시각이_있는_자격증명의_남은_수명을_읽는다(monkeypatch: pytest.MonkeyPatch) -> None:
    class Refreshable:
        _expiry_time = datetime.now(UTC) + timedelta(hours=1)
        frozen = False

        def get_frozen_credentials(self) -> None:
            self.frozen = True

    credentials = Refreshable()
    monkeypatch.setattr(
        service._s3_session("ap-northeast-2"), "get_credentials", lambda: credentials
    )

    left = service._credential_seconds_left("ap-northeast-2")

    # 꺼내기 전에는 만료 시각이 비어 있는 지연 갱신 자격증명이 있어서 먼저 꺼냅니다.
    assert credentials.frozen is True
    assert left is not None and 3590 <= left <= 3600


def test_고정_키는_만료가_없다() -> None:
    assert service._credential_seconds_left("ap-northeast-2") is None


def test_버킷이_없으면_발급하지_않는다(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("S3_BUCKET", "")
    _clear_caches()

    with pytest.raises(StorageNotConfigured):
        service.presign_upload(KEY, "image/jpeg", 2048)


def test_자격증명이_없으면_발급하지_않는다(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AWS_ACCESS_KEY_ID")
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY")
    _clear_caches()

    with pytest.raises(StorageNotConfigured):
        service.presign_upload(KEY, "image/jpeg", 2048)


def test_객체_key는_서버가_id로만_만든다() -> None:
    class_id, client_photo_id = uuid.uuid4(), uuid.uuid4()

    assert service.object_key(class_id, client_photo_id) == f"media/{class_id}/{client_photo_id}"


def _stub_head() -> Stubber:
    stubber = Stubber(service._s3_client("ap-northeast-2"))
    stubber.activate()
    return stubber


def test_올라간_객체의_실제_크기와_형식을_돌려준다() -> None:
    with _stub_head() as stubber:
        stubber.add_response(
            "head_object",
            {"ContentLength": 2048, "ContentType": "image/jpeg"},
            {"Bucket": BUCKET, "Key": KEY},
        )

        stored = service.head_uploaded_object(KEY)

    assert stored == service.StoredObject(size_bytes=2048, content_type="image/jpeg")


def test_객체가_없으면_None이다() -> None:
    with _stub_head() as stubber:
        stubber.add_client_error("head_object", service_error_code="404", http_status_code=404)

        assert service.head_uploaded_object(KEY) is None


def test_권한_오류는_없음으로_바꾸지_않는다() -> None:
    """403을 '없음'으로 보이면 FE가 재업로드를 반복하고 권한 문제는 묻힙니다 (§11)."""
    with _stub_head() as stubber:
        stubber.add_client_error("head_object", service_error_code="403", http_status_code=403)

        with pytest.raises(ClientError):
            service.head_uploaded_object(KEY)


def test_형식_확인용으로_앞부분만_받는다() -> None:
    """파일 전체를 받으면 그 트래픽이 EC2를 지납니다. 앞 64바이트만 Range로 받습니다."""
    head = b"\xff\xd8\xff\xe0" + bytes(60)
    with _stub_head() as stubber:
        stubber.add_response(
            "get_object",
            {"Body": StreamingBody(io.BytesIO(head), len(head))},
            {"Bucket": BUCKET, "Key": KEY, "Range": "bytes=0-63"},
        )

        assert service._read_object_head(KEY) == head
