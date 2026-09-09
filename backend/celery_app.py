"""Celery 앱 인스턴스.

# TODO(A): "작업 상세" 문서에서 celery_app.py·docker-compose worker 설정은 A 담당이다.
#   지금은 domains/agents 흐름을 연결하기 위한 최소 설정만 있다. worker 동시성,
#   재시도·타임아웃 정책(계획서 §6.3), docker-compose의 worker 서비스 추가는 A가 이어서 한다.
"""

import os

from celery import Celery

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery("aidam", broker=_REDIS_URL, backend=_REDIS_URL)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # 로컬/테스트에서 브로커·worker 없이 즉시 실행하려면 CELERY_TASK_ALWAYS_EAGER=true
    task_always_eager=os.getenv("CELERY_TASK_ALWAYS_EAGER", "false").lower() == "true",
)

celery_app.autodiscover_tasks(["domains.agents"])
