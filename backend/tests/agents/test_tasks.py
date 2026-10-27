import os
import uuid

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

import httpx
import openai
import pytest
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
    # 다시 돌려도 같은 오류는 재시도하지 않고 바로 실패로 끝낸다.
    assert not _retries_on(openai.AuthenticationError)
    assert not _retries_on(openai.BadRequestError)
    assert not _retries_on(NotImplementedError)
    assert not _retries_on(ValueError)


def test_작업_시간_제한은_재시도하지_않는다() -> None:
    """시간 제한을 넘긴 파이프라인을 처음부터 다시 돌리면 최대 약 9분이 걸린다 (#102 리뷰)."""
    assert not _retries_on(SoftTimeLimitExceeded)


def _connection_error() -> openai.APIConnectionError:
    return openai.APIConnectionError(request=httpx.Request("POST", "http://llm.invalid/v1"))


def _run_failing_task(monkeypatch, error: Exception) -> tuple[object, list[str], list[str]]:
    """service가 error를 올릴 때 task를 재시도까지 그대로 돌린다(eager)."""
    retried: list[str] = []
    failed: list[str] = []
    monkeypatch.setattr(tasks.service, "record_job_retry", retried.append)
    monkeypatch.setattr(tasks.service, "mark_job_failed", failed.append)

    def _orchestrate(job_id: str, child_id: str) -> None:
        raise error

    monkeypatch.setattr(tasks.service, "orchestrate_drafts", _orchestrate)
    result = tasks.generate_drafts.apply(args=("job-1", "child-1"))
    return result.result, retried, failed


def test_LLM_호출_도중_걸린_작업_시간_제한은_SDK가_연결_오류로_감싼다(monkeypatch) -> None:
    """generate_drafts가 감싼 예외를 되돌리는 이유. SDK가 바뀌어 감싸지 않게 되면 알려 준다."""
    from domains.agents import llm

    def _time_limit(request: httpx.Request) -> httpx.Response:
        raise SoftTimeLimitExceeded()  # 응답을 기다리는 동안 Celery가 작업 제한을 올리는 자리

    real_openai = llm.OpenAI

    def _openai(**kwargs) -> openai.OpenAI:
        kwargs["base_url"] = "http://llm.invalid/v1"
        transport = httpx.MockTransport(_time_limit)
        return real_openai(**kwargs, http_client=httpx.Client(transport=transport))

    monkeypatch.setattr(llm, "OpenAI", _openai)

    with pytest.raises(openai.APIConnectionError) as caught:
        llm.call_claude("CHILD_A")

    assert isinstance(caught.value.__cause__, SoftTimeLimitExceeded)


def test_SDK가_감싼_작업_시간_제한도_재시도하지_않는다(monkeypatch) -> None:
    wrapped = _connection_error()
    wrapped.__cause__ = SoftTimeLimitExceeded()

    error, retried, failed = _run_failing_task(monkeypatch, wrapped)

    assert isinstance(error, SoftTimeLimitExceeded)
    assert retried == []
    assert failed == ["job-1"]


def test_연결_오류는_상한까지_재시도한다(monkeypatch) -> None:
    # 결과의 예외는 Celery가 다시 만든 것이라 타입 대신 재시도·실패 기록으로 확인한다.
    _, retried, failed = _run_failing_task(monkeypatch, _connection_error())

    assert retried == ["job-1", "job-1"]
    assert failed == ["job-1"]


def test_재시도_상한은_2회다() -> None:
    assert tasks.generate_drafts.max_retries == 2
    assert tuple(tasks.generate_drafts.autoretry_for) == tasks.RETRYABLE_ERRORS


def test_LLM_호출은_SDK에서_재시도하지_않는다(monkeypatch) -> None:
    """재시도는 Celery 한 곳에서만 한다. SDK 재시도가 겹치면 한 지점에서 최대 9번 호출된다
    (#102 리뷰)."""
    from domains.agents import llm

    created: list[dict] = []

    class _FakeOpenAI:
        def __init__(self, **kwargs) -> None:
            created.append(kwargs)
            raise RuntimeError("생성 인자만 확인한다")

    monkeypatch.setattr(llm, "OpenAI", _FakeOpenAI)

    with pytest.raises(RuntimeError):
        llm.call_claude("CHILD_A")

    assert created[0]["max_retries"] == 0


def test_재시도하면_횟수를_남기고_최종_실패하면_FAILED로_남긴다(monkeypatch) -> None:
    retried: list[str] = []
    failed: list[str] = []
    monkeypatch.setattr(tasks.service, "record_job_retry", retried.append)
    monkeypatch.setattr(tasks.service, "mark_job_failed", failed.append)

    tasks.generate_drafts.on_retry(None, "task-1", ("job-1", "child-1"), {}, None)
    tasks.generate_drafts.on_failure(None, "task-2", (), {"job_id": "job-2", "child_id": "c"}, None)

    assert retried == ["job-1"]
    assert failed == ["job-2"]


def test_큐_넣기가_실패하면_못_넣은_Job을_failed로_바꾸고_예외를_올린다(monkeypatch) -> None:
    """pending으로 남으면 그 반·날짜가 JOB_ALREADY_RUNNING에 영구히 막힌다 (#161 리뷰)."""
    first, second, third = (uuid.uuid4() for _ in range(3))
    child_jobs = [(first, uuid.uuid4()), (second, uuid.uuid4()), (third, uuid.uuid4())]
    sent: list[str] = []
    failed: list[str] = []

    def fake_delay(job_id: str, child_id: str) -> None:
        if job_id == str(second):
            raise ConnectionError("broker down")
        sent.append(job_id)

    monkeypatch.setattr(tasks.generate_drafts, "delay", fake_delay)
    monkeypatch.setattr(tasks.service, "mark_job_failed", failed.append)

    with pytest.raises(ConnectionError):
        tasks.enqueue_generate_drafts(child_jobs)

    # 이미 넣은 첫 Job은 worker가 처리하므로 건드리지 않는다.
    assert sent == [str(first)]
    assert failed == [str(second), str(third)]
