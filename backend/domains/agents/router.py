"""agents 라우터 — 초안 생성 작업 시작·조회 (docs/api/agents.md).

경로는 리소스 기준(/classes/{class_id}/jobs, /jobs/{job_id})이라 도메인 prefix를 두지 않습니다.
베이스 경로 `/api/v1`은 `main.py`가 붙입니다. 판정·조회는 service.py가 하고, 이 파일은
요청을 넘기고 응답 모양으로 바꾸기만 합니다.
"""

from __future__ import annotations

from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.agents import service
from domains.agents.schemas import (
    ChildJobResponse,
    GenerationJobCreateRequest,
    GenerationJobResponse,
    JobProgressResponse,
)
from domains.agents.tasks import enqueue_generate_drafts
from domains.auth.middleware import CurrentTeacher

router = APIRouter(tags=["agents"])


def _to_response(status: service.GenerationJobStatus) -> GenerationJobResponse:
    generation_job = status.generation_job
    return GenerationJobResponse(
        job_id=generation_job.id,
        class_id=generation_job.class_id,
        record_date=generation_job.record_date,
        status=status.status.value,
        progress=JobProgressResponse(
            percent=status.percent,
            total_children=len(status.children),
            finished_children=status.finished_children,
        ),
        children=[
            ChildJobResponse(child_id=child.child_id, status=child.status.value)
            for child in status.children
        ],
        created_at=generation_job.created_at,
        updated_at=status.updated_at,
    )


@router.post(
    "/classes/{class_id}/jobs",
    response_model=GenerationJobResponse,
    status_code=HTTPStatus.ACCEPTED,
)
def start_generation_job(
    class_id: UUID,
    body: GenerationJobCreateRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> GenerationJobResponse:
    """서버 전송을 마친 반·날짜의 초안 생성 작업을 시작합니다 (FR-05, FR-06, FR-26)."""
    started = service.start_generation_job(
        db,
        class_id=class_id,
        record_date=body.record_date,
        request_id=body.request_id,
        media_ids=body.media_ids,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
    )
    # worker가 Job 행을 읽으므로 커밋한 뒤에 큐에 넣습니다
    db.commit()
    enqueue_generate_drafts(started.to_enqueue)
    response.headers["Location"] = f"/api/v1/jobs/{started.status.generation_job.id}"
    return _to_response(started.status)


@router.get("/jobs/{job_id}", response_model=GenerationJobResponse)
def read_generation_job(
    job_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> GenerationJobResponse:
    """초안 생성 작업의 진행 상태와 원아별 결과를 돌려줍니다. FE가 2초마다 부릅니다 (FR-06)."""
    return _to_response(service.get_generation_job(db, job_id=job_id, center_id=teacher.center_id))
