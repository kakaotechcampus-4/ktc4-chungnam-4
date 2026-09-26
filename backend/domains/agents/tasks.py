from celery_app import celery_app
from domains.agents import service


@celery_app.task(bind=True, max_retries=2, soft_time_limit=60)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    service.orchestrate_drafts(job_id, child_id)
