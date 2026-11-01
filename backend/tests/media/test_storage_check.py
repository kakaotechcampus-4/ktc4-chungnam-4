"""S3 권한 점검 `/health/storage` (#129, FR-15).

PUT·HEAD·DELETE는 botocore Stubber로 응답을 고정합니다. 테스트가 개발자 PC의 SSO 프로필이나
EC2 롤을 집어 가지 않게 자격증명 탐색 경로를 전부 막습니다 (test_s3_presign.py와 같은 방식).
"""

import logging
from collections.abc import Iterator

import pytest
from botocore.stub import ANY, Stubber
from fastapi.testclient import TestClient

from core.config import get_settings
from domains.media import service
from main import app

BUCKET = "test-bucket"
REGION = "ap-northeast-2"


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
    _clear_caches()
    yield
    _clear_caches()


@pytest.fixture
def s3() -> Iterator[Stubber]:
    stubber = Stubber(service._s3_client(REGION))
    with stubber:
        yield stubber
    stubber.assert_no_pending_responses()


def _object() -> dict[str, object]:
    return {"Bucket": BUCKET, "Key": ANY}


def _put(s3: Stubber) -> None:
    s3.add_response("put_object", {}, {**_object(), "Body": ANY, "ContentType": "text/plain"})


def _denied(s3: Stubber, operation: str) -> None:
    # 실제 AccessDenied 메시지처럼 롤 ARN·버킷을 담아 둡니다. 로그·응답에 새면 안 됩니다.
    s3.add_client_error(
        operation,
        service_error_code="AccessDenied",
        service_message=f"arn:aws:sts::123456789012:assumed-role/ec2-role is not allowed {BUCKET}",
        http_status_code=403,
    )


def test_쓰고_읽고_지우면_통과한다(s3: Stubber) -> None:
    _put(s3)
    s3.add_response("head_object", {"ContentLength": 2}, _object())
    s3.add_response("delete_object", {}, _object())

    assert service.check_storage_access() is None


def test_임시_객체는_원본_경로와_섞이지_않는다(s3: Stubber) -> None:
    keys: list[str] = []
    s3.client.meta.events.register(
        "before-parameter-build.s3.*", lambda params, **_: keys.append(params["Key"])
    )
    _put(s3)
    s3.add_response("head_object", {"ContentLength": 2}, _object())
    s3.add_response("delete_object", {}, _object())

    service.check_storage_access()

    assert keys and all(key.startswith("healthcheck/") for key in keys)
    assert len(set(keys)) == 1, "PUT·HEAD·DELETE가 같은 임시 객체를 다뤄야 합니다"


def test_쓰기가_막히면_put_단계를_알리고_삭제는_시도한다(s3: Stubber) -> None:
    _denied(s3, "put_object")
    s3.add_response("delete_object", {}, _object())

    assert service.check_storage_access() == "put"


def test_읽기가_막혀도_임시_객체를_지운다(s3: Stubber) -> None:
    _put(s3)
    _denied(s3, "head_object")
    s3.add_response("delete_object", {}, _object())

    assert service.check_storage_access() == "head"


def test_삭제만_막히면_delete_단계를_알린다(s3: Stubber) -> None:
    """앱은 업로드가 되지만, 임시 객체가 버킷에 남으므로 실패로 봅니다."""
    _put(s3)
    s3.add_response("head_object", {"ContentLength": 2}, _object())
    _denied(s3, "delete_object")

    assert service.check_storage_access() == "delete"


def test_앞_단계_실패가_삭제_실패에_덮이지_않는다(s3: Stubber) -> None:
    _denied(s3, "put_object")
    _denied(s3, "delete_object")

    assert service.check_storage_access() == "put"


def test_버킷_설정이_없으면_S3를_부르지_않고_config를_알린다(
    monkeypatch: pytest.MonkeyPatch, s3: Stubber
) -> None:
    monkeypatch.setenv("S3_BUCKET", "")
    get_settings.cache_clear()

    assert service.check_storage_access() == "config"


def test_로그에는_단계와_오류_코드만_남는다(s3: Stubber, caplog: pytest.LogCaptureFixture) -> None:
    _denied(s3, "put_object")
    s3.add_response("delete_object", {}, _object())

    with caplog.at_level(logging.WARNING, logger=service.__name__):
        service.check_storage_access()

    assert "step=put code=AccessDenied" in caplog.text
    assert BUCKET not in caplog.text
    assert "arn:aws" not in caplog.text
    assert "healthcheck/" not in caplog.text


# ---- 엔드포인트 ----


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def test_점검을_통과하면_200(monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setattr(service, "check_storage_access", lambda: None)

    response = client.get("/health/storage")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "storage": "ok"}


def test_막히면_503과_막힌_단계만_돌려준다(s3: Stubber, client: TestClient) -> None:
    _denied(s3, "put_object")
    s3.add_response("delete_object", {}, _object())

    response = client.get("/health/storage")

    assert response.status_code == 503
    assert response.json() == {"status": "error", "storage": "unavailable", "failed_step": "put"}
    assert BUCKET not in response.text
