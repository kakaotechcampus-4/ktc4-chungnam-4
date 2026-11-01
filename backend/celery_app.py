from celery import Celery

from core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aidam",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    # API가 이름으로 task를 보내므로 worker가 등록하지 않으면 Job이 pending으로 남습니다.
    include=["scripts.celery_smoke", "domains.agents.tasks"],
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
)
