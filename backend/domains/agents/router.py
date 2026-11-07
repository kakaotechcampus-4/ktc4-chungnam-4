"""agents 라우터 — 초안 생성 작업 시작·조회, 추가 근거 읽기·저장 (docs/api/agents.md).

경로는 리소스 기준(/classes/{class_id}/jobs, /jobs/{job_id})이라 도메인 prefix를 두지 않습니다.
베이스 경로 `/api/v1`은 `main.py`가 붙입니다. 판정·조회는 service.py가 하고, 이 파일은
요청을 넘기고 응답 모양으로 바꾸기만 합니다.
"""

from __future__ import annotations

from datetime import date
from http import HTTPStatus
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from core.database import get_db
from domains.agents import service
from domains.agents.models import TeacherEvidence
from domains.agents.schemas import (
    ChildJobResponse,
    GenerationJobCreateRequest,
    GenerationJobResponse,
    JobDraftResponse,
    JobProgressResponse,
    JobTraceResponse,
    ObservationJobCreateRequest,
    TeacherEvidenceListResponse,
    TeacherEvidenceResponse,
    TeacherEvidenceSaveRequest,
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
        stage=min(
            (
                child.stage
                for child in status.children
                if child.status.value in {"pending", "running"} and child.stage
            ),
            key=("transcribing", "collecting_evidence", "generating", "verifying").index,
            default=None,
        ),
        failed_stage=next(
            (child.stage for child in status.children if child.status.value == "failed"), None
        ),
        error_code=next(
            (child.error_code for child in status.children if child.status.value == "failed"), None
        ),
        progress=JobProgressResponse(
            percent=status.percent,
            total_children=len(status.children),
            finished_children=status.finished_children,
        ),
        children=[
            ChildJobResponse(
                child_id=child.child_id,
                status=child.status.value,
                stage=child.stage,
                failed_stage=child.stage if child.status.value == "failed" else None,
                outcome=child.outcome,
                unclassified_reason=child.unclassified_reason,
                error_code=child.error_code,
                drafts=[
                    JobDraftResponse(draft_id=draft.draft_id, doc_type=draft.doc_type)
                    for draft in child.drafts
                ],
            )
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


@router.post(
    "/children/{child_id}/observation-jobs",
    response_model=GenerationJobResponse,
    status_code=HTTPStatus.ACCEPTED,
)
def start_observation_job(
    child_id: UUID,
    body: ObservationJobCreateRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> GenerationJobResponse:
    started = service.start_observation_job(
        db,
        child_id=child_id,
        month=date.fromisoformat(body.month + "-01"),
        request_id=body.request_id,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
    )
    db.commit()
    enqueue_generate_drafts(started.to_enqueue)
    response.headers["Location"] = f"/api/v1/jobs/{started.status.generation_job.id}"
    return _to_response(started.status)


@router.get("/jobs/{job_id}/trace", response_model=JobTraceResponse)
def read_job_trace(
    job_id: UUID, db: Annotated[Session, Depends(get_db)], teacher: CurrentTeacher
) -> JobTraceResponse:
    return service.get_job_trace(db, job_id=job_id, center_id=teacher.center_id)


def _to_evidence_response(row: TeacherEvidence) -> TeacherEvidenceResponse:
    return TeacherEvidenceResponse(
        evidence_id=row.id,
        child_id=row.child_id,
        record_date=row.record_date,
        activity_time=row.activity_time,
        text=row.text,
        created_at=row.created_at,
    )


@router.get("/classes/{class_id}/evidence", response_model=TeacherEvidenceListResponse)
def list_teacher_evidence(
    class_id: UUID,
    record_date: date,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> TeacherEvidenceListResponse:
    """그날 반 원아들의 추가 근거(교사 관찰 메모)를 돌려줍니다 (FR-05)."""
    rows = service.list_teacher_evidence(
        db,
        class_id=class_id,
        record_date=record_date,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
    )
    return TeacherEvidenceListResponse(items=[_to_evidence_response(row) for row in rows])


@router.put(
    "/children/{child_id}/evidence/{record_date}",
    response_model=TeacherEvidenceResponse,
    responses={HTTPStatus.CREATED: {"model": TeacherEvidenceResponse}},
)
def save_teacher_evidence(
    child_id: UUID,
    record_date: date,
    body: TeacherEvidenceSaveRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    teacher: CurrentTeacher,
) -> TeacherEvidenceResponse:
    """아이·날짜의 추가 근거를 저장합니다. 없으면 201, 있으면 덮어쓰고 200입니다 (FR-05)."""
    saved = service.save_teacher_evidence(
        db,
        child_id=child_id,
        record_date=record_date,
        activity_time=body.activity_time,
        text=body.text,
        teacher_id=teacher.teacher_id,
        center_id=teacher.center_id,
    )
    response.status_code = HTTPStatus.CREATED if saved.created else HTTPStatus.OK
    return _to_evidence_response(saved.evidence)
