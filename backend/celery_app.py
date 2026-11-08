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
    # 작업이 끝난 뒤에 메시지를 확인(ack)한다. 시작할 때 확인하면 worker가 다음 메시지를 미리
    # 받아 두는데, worker가 죽으면 그 메시지가 Redis unacked에 visibility_timeout(기본 1시간)
    # 동안 갇혀 그 원아가 pending으로 멈췄다 (#304 4-2). 늦게 확인하면 미리 받는 메시지가 없고,
    # 처리 중이던 메시지는 다시 전달된다. 이미 끝난 Job은 orchestrate_drafts가 건너뛴다.
    task_acks_late=True,
    # 처리 프로세스만 죽은 경우(OOM 등) 기다리지 않고 바로 큐에 되돌린다.
    task_reject_on_worker_lost=True,
    # 브로커가 죽었을 때 API가 큐에 넣기를 포기하기까지의 시간. CloudFront가 원본 응답을
    # 30초만 기다리므로(infra/frontend/aidam-fe.yaml) 그보다 훨씬 짧게 끊어, 504가 아닌
    # 공통 에러 형식으로 답하게 한다. 실측 약 4초 (#304 4-17).
    # 연결 대기 2초·넣기 재시도 1번은 임시 결정(김동건) — 팀 확인 필요.
    broker_connection_timeout=2,
    # worker 전체가 죽었을 때 처리 중이던 메시지를 다시 전달하기까지의 시간. 가장 긴 작업
    # (STT time_limit 630초, 초안 생성은 제한 300초 × 시도 3번 = 900초)보다 길어야 처리 중인 작업이
    # 두 번 전달되지 않는다 (#304 4-2). 초안 제한을 180초에서 300초로 올리면서 900에서 1800으로
    # 올렸다. 1800초는 임시 결정(정은, #290) — 팀 확인 필요.
    broker_transport_options={"visibility_timeout": 1800},
    task_publish_retry_policy={
        "max_retries": 1,
        "interval_start": 0,
        "interval_step": 1,
        "interval_max": 1,
    },
)
