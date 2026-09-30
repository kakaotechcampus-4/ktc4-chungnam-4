import os

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

import openai
from celery.exceptions import SoftTimeLimitExceeded

from domains.agents import tasks


def _retries_on(error_type: type[Exception]) -> bool:
    return any(issubclass(error_type, retryable) for retryable in tasks.RETRYABLE_ERRORS)


def test_LLM_호출_실패와_타임아웃만_재시도한다() -> None:
    """테크스펙 예외 처리 표: 재시도 대상은 LLM 호출 실패·타임아웃."""
    assert _retries_on(openai.APITimeoutError)
    assert _retries_on(openai.APIConnectionError)
    assert _retries_on(openai.RateLimitError)
    assert _retries_on(openai.InternalServerError)
    assert _retries_on(SoftTimeLimitExceeded)
    # 다시 돌려도 같은 오류는 재시도하지 않고 바로 실패로 끝낸다.
    assert not _retries_on(openai.AuthenticationError)
    assert not _retries_on(openai.BadRequestError)
    assert not _retries_on(NotImplementedError)
    assert not _retries_on(ValueError)


def test_재시도_상한은_2회다() -> None:
    assert tasks.generate_drafts.max_retries == 2
    assert tuple(tasks.generate_drafts.autoretry_for) == tasks.RETRYABLE_ERRORS


def test_재시도하면_횟수를_남기고_최종_실패하면_FAILED로_남긴다(monkeypatch) -> None:
    retried: list[str] = []
    failed: list[str] = []
    monkeypatch.setattr(tasks.service, "record_job_retry", retried.append)
    monkeypatch.setattr(tasks.service, "mark_job_failed", failed.append)

    tasks.generate_drafts.on_retry(None, "task-1", ("job-1", "child-1"), {}, None)
    tasks.generate_drafts.on_failure(None, "task-2", (), {"job_id": "job-2", "child_id": "c"}, None)

    assert retried == ["job-1"]
    assert failed == ["job-2"]
