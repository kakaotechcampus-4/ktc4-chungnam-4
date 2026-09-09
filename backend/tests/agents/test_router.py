"""router.py <-> tasks.py <-> service.py 연결 확인 (A의 실제 Redis/worker 없이 임시 검증).

main.py·core/config.py·core/database.py가 아직 없어 실제 앱을 못 띄우므로, 여기서만
FastAPI 앱을 임시로 만들어 agents router를 붙인다. Celery는 브로커 없이
`task_always_eager`로 동작시켜 A의 worker 구현 전까지 흐름을 확인하는 용도다.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from celery_app import celery_app
from domains.agents.router import router as agents_router
from tests.agents.fixtures.evidence import SAMPLE_REQUEST_CHILD_A

celery_app.conf.task_always_eager = True
celery_app.conf.task_eager_propagates = True
celery_app.conf.task_store_eager_result = True
# 로컬 Redis 없이 검증하기 위한 임시 backend. 실제 배포에서는 REDIS_URL을 그대로 쓴다.
celery_app.conf.result_backend = "cache+memory://"

app = FastAPI()
app.include_router(agents_router)
client = TestClient(app)


def test_생성_요청_접수부터_결과_조회까지_연결된다() -> None:
    request_body = SAMPLE_REQUEST_CHILD_A.model_dump(mode="json")
    accept_response = client.post("/agents/generate", json=request_body)
    assert accept_response.status_code == 202
    job_id = accept_response.json()["job_id"]
    assert job_id == SAMPLE_REQUEST_CHILD_A.request_id

    result_response = client.get(f"/agents/jobs/{job_id}")
    assert result_response.status_code == 200
    body = result_response.json()
    assert body["status"] == "completed"
    assert body["child_id"] == "child_A"
    assert len(body["documents"]) == 2


def test_알_수_없는_job_id는_대기_상태로_조회된다() -> None:
    response = client.get("/agents/jobs/존재하지-않는-job")
    assert response.status_code == 200
    assert response.json()["status"] == "pending"
