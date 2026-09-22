"""backend에서 python -m scripts.celery_smoke로 실행하는 Redis·worker 연습."""

import argparse
import json
from time import monotonic, sleep

from celery_app import celery_app


@celery_app.task(name="aidam.practice", soft_time_limit=60, time_limit=65)
def practice(
    payload: dict[str, str], *, fail: bool = False, delay_seconds: int = 0
) -> dict[str, str]:
    """모델·DB 호출 없이 정상 반환과 의도한 예외를 재현합니다."""
    if payload != {"message": "test"}:
        raise ValueError('Practice input must be {"message": "test"}')
    if type(delay_seconds) is not int or not 0 <= delay_seconds <= 10:
        raise ValueError("delay_seconds must be an integer between 0 and 10")
    # 빠른 작업의 STARTED를 관찰하기 위한 연습 전용 대기입니다.
    sleep(delay_seconds)
    if fail:
        raise ValueError("Intentional practice failure")
    return {"message": "작업 완료"}


def status(task_id: str) -> dict[str, object]:
    """접수 객체가 없어도 ID로 Redis에서 조회합니다. 완료까지 기다리지 않습니다."""
    result = celery_app.AsyncResult(task_id)
    state = result.state
    response: dict[str, object] = {"task_id": task_id, "state": state}
    if state == "SUCCESS":
        response["result"] = result.result
    elif state == "FAILURE":
        # 연습 작업의 고정 오류만 사용합니다. 업무 API의 오류 응답은 별도 설계합니다.
        response["error"] = str(result.result)
    return response


def verify() -> None:
    """실제 큐에 제출하고 STARTED·성공·실패를 검사합니다."""
    if celery_app.conf.task_always_eager:
        raise RuntimeError("Smoke verification requires a real worker")
    job = practice.delay({"message": "test"}, delay_seconds=3)
    print(f"success task_id={job.id}", flush=True)
    result = celery_app.AsyncResult(job.id)
    deadline = monotonic() + 30
    while result.state != "STARTED":
        if result.ready() or monotonic() >= deadline:
            raise RuntimeError("STARTED was not observed; check worker logs")
        sleep(0.05)
    print("STARTED", flush=True)
    assert result.get(timeout=30) == {"message": "작업 완료"}
    assert status(job.id)["state"] == "SUCCESS"
    print(json.dumps(status(job.id), ensure_ascii=False), flush=True)

    failed = practice.delay({"message": "test"}, fail=True)
    print(f"failure task_id={failed.id}", flush=True)
    error = celery_app.AsyncResult(failed.id).get(timeout=30, propagate=False)
    assert isinstance(error, ValueError)
    assert str(error) == "Intentional practice failure"
    assert status(failed.id)["state"] == "FAILURE"
    print(json.dumps(status(failed.id), ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["submit", "status", "verify"])
    parser.add_argument("--task-id")
    parser.add_argument("--fail", action="store_true")
    parser.add_argument("--delay-seconds", type=int, choices=range(11), default=0)
    args = parser.parse_args()
    if args.action == "submit":
        job = practice.delay({"message": "test"}, fail=args.fail, delay_seconds=args.delay_seconds)
        print(json.dumps({"task_id": job.id}))
    elif args.action == "status":
        if not args.task_id:
            parser.error("status requires --task-id")
        print(json.dumps(status(args.task_id), ensure_ascii=False))
    else:
        verify()


if __name__ == "__main__":
    main()
