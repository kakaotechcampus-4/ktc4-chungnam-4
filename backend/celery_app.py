from celery import Celery

from core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aidam",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    # API가 이름으로 task를 보내므로 worker가 등록하지 않으면 Job이 pending으로 남습니다.
    include=["scripts.celery_smoke", "domains.agents.tasks", "domains.media.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    result_expires=settings.celery_result_expires,
    timezone="Asia/Seoul",
    enable_utc=True,
    broker_connection_retry_on_startup=True,
    worker_prefetch_multiplier=1,
    # 브로커가 죽었을 때 API가 큐에 넣기를 포기하기까지의 시간. CloudFront가 원본 응답을
    # 30초만 기다리므로(infra/frontend/aidam-fe.yaml) 그보다 훨씬 짧게 끊어, 504가 아닌
    # 공통 에러 형식으로 답하게 한다. 실측 약 4초 (#304 4-17).
    # 연결 대기 2초·넣기 재시도 1번은 임시 결정(김동건) — 팀 확인 필요.
    broker_connection_timeout=2,
    task_publish_retry_policy={
        "max_retries": 1,
        "interval_start": 0,
        "interval_step": 1,
        "interval_max": 1,
    },
)
