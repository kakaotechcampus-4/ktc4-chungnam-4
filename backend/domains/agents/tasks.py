"""Celery task 정의. 로직은 두지 않고 service.py 호출만 한다 (CLAUDE.md §6.3).

# TODO(A): 시그니처(job_id, request_data)는 상균이 router.py와 연결하기 위해 임시로 정한
#   형태다. 실제 근거 조회(현재는 fixtures 고정값)를 리포지토리로 교체할 때 재확인.
"""

from __future__ import annotations

from celery_app import celery_app
from domains.agents.schemas import GenerationRequest
from domains.agents.service import run_generation_job


@celery_app.task(bind=True, max_retries=2, soft_time_limit=60)
def generate_drafts(self, job_id: str, request_data: dict) -> dict:
    request = GenerationRequest.model_validate(request_data)
    # TODO(C): 실제 근거 저장소 연동 전까지는 고정 fixture 근거 풀을 사용한다.
    from tests.agents.fixtures.evidence import SAMPLE_EVIDENCE_POOL

    result = run_generation_job(job_id=job_id, request=request, evidence_pool=SAMPLE_EVIDENCE_POOL)
    return result.model_dump(mode="json")
