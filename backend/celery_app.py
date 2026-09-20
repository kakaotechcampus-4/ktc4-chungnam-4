from celery import Celery

from core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "aidam",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    # TODO(태은): 실제 AI 작업 구현 완료 후 include에 domains.agents.tasks를 등록합니다.
    # 현재는 Redis·worker 연결 검증용 연습 작업만 등록합니다.
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
