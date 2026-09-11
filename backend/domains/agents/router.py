from fastapi import APIRouter

router = APIRouter(prefix="/agents", tags=["agents"])

# TODO(eun): API 목록 확정 회의 이후 엔드포인트 추가 (예: POST /agents/regenerate — 수동 재생성 요청)
