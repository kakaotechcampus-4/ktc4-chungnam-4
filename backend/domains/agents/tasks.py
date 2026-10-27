from collections.abc import Sequence
from uuid import UUID

from celery import Task

from celery_app import celery_app
from domains.agents import service
from domains.agents.llm import RETRYABLE_LLM_ERRORS

# 재시도 대상: LLM 호출 실패와 개별 요청 타임아웃(APITimeoutError) (테크스펙 예외 처리 표).
# 코드 오류는 다시 돌려도 같으므로 재시도하지 않고 바로 실패로 끝낸다.
# 180초 작업 제한(SoftTimeLimitExceeded)도 뺀다 — 시간 제한을 넘긴 파이프라인을 처음부터 두 번
# 더 돌리면 최대 약 9분이 걸리고 앞서 성공한 LLM 호출도 반복된다 (#102 리뷰, 엄태은).
RETRYABLE_ERRORS = RETRYABLE_LLM_ERRORS


def _job_id(args: tuple, kwargs: dict) -> str:
    return kwargs["job_id"] if "job_id" in kwargs else args[0]


class _DraftTask(Task):
    """재시도·최종 실패를 Job에 남기는 훅만 둔다. 로직은 service에 있다."""

    def on_retry(self, exc, task_id, args, kwargs, einfo) -> None:
        service.record_job_retry(_job_id(args, kwargs))

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        service.mark_job_failed(_job_id(args, kwargs))


# 재시도 상한 2회·타임아웃 180초 — LLM을 최대 약 10회 부르는 경로 기준 (테크스펙 파이프라인 4단계).
# retry_backoff: 재시도 간격은 스펙에 없다. Celery 기본값(180초 고정)은 교사가 진행 화면을
# 보는 동안 너무 길어서 1초부터 늘리는 방식을 임시로 골랐다 — 팀 확인 필요.
@celery_app.task(
    bind=True,
    base=_DraftTask,
    autoretry_for=RETRYABLE_ERRORS,
    max_retries=2,
    retry_backoff=True,
    soft_time_limit=180,
)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    service.orchestrate_drafts(job_id, child_id)


def enqueue_generate_drafts(child_jobs: Sequence[tuple[UUID, UUID]]) -> None:
    """원아별 Job을 큐에 넣는다. worker가 Job 행을 읽으므로 커밋한 뒤에 부른다.

    브로커 장애로 넣기가 실패하면 아직 못 넣은 Job을 failed로 바꾼 뒤 예외를 다시 올린다.
    pending으로 두면 같은 반·날짜가 JOB_ALREADY_RUNNING에 영구히 막힌다 (#161 리뷰, 엄태은).
    이미 넣은 Job은 worker가 처리하므로 건드리지 않는다.

    TODO(eun): 실패한 Job을 다시 시작하는 POST /jobs/{job_id}/retry는 재시도 API를 만들 때 붙인다.
    """
    for index, (job_id, child_id) in enumerate(child_jobs):
        try:
            generate_drafts.delay(job_id=str(job_id), child_id=str(child_id))
        except Exception:
            for unqueued_job_id, _ in child_jobs[index:]:
                service.mark_job_failed(str(unqueued_job_id))
            raise
