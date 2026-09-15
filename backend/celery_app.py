from celery import Celery

from core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aidam",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    # D의 실제 작업은 구현 완료 후 등록합니다. 지금은 연습 작업만 실행합니다.
    include=["scripts.celery_smoke"],
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
