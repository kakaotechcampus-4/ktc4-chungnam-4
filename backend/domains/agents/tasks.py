from celery import Task
from celery.exceptions import SoftTimeLimitExceeded

from celery_app import celery_app
from domains.agents import service
from domains.agents.llm import RETRYABLE_LLM_ERRORS

# 재시도 대상: LLM 호출 실패와 타임아웃 (테크스펙 예외 처리 표). 코드 오류는 다시 돌려도
# 같으므로 재시도하지 않고 바로 실패로 끝낸다.
RETRYABLE_ERRORS = (*RETRYABLE_LLM_ERRORS, SoftTimeLimitExceeded)


def _job_id(args: tuple, kwargs: dict) -> str:
    return kwargs["job_id"] if "job_id" in kwargs else args[0]


class _DraftTask(Task):
    """재시도·최종 실패를 Job에 남기는 훅만 둔다. 로직은 service에 있다."""

    def on_retry(self, exc, task_id, args, kwargs, einfo) -> None:
        service.record_job_retry(_job_id(args, kwargs))

    def on_failure(self, exc, task_id, args, kwargs, einfo) -> None:
        service.mark_job_failed(_job_id(args, kwargs))


# 재시도 상한 2회·타임아웃 60초 (테크스펙 파이프라인 4. 오케스트레이터).
# retry_backoff: 재시도 간격은 스펙에 없다. Celery 기본값(180초 고정)은 교사가 진행 화면을
# 보는 동안 너무 길어서 1초부터 늘리는 방식을 임시로 골랐다 — 팀 확인 필요.
@celery_app.task(
    bind=True,
    base=_DraftTask,
    autoretry_for=RETRYABLE_ERRORS,
    max_retries=2,
    retry_backoff=True,
    soft_time_limit=60,
)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    service.orchestrate_drafts(job_id, child_id)
