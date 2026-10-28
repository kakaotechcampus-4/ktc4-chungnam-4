"""요청 검증 실패(422)도 공통 에러 형식으로 나간다 (테크스펙 §공통 API 규약, #194)."""

import json
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from core.database import get_db
from core.exceptions import RequestValidationFailed
from domains.auth.middleware import get_current_user
from domains.auth.service import TeacherProfile
from main import app, handle_aidam_error

SENTENCE = "가나가 블록을 높이 쌓았어요"


@pytest.fixture
def client() -> Iterator[TestClient]:
    # 검증에서 막히므로 DB까지 가지 않는다
    app.dependency_overrides[get_db] = lambda: None
    app.dependency_overrides[get_current_user] = lambda: TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=uuid.uuid4(),
    )
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _invalid_patch(client: TestClient):
    # sentence_id가 빠진 문장 — 기본 응답이면 이 항목 전체가 input으로 돌아온다
    body = {"expected_version": 3, "sentences": [{"text": SENTENCE}]}
    return client.patch(f"/api/v1/drafts/{uuid.uuid4()}", json=body)


def test_요청_검증_실패는_공통_에러_형식이다(client):
    response = _invalid_patch(client)

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "입력한 값을 다시 확인해 주세요.",
            "detail": [{"loc": ["body", "sentences", 0, "sentence_id"], "type": "missing"}],
        }
    }


def test_H4_요청_값이_응답에_실리지_않는다(client):
    response = _invalid_patch(client)

    assert SENTENCE not in response.text


def test_서비스가_올리는_422와_모양이_같다(client):
    pydantic = _invalid_patch(client)
    service = handle_aidam_error(None, RequestValidationFailed("record_date가 필요합니다."))

    assert service.status_code == pydantic.status_code
    service_error = json.loads(service.body)["error"]
    assert service_error.keys() == pydantic.json()["error"].keys()
    assert service_error["code"] == pydantic.json()["error"]["code"]
