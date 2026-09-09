"""AI 생성 요청 접수·조회 엔드포인트 (계획서 §5.4, 작업 상세 "상균 — 주로 작업할 파일").

# TODO(상균): 표준 에러 응답 형식(CLAUDE.md §8.1 `{"error": {...}}`)은 전역 예외 핸들러
#   (core/exceptions.py)가 생긴 뒤 연결한다. 지금은 FastAPI 기본 422/404를 그대로 쓴다.
# TODO(엄태은): 이 router를 main.py의 APIRouter 등록에 포함해야 실제로 뜬다
#   (main.py·core/config.py·core/database.py가 아직 비어 있어 앱 자체가 기동되지 않음).
"""

from __future__ import annotations

from celery.result import AsyncResult
from fastapi import APIRouter

from celery_app import celery_app
from domains.agents.schemas import GenerationRequest, JobAcceptedResponse, JobResult, JobStatus
from domains.agents.tasks import generate_drafts

router = APIRouter(prefix="/agents", tags=["agents"])


@router.post("/generate", response_model=JobAcceptedResponse, status_code=202)
def create_generation_job(request: GenerationRequest) -> JobAcceptedResponse:
    """생성 요청을 접수하고 worker 작업으로 넘긴다. 같은 request_id 재전송은 같은 job_id로
    처리해 멱등성을 보장한다 (CLAUDE.md §6.3)."""
    job_id = request.request_id
    generate_drafts.apply_async(args=[job_id, request.model_dump(mode="json")], task_id=job_id)
    return JobAcceptedResponse(job_id=job_id, status=JobStatus.PENDING)


@router.get("/jobs/{job_id}", response_model=JobResult)
def get_generation_job(job_id: str) -> JobResult:
    """접수번호로 상태·결과를 조회한다."""
    async_result = AsyncResult(job_id, app=celery_app)

    if not async_result.ready():
        status = JobStatus.RUNNING if async_result.state == "STARTED" else JobStatus.PENDING
        return JobResult(job_id=job_id, status=status)

    if async_result.failed():
        return JobResult(job_id=job_id, status=JobStatus.FAILED, reason=str(async_result.result))

    return JobResult.model_validate(async_result.result)
