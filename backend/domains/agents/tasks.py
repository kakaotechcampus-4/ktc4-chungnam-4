from celery_app import celery_app
from domains.agents import service


# 타임아웃 180초 — LLM을 최대 약 10회 부르는 경로 기준 (테크스펙 파이프라인 4단계)
@celery_app.task(bind=True, max_retries=2, soft_time_limit=180)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    service.orchestrate_drafts(job_id, child_id)
