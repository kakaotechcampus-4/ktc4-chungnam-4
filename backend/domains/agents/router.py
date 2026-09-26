from fastapi import APIRouter

# 경로는 리소스 기준(/classes/{class_id}/jobs, /jobs/{job_id})이라 도메인 prefix를 두지 않습니다.
router = APIRouter(tags=["agents"])

# TODO(eun): API 문서(9.22) agents의 (막힘) 두 항목(job_id 단위, Job 트리거)이 정해지면
#   POST /classes/{class_id}/jobs, GET /jobs/{job_id}를 추가합니다.
