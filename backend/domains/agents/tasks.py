# TODO(eun): backend/celery_app.py에 celery_app 인스턴스가 아직 없어 import 에러 발생 중 — 완성 후 해소
from celery_app import celery_app


@celery_app.task(bind=True, max_retries=2, soft_time_limit=60)
def generate_drafts(self, job_id: str, child_id: str) -> None:
    # TODO(eun): domains/agents/service.py가 아직 빈 파일 — 근거수집→초안생성→Critic 검증
    # 오케스트레이션 함수(예: orchestrate_drafts)가 생기면 여기서 호출만 하고 로직은 옮기지 않기
    pass
