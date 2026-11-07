"""근거수집 → 초안생성 → Critic 검증 오케스트레이션.

tasks.py는 이 모듈의 orchestrate_drafts만 호출합니다 (CLAUDE.md: tasks.py는 로직을 갖지 않음).
"""

import calendar
import json
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, object_session

from core.database import SessionLocal
from core.exceptions import (
    DraftVersionConflict,
    InvalidRecordDate,
    JobAlreadyRunning,
    JobNotFound,
    MediaNotReady,
    NoTargetChildren,
)
from domains.agents.llm import AgentResponseTruncated, call_agent, call_claude, call_vision
from domains.agents.models import (
    DraftDecisionLog,
    EvidenceBundle,
    GenerationJob,
    Job,
    JobStatus,
    TeacherEvidence,
)
from domains.agents.models import SentenceEvidence as SentenceEvidenceRow
from domains.agents.models import VerificationResult as VerificationResultRow
from domains.agents.schemas import AgentTraceEvent, ChildAgentTrace, JobTraceResponse
from domains.audit import service as audit_service
from domains.documents import service as documents
from domains.documents.schemas import DraftSaveInput, DraftSentenceInput, DraftStatus
from domains.media import service as media_service
from domains.organization import service as organization_service
from domains.organization.service import ensure_class_access
from prompts.generation.draft import DraftFeedback, build_draft_prompt
from prompts.generation.roles import role_prompt
from prompts.perception.photo_analysis import build_single_photo_prompt
from prompts.verification.critic import build_critic_prompt
from tools import contracts
from tools.evidence.builder import build_evidence
from tools.evidence.routine import DailyRoutine, parse_routine, routine_json
from tools.generation.agent_tools import (
    COLLECTOR_TOOLS,
    OBSERVATION_TOOLS,
    PARENT_TOOLS,
    ToolArguments,
    tool_definitions,
    writing_guidance,
)
from tools.generation.draft import DraftResponseError, parse_draft_response
from tools.generation.pseudonymize import pseudonymize_evidence, restore_names
from tools.perception.merge import failed_photo_ids, merge_perception_results
from tools.perception.photo import parse_single_photo_analysis
from tools.perception.transcript import normalize_transcript
from tools.perception.types import (
    ChildLink,
    PerceptionResult,
    PerceptionStatus,
    PhotoInput,
    TranscriptSegmentInput,
)
from tools.verification.critic_result import parse_critic_response
from tools.verification.decision import MAX_REGENERATIONS, decide
from tools.verification.references import validate_references
from tools.verification.target import validate_target

# Critic 응답 오류(RETRY_CRITIC)만 재시도하는 횟수. CLAUDE.md 규칙상 이 재시도는 초안
# 재생성 횟수에 포함되지 않는다. 스펙에 값이 없어 1로 정했다(10/28 AI팀 PR 리뷰로 확정) —
# 늘리면 원아마다 Critic 호출이 늘어 작업 타임아웃(180초)에 가까워진다.
MAX_CRITIC_RETRIES = 1

# 백엔드 로그 형식: 모듈마다 getLogger(__name__), 정상 흐름 안의 예외 상황은 WARNING (#90).
logger = logging.getLogger(__name__)

# PASS 초안 저장이 교사 문서와 충돌해 건너뛴 경우의 로그 코드. 원인은 세분화하지 않는다 (#75).
DRAFT_SAVE_CONFLICT = "draft_save_conflict"

# 원아 1명·하루에 LLM으로 보낼 사진 수 상한. 임시 결정(송유진): 5장이면 나머지 사진이 근거에서
# 빠져서 올렸다. 서버와 같은 구성에서 약 3MB 사진 30장은 작업 제한(180초) 안인 130초에 끝났고
# 45장은 넘겼다. TODO(eun): 정확한 상한과 고르는 기준(지금은 하루 전체에서 고르게)은 확정 예정이다.
MAX_PHOTOS_PER_CHILD = 30

# 매일 도는 Job은 알림장, 관찰일지는 교사의 월별 요청에서 별도로 실행한다(#225).
DAILY_DOC_TYPE = contracts.DocType.PARENT_NOTE

# record_date는 KST 기준 하루다 (docs/api/agents.md).
_KST = ZoneInfo("Asia/Seoul")
_UNFINISHED_STATUSES = frozenset({JobStatus.PENDING, JobStatus.RUNNING})
# worker가 죽어 running으로 남은 Job이 그 반·날짜를 영구히 막지 않게, 이 시간 넘게 갱신이 없는
# running Job은 진행 중으로 보지 않는다. task 최대 소요(180초 × 3회)에 여유 60초를 더했다 (#161 리뷰, 엄태은).
# 시작할 때 RUNNING으로 바꾸며 갱신되므로 "실행을 시작한 뒤 10분"이다.
_STALE_JOB_AFTER = timedelta(seconds=180 * 3 + 60)
# pending은 큐에서 차례를 기다리는 중이라 갱신이 없는 게 정상이다. 위 10분을 그대로 쓰면 오래
# 기다린 Job을 멈춘 것으로 보고 같은 반·날짜 작업을 하나 더 만든다(#185 리뷰). 큐 메시지가
# 사라져 영영 시작하지 못하는 경우만 풀도록 훨씬 길게 둔다.
# TODO(donggeon): 1시간은 임시 결정(김동건). 정은 님 확인 대기
_STALE_PENDING_JOB_AFTER = timedelta(hours=1)


# ---------------------------------------------------------------------------
# 초안 생성 작업 시작·조회 (POST /classes/{class_id}/jobs, GET /jobs/{job_id})
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class JobDraft:
    draft_id: UUID
    doc_type: str


@dataclass(frozen=True)
class ChildJobStatus:
    child_id: UUID
    status: JobStatus
    # succeeded일 때만 채운다. 초안이 있으면 drafted, 없으면 unclassified (docs/api/agents.md).
    outcome: str | None = None
    drafts: tuple[JobDraft, ...] = ()
    stage: str | None = None
    unclassified_reason: str | None = None
    error_code: str | None = None


@dataclass(frozen=True)
class GenerationJobStatus:
    """반·날짜 작업 1건의 상태. 반 전체 값은 저장하지 않고 원아별 Job에서 계산한다 (#61)."""

    generation_job: GenerationJob
    status: JobStatus
    percent: int
    finished_children: int
    children: list[ChildJobStatus]
    updated_at: datetime


@dataclass(frozen=True)
class StartedGenerationJob:
    status: GenerationJobStatus
    # 커밋한 뒤 Celery에 넣을 (Job id, child_id). 같은 request_id로 다시 부르면 비어 있다.
    to_enqueue: list[tuple[UUID, UUID]]


def start_generation_job(
    db: Session,
    *,
    class_id: UUID,
    record_date: date,
    request_id: UUID,
    media_ids: Sequence[UUID],
    teacher_id: UUID,
    center_id: UUID | None,
) -> StartedGenerationJob:
    """서버 전송을 마친 반·날짜의 초안 생성 작업을 만든다 (FR-05, FR-06, FR-26).

    대상 원아는 그 날짜에 귀속된 자료나 추가 근거가 있는 원아 전원이다. ③ 미동의 원아도 빼지 않고,
    그 원아가 귀속된 사진만 근거 수집에서 빠진다(H-2·H-3). 커밋과 큐 넣기는 호출자가 한다.
    """
    ensure_class_access(db, class_id, center_id)
    existing = _find_job_by_request_id(db, request_id)
    if existing is not None:
        return _started_again(db, existing, center_id)

    if record_date > datetime.now(_KST).date():
        raise InvalidRecordDate("오늘보다 뒤 날짜의 초안은 만들 수 없습니다.")
    now = datetime.now(UTC)
    running_id = db.scalar(
        select(GenerationJob.id)
        .join(Job, Job.generation_job_id == GenerationJob.id)
        .where(
            GenerationJob.class_id == class_id,
            GenerationJob.record_date == record_date,
            GenerationJob.doc_type == DAILY_DOC_TYPE.value,
            or_(
                and_(
                    Job.status == JobStatus.RUNNING.value,
                    Job.updated_at >= now - _STALE_JOB_AFTER,
                ),
                and_(
                    Job.status == JobStatus.PENDING.value,
                    Job.updated_at >= now - _STALE_PENDING_JOB_AFTER,
                ),
            ),
        )
        .limit(1)
    )
    if running_id is not None:
        raise JobAlreadyRunning(
            "같은 날짜의 초안을 이미 만들고 있습니다.", detail={"job_id": str(running_id)}
        )
    unready = media_service.find_unready_media(db, class_id, record_date, media_ids)
    if unready:
        raise MediaNotReady(
            "아직 서버 전송이 끝나지 않은 자료가 있습니다.",
            detail={"media_ids": [str(media_id) for media_id in unready]},
        )
    child_ids = _draft_target_children(db, class_id, record_date)
    if not child_ids:
        raise NoTargetChildren("이 날짜에 원아에게 연결된 자료가 없습니다.")

    generation_job = GenerationJob(
        class_id=class_id,
        record_date=record_date,
        request_id=str(request_id),
        requested_by_teacher_id=teacher_id,
    )
    # 같은 request_id가 거의 동시에 두 번 오면 둘 다 위 조회를 통과한다. 늦은 쪽은 유일 제약에
    # 걸리므로, 그 작업을 돌려줘 문서의 멱등성을 지킨다 (#161 리뷰 4번, 엄태은).
    try:
        with db.begin_nested():
            db.add(generation_job)
            db.flush()
    except IntegrityError:
        existing = _find_job_by_request_id(db, request_id)
        if existing is None:
            raise
        return _started_again(db, existing, center_id)
    # 근거 수집이 이 값을 KST 날짜로 읽는다(collect_media_for_llm). 그 날 0시(KST)로 둔다.
    target_date = datetime.combine(record_date, time.min, tzinfo=_KST)
    jobs = [
        Job(generation_job_id=generation_job.id, child_id=child_id, target_date=target_date)
        for child_id in child_ids
    ]
    db.add_all(jobs)
    db.flush()
    return StartedGenerationJob(
        status=_job_status(db, generation_job),
        to_enqueue=[(job.id, job.child_id) for job in jobs],
    )


def _find_job_by_request_id(db: Session, request_id: UUID) -> GenerationJob | None:
    return db.scalar(select(GenerationJob).where(GenerationJob.request_id == str(request_id)))


def _started_again(
    db: Session, existing: GenerationJob, center_id: UUID | None
) -> StartedGenerationJob:
    """같은 request_id로 다시 온 요청. 새로 만들지 않고 그 작업을 돌려준다."""
    # request_id가 작업을 가리키므로, 경로의 반과 다르면 그 작업의 반으로 다시 확인한다.
    ensure_class_access(db, existing.class_id, center_id)
    return StartedGenerationJob(status=_job_status(db, existing), to_enqueue=[])


def get_generation_job(db: Session, *, job_id: UUID, center_id: UUID | None) -> GenerationJobStatus:
    """폴링용 작업 상태. 작업이 속한 반의 center 소속 교사만 본다 (FR-06)."""
    generation_job = db.get(GenerationJob, job_id)
    if generation_job is None:
        raise JobNotFound("초안 생성 작업을 찾을 수 없습니다.")
    ensure_class_access(db, generation_job.class_id, center_id)
    return _job_status(db, generation_job)


def _job_status(db: Session, generation_job: GenerationJob) -> GenerationJobStatus:
    jobs = db.scalars(
        select(Job).where(Job.generation_job_id == generation_job.id).order_by(Job.child_id)
    ).all()
    now = datetime.now(UTC)
    expired = False
    for job in jobs:
        updated = (
            job.updated_at.replace(tzinfo=UTC) if job.updated_at.tzinfo is None else job.updated_at
        )
        timeout = (
            _STALE_PENDING_JOB_AFTER if job.status == JobStatus.PENDING.value else _STALE_JOB_AFTER
        )
        if (
            job.status in {state.value for state in _UNFINISHED_STATUSES}
            and now - updated > timeout
        ):
            db.execute(
                update(Job)
                .where(Job.id == job.id, Job.status == job.status, Job.updated_at == job.updated_at)
                .values(status=JobStatus.FAILED.value, error_code="LLM_TIMEOUT")
            )
            expired = True
    if expired:
        db.commit()
    children = [_child_status(db, job, generation_job.record_date) for job in jobs]
    finished = sum(child.status not in _UNFINISHED_STATUSES for child in children)
    # 단계는 원아별 stage로 제공하고, 퍼센트는 끝난 원아 비율이다.
    percent = finished * 100 // len(children) if children else 0
    return GenerationJobStatus(
        generation_job=generation_job,
        status=_overall_status(children),
        percent=percent,
        finished_children=finished,
        children=children,
        # 원아별 Job이 바뀌어도 부모 행은 갱신되지 않으므로 가장 늦은 시각을 쓴다.
        updated_at=max(
            t if t.tzinfo else t.replace(tzinfo=UTC)
            for t in [generation_job.updated_at, *(job.updated_at for job in jobs)]
        ),
    )


def _child_status(db: Session, job: Job, record_date: date) -> ChildJobStatus:
    """이번 작업의 실패·미분류를 먼저 보고 저장한 문서 종류로 안내한다."""
    parent_job = db.get(GenerationJob, job.generation_job_id)
    doc_type = parent_job.doc_type if parent_job else DAILY_DOC_TYPE.value
    status = JobStatus(job.status)
    if status != JobStatus.SUCCEEDED:
        return ChildJobStatus(
            child_id=job.child_id, status=status, error_code=job.error_code, stage=job.stage
        )
    if job.unclassified_reason is not None:
        return ChildJobStatus(
            child_id=job.child_id,
            status=status,
            outcome="unclassified",
            unclassified_reason=job.unclassified_reason,
        )
    draft = documents.get_draft_version(
        db, child_id=job.child_id, doc_type=doc_type, record_date=record_date
    )
    if draft is None:
        return ChildJobStatus(
            child_id=job.child_id,
            status=status,
            outcome="unclassified",
            unclassified_reason=job.unclassified_reason,
        )
    return ChildJobStatus(
        child_id=job.child_id,
        status=status,
        outcome="drafted",
        drafts=(JobDraft(draft_id=draft.draft_id, doc_type=doc_type),),
    )


def _overall_status(children: Sequence[ChildJobStatus]) -> JobStatus:
    """반 전체 상태 (docs/api/agents.md 상태값).

    모두 대기면 pending, 안 끝난 원아가 있으면 running, 모두 끝났는데 실패가 1명 이상이면
    failed(나머지 원아 초안은 검토할 수 있음), 그 밖에는 succeeded.
    """
    statuses = {child.status for child in children}
    if statuses <= {JobStatus.PENDING}:
        return JobStatus.PENDING
    if statuses & _UNFINISHED_STATUSES:
        return JobStatus.RUNNING
    if JobStatus.FAILED in statuses:
        return JobStatus.FAILED
    return JobStatus.SUCCEEDED


# ---------------------------------------------------------------------------
# 추가 근거(교사 관찰 메모) 읽기·저장 (GET /classes/{class_id}/evidence,
# PUT /children/{child_id}/evidence/{record_date}) — FR-05, 2026-11-06 구현 결정
# ---------------------------------------------------------------------------

# 근거 ID 접두. 문장별 근거 행에는 출처 종류가 없어서, 미디어가 없는 근거 중 활동계획(`plan:`)과
# 교사 메모를 이 접두로 가른다.
TEACHER_NOTE_EVIDENCE_PREFIX = "note:"


@dataclass(frozen=True)
class SavedTeacherEvidence:
    evidence: TeacherEvidence
    # 처음 저장이면 True(201), 덮어썼으면 False(200)
    created: bool


def _draft_target_children(db: Session, class_id: UUID, record_date: date) -> list[UUID]:
    """초안 생성 대상. 그날 귀속된 자료가 있거나 추가 근거를 남긴 반 원아다.

    화면이 자료 없는 아이에게도 메모를 남기라고 안내하므로, 메모만 있어도 초안을 만든다
    (임시 결정(송유진), 이전에는 자료가 있는 원아만이었다).
    """
    attributed = media_service.get_attributed_children(db, class_id, record_date)
    class_children = list(organization_service.get_class_child_names(db, class_id))
    noted = db.scalars(
        select(TeacherEvidence.child_id).where(
            TeacherEvidence.child_id.in_(class_children),
            TeacherEvidence.record_date == record_date,
        )
    ).all()
    return sorted({*attributed, *noted}, key=str)


def list_teacher_evidence(
    db: Session,
    *,
    class_id: UUID,
    record_date: date,
    teacher_id: UUID,
    center_id: UUID | None,
) -> list[TeacherEvidence]:
    """그날 반 원아들의 추가 근거를 돌려준다 (아이마다 최대 한 건).

    같은 어린이집 교사만 본다(FR-25). 메모에는 아이 이름이 들어갈 수 있어 열람마다
    AccessLog를 남긴다(NFR-05, H-4) — 로그에는 ID만 둔다. 기록하지 못하면 응답하지 않는다.
    """
    ensure_class_access(db, class_id, center_id)
    child_ids = list(organization_service.get_class_child_names(db, class_id))
    if not child_ids:
        return []
    rows = list(
        db.scalars(
            select(TeacherEvidence)
            .where(
                TeacherEvidence.child_id.in_(child_ids),
                TeacherEvidence.record_date == record_date,
            )
            .order_by(TeacherEvidence.created_at, TeacherEvidence.id)
        )
    )
    for row in rows:
        audit_service.record_access(
            db,
            actor_type="teacher",
            actor_id=teacher_id,
            target_type="teacher_evidence",
            target_id=row.id,
            action="view_list",
        )
    db.commit()
    return rows


def save_teacher_evidence(
    db: Session,
    *,
    child_id: UUID,
    record_date: date,
    activity_time: str,
    text: str,
    teacher_id: UUID,
    center_id: UUID | None,
) -> SavedTeacherEvidence:
    """아이·날짜의 추가 근거를 저장한다. 이미 있으면 덮어쓴다 (아이·날짜당 1건).

    같은 어린이집 원아만 쓸 수 있다(FR-25). 마지막으로 쓴 교사가 작성자가 된다.
    임시 결정(정은): 오늘(KST)보다 뒤 날짜는 초안 생성과 같게 `INVALID_RECORD_DATE`로 막는다.
    """
    organization_service.ensure_child_access(db, child_id, center_id)
    if record_date > datetime.now(_KST).date():
        raise InvalidRecordDate("오늘보다 뒤 날짜의 추가 근거는 남길 수 없습니다.")

    def apply(row: TeacherEvidence) -> None:
        row.activity_time = activity_time
        row.text = text
        row.author_teacher_id = teacher_id

    def find() -> TeacherEvidence | None:
        return db.scalar(
            select(TeacherEvidence).where(
                TeacherEvidence.child_id == child_id,
                TeacherEvidence.record_date == record_date,
            )
        )

    row = find()
    created = row is None
    if row is None:
        row = TeacherEvidence(id=uuid4(), child_id=child_id, record_date=record_date)
        apply(row)
        db.add(row)
    else:
        apply(row)
    try:
        db.commit()
    except IntegrityError:
        # 같은 아이·날짜를 두 곳에서 처음 저장한 경우다. 먼저 들어간 행을 덮어쓴다.
        db.rollback()
        row = find()
        if row is None:
            raise
        apply(row)
        created = False
        db.commit()
    db.refresh(row)
    return SavedTeacherEvidence(evidence=row, created=created)


# ---------------------------------------------------------------------------
# 문장별 근거 조회 (documents의 교사용 초안 상세가 부른다)
# ---------------------------------------------------------------------------

# 근거 행에 출처 종류를 저장하지 않아 미디어 종류로 정한다. 영상은 발화만 근거로 쓰므로
# (테크스펙 §요청사항 2) video_speech다. 미디어가 없으면 근거 ID 접두로 교사 메모와
# 활동계획을 가른다.
_SOURCE_TYPE_BY_MEDIA_TYPE = {
    "photo": contracts.SourceType.PHOTO_OBSERVATION,
    "voice_memo": contracts.SourceType.TEACHER_VOICE_MEMO,
    "video": contracts.SourceType.VIDEO_SPEECH,
}

# 시각이 없는 근거끼리만 비교되는 자리 채움 값이다 (정렬 키의 앞 항목이 이미 구분한다).
_NO_TIME = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class SentenceEvidenceView:
    """문장 하나를 뒷받침하는 근거 (docs/api/documents.md §GET /drafts/{draft_id} evidences[]).

    text는 비식별화 전 원문이라 실명이 있을 수 있다. 검수 권한이 있는 교사 화면에만 싣고
    LLM·로그로 보내지 않는다 (H-1, H-2, H-4).
    """

    evidence_id: str
    source_type: str
    text: str
    media_id: UUID | None
    start_ms: int | None
    end_ms: int | None
    captured_at: datetime | None
    source_document_id: UUID | None = None


def list_sentence_evidences(db: Session, draft_id: UUID) -> dict[str, list[SentenceEvidenceView]]:
    """초안의 문장별 근거를 sentence_id로 묶어 돌려준다 (FR-07).

    권한 판정과 열람 기록은 부르는 쪽(documents)이 한다. 근거가 없는 문장은 키가 없다 — 교사가
    고친 문장의 근거를 비우는 것도 documents가 정한다 (documents.md §PATCH).

    임시 결정(정은): 근거 행에 출처 종류·끝 시각을 저장하지 않아서 source_type은 미디어 종류로
    정하고 end_ms는 null이다. 영상 속 교사 관찰 발화는 생성 때 teacher_voice_memo였어도
    여기서는 video_speech로 보인다. TODO(eun): 영상 근거를 쓰기 시작하면 SentenceEvidence에
    source_type·end_ms를 저장한다(테크스펙 먼저).
    """
    rows = db.scalars(
        select(SentenceEvidenceRow)
        .where(SentenceEvidenceRow.draft_id == draft_id)
        .order_by(SentenceEvidenceRow.sentence_id, SentenceEvidenceRow.evidence_id)
    ).all()
    media = media_service.get_media_meta(
        db, [row.source_media_id for row in rows if row.source_media_id is not None]
    )
    result: dict[str, list[SentenceEvidenceView]] = {}
    for row in rows:
        meta = media.get(row.source_media_id) if row.source_media_id is not None else None
        if meta is not None:
            source_type = _SOURCE_TYPE_BY_MEDIA_TYPE[meta.type]
        elif row.source_document_id:
            source_type = contracts.SourceType.PARENT_NOTE
        elif row.evidence_id.startswith(TEACHER_NOTE_EVIDENCE_PREFIX):
            source_type = contracts.SourceType.TEACHER_NOTE
        else:
            source_type = contracts.SourceType.ACTIVITY_PLAN
        result.setdefault(row.sentence_id, []).append(
            SentenceEvidenceView(
                source_document_id=row.source_document_id,
                evidence_id=row.evidence_id,
                source_type=source_type.value,
                text=row.source_text,
                media_id=row.source_media_id,
                start_ms=(
                    round(row.source_timestamp * 1000) if row.source_timestamp is not None else None
                ),
                end_ms=None,
                captured_at=meta.captured_at if meta is not None else None,
            )
        )
    for views in result.values():
        # 출처마다 evidence_id 접두가 달라 문자열 순이 시간 순이 아니다. 촬영 시각, 영상·음성 안의
        # 시각 순으로 보여 주고 값이 없는 근거(활동계획)는 뒤에 둔다.
        views.sort(
            key=lambda view: (
                view.captured_at is None,
                view.captured_at or _NO_TIME,
                view.start_ms is None,
                view.start_ms or 0,
                view.evidence_id,
            )
        )
    return result


def list_failed_photo_ids(session: Session, bundle_id: UUID | None) -> list[UUID]:
    """권한을 확인한 교사 초안 상세가 쓰는 분석 제외 사진 목록(#155)."""
    bundle = session.get(EvidenceBundle, bundle_id) if bundle_id else None
    return [UUID(media_id) for media_id in bundle.failed_photo_ids] if bundle else []


def orchestrate_drafts(job_id: str, child_id: str) -> None:
    """원아 한 명의 초안을 만든다. 초안 저장이나 미분류로 끝나면 Job을 SUCCEEDED로 둔다.

    예외는 잡지 않고 올린다 — 재시도와 최종 실패 표시는 tasks.py의 Celery 설정이
    record_job_retry / mark_job_failed로 처리한다.
    """
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        if job.status in {JobStatus.SUCCEEDED.value, JobStatus.FAILED.value}:
            return
        _set_job_status(session, job, JobStatus.RUNNING)
        parent_job = session.get(GenerationJob, job.generation_job_id)
        doc_type = contracts.DocType(parent_job.doc_type) if parent_job else DAILY_DOC_TYPE
        # 사진 분석을 포함한 외부 호출 전에 보호 여부와 잠금 버전을 읽는다 (#75·#257).
        existing = documents.get_draft_version(
            session,
            child_id=UUID(child_id),
            doc_type=doc_type,
            record_date=(
                job.target_date if job.target_date.tzinfo else job.target_date.replace(tzinfo=UTC)
            )
            .astimezone(_KST)
            .date(),
        )
        if existing is not None and (
            existing.status != DraftStatus.VERIFIED or existing.has_teacher_edits
        ):
            _finish_draft_conflict(session, job)
            return
        expected_version = existing.version if existing else None
        # 중복 전달 또는 시간 초과로 이미 종료된 작업은 다시 생성하지 않는다.
        _agent_trace(session, job, "collector", "started", stage="collecting_evidence")
        bundle = (
            _monthly_bundle(session, job)
            if doc_type == contracts.DocType.OBSERVATION_LOG
            else _collect_evidence(session, child_id, job.target_date)
        )

        # 재생성 상한은 tools/verification/decision.py의 decide()가 판정한다
        # (MAX_REGENERATIONS). 여기서 별도로 횟수를 세지 않고, decide()가
        # NEEDS_TEACHER_REVIEW를 낼 때까지 regeneration_count를 그대로 늘려서 넘긴다.
        regeneration_count = 0
        # 재생성은 같은 초안의 새 버전이다 (documents DraftDocument 설계).
        draft_id = str(existing.draft_id) if existing else str(uuid4())
        version = existing.ai_version + 1 if existing else 1
        previous: contracts.DraftDocument | None = None
        issues: list[contracts.VerificationIssue] = []
        # 인식 결과(사진 분석 LLM 포함)는 재생성마다 다시 만들지 않는다. 루프 안에서 부르면
        # 재생성 2회에 사진 호출이 최대 3배가 된다 (#137 리뷰, 송유진).
        reason = "verification_failed"
        try:
            inputs = (
                _load_monthly_inputs(session, bundle)
                if doc_type == contracts.DocType.OBSERVATION_LOG
                else _load_generation_inputs(bundle)
            )
            inputs = _prepare_agent_inputs(session, job, bundle, inputs)
        except InsufficientEvidence:
            reason = (
                "insufficient_evidence"
                if doc_type == contracts.DocType.OBSERVATION_LOG
                or organization_service.has_consent(session, UUID(child_id), "face_feature")
                else "no_consent"
            )
            _send_to_unclassified(session, job_id, child_id, reason=reason)
            _commit_job_succeeded(session, job)
            return
        except AgentExecutionError as error:
            if str(error) != "AGENT_ROUTINE_INVALID":
                raise
            _send_to_unclassified(session, job_id, child_id, reason="verification_failed")
            _commit_job_succeeded(session, job)
            return
        except PhotoAnalysisFailed:
            _send_to_unclassified(session, job_id, child_id, reason="photo_analysis_failed")
            _commit_job_succeeded(session, job)
            return
        while True:
            try:
                generated = _generate_draft(
                    inputs, draft_id=draft_id, version=version, previous=previous, issues=issues
                )
            except InsufficientEvidence:
                reason = (
                    "insufficient_evidence"
                    if doc_type == contracts.DocType.OBSERVATION_LOG
                    or organization_service.has_consent(session, UUID(child_id), "face_feature")
                    else "no_consent"
                )
                # 빈 초안을 정상 결과로 내지 않는다 (ai-data-contract.md "근거 부족").
                break
            except DraftResponseError as error:
                # 7-A 출력형식 실패. Critic 없이 재생성하고, 상한을 넘으면 미분류함으로
                # 보낸다 — Job 예외로 끝내지 않는다 (agents CLAUDE.md, #137 리뷰).
                issue = contracts.VerificationIssue(
                    check_type=contracts.VerificationCheckType.DRAFT_RESPONSE_ERROR,
                    reason=str(error),
                )
                decision = _record_draft_response_error(
                    session, draft_id, version, issue, regeneration_count
                )
                if decision == contracts.Decision.NEEDS_TEACHER_REVIEW:
                    break
                issues = [issue]
                regeneration_count += 1
                version += 1
                continue
            previous = generated.document

            _agent_trace(session, job, "critic", "started", stage="verifying")
            decision_result = _verify_with_critic_retry(
                session,
                generated.document,
                generated.masked_evidence_by_id,
                generated.request,
                regeneration_count,
            )

            _agent_trace(session, job, "critic", decision_result.decision.value)
            if decision_result.decision == contracts.Decision.PASS:
                if inputs.doc_type == contracts.DocType.OBSERVATION_LOG:
                    _ensure_monthly_sources_current(session, inputs)
                saved = _save_passed_draft(
                    session,
                    job,
                    bundle,
                    _restore_names(generated),
                    generated.source_evidence_by_id,
                    expected_version=expected_version,
                )
                if saved is False:
                    _finish_draft_conflict(session, job)
                    return
                _commit_job_succeeded(session, job)
                return
            if decision_result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW:
                break
            # 남은 경우는 REGENERATE뿐이다 — 걸린 문제를 넘겨 초안을 다시 만든다.
            issues = decision_result.issues
            regeneration_count += 1
            version += 1

        _send_to_unclassified(session, job_id, child_id, reason=reason)
        _commit_job_succeeded(session, job)


def _finish_draft_conflict(session: Session, job: Job) -> None:
    """기존 문서를 보존한 요청은 새 생성 성공으로 알리지 않는다 (FR-05, #257)."""
    job_id = job.id
    session.rollback()
    changed = session.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == JobStatus.RUNNING.value)
        .values(status=JobStatus.FAILED.value, error_code="DRAFT_VERSION_CONFLICT")
    )
    if changed.rowcount:
        job.status = JobStatus.FAILED.value
        job.error_code = "DRAFT_VERSION_CONFLICT"
    session.commit()


def _commit_job_succeeded(session: Session, job: Job) -> None:
    """초안·근거(또는 미분류 기록)와 성공 상태를 한 번에 커밋한다.

    미분류도 예외가 아니라 정상 종료다 (docs/api/agents.md 상태값). 따로 커밋하면 초안은
    저장됐는데 상태 커밋만 실패해 Job이 FAILED로 끝날 수 있다 (#102 리뷰, 엄태은).
    """
    # 조회 중 제한 시간을 넘겨 실패로 종료된 작업을 늦은 worker가 되살리지 않는다.
    changed = session.execute(
        update(Job)
        .where(Job.id == job.id, Job.status != JobStatus.FAILED.value)
        .values(status=JobStatus.SUCCEEDED.value)
    )
    if changed.rowcount == 0:
        session.rollback()
        return
    job.status = JobStatus.SUCCEEDED.value
    session.commit()


def record_job_retry(job_id: str) -> None:
    """Celery가 재시도를 걸 때 부른다. 횟수만 올리고 상태는 건드리지 않는다.

    Celery는 다음 시도를 먼저 보낸 뒤 이 훅을 부르므로, 훅이 도착할 때 다음 시도가 이미
    끝났을 수 있다. 여기서 상태를 쓰면 succeeded·failed가 running으로 되돌아간다
    (#102 리뷰, 엄태은). RUNNING은 다음 시도가 시작할 때 orchestrate_drafts가 둔다.
    횟수는 읽고 쓰는 사이에 다른 갱신이 끼지 않게 UPDATE 한 문장으로 올린다.
    """
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        session.execute(update(Job).where(Job.id == job.id).values(retry_count=Job.retry_count + 1))
        session.commit()


def mark_job_failed(job_id: str, *, error_code: str = "INTERNAL_ERROR") -> None:
    """재시도를 다 쓰거나 재시도 대상이 아닌 오류로 끝났을 때 부른다.

    이미 SUCCEEDED로 커밋된 Job은 덮어쓰지 않는다. 시간 제한이 커밋 직후에 터지는 것처럼
    성공 뒤에 실패 훅이 오는 경우가 있다 (#102 리뷰, 엄태은). 읽고 쓰는 사이에 상태가
    바뀌지 않게 조건을 UPDATE 한 문장에 건다.

    오류 원문 대신 화면에서 안내할 error_code만 남긴다. 단계별 기록은 후속 과제다.
    """
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        session.execute(
            update(Job)
            .where(Job.id == job.id, Job.status != JobStatus.SUCCEEDED.value)
            .values(status=JobStatus.FAILED.value, error_code=error_code)
        )
        session.commit()


def _set_job_status(session: Session, job: Job, status: JobStatus) -> None:
    job.status = status.value
    session.commit()


def _verify_with_critic_retry(
    session: Session,
    document: contracts.DraftDocument,
    evidence_by_id: dict[str, contracts.EvidenceItem],
    request: contracts.GenerationRequest,
    regeneration_count: int,
) -> contracts.DecisionResult:
    """RETRY_CRITIC만 MAX_CRITIC_RETRIES만큼 별도로 재시도한다.

    상한을 다 쓰고도 Critic 응답 오류가 계속되면 NEEDS_TEACHER_REVIEW로 넘긴다.
    Critic 응답 오류는 초안 문장 내용이 아니라 Critic 쪽 문제라 재생성으로는
    해결되지 않는다 (PR #33 리뷰, EatRawLife).
    """
    result = _verify_and_record(session, document, evidence_by_id, request, regeneration_count)
    for critic_retry_count in range(1, MAX_CRITIC_RETRIES + 1):
        if result.decision != contracts.Decision.RETRY_CRITIC:
            return result
        result = _verify_and_record(
            session,
            document,
            evidence_by_id,
            request,
            regeneration_count,
            critic_retry_count=critic_retry_count,
        )

    if result.decision == contracts.Decision.RETRY_CRITIC:
        return contracts.DecisionResult(
            decision=contracts.Decision.NEEDS_TEACHER_REVIEW,
            reason="Critic 재시도 상한에 도달했습니다.",
            issues=result.issues,
        )
    return result


def _get_job(session: Session, job_id: str) -> Job:
    job = session.get(Job, UUID(job_id))
    if job is None:
        raise ValueError(f"Job {job_id} not found")
    return job


def _collect_evidence(session: Session, child_id: str, target_date: datetime) -> EvidenceBundle:
    """원아 한 명의 하루치 근거를 모아 EvidenceBundle로 저장한다 (파이프라인 3단계, FR-07).

    미디어는 media.collect_media_for_llm으로만 받는다. 동의·llm_allowed·파기 필터(H-2)는
    그 함수가 하므로 여기서 규칙을 복제하지 않는다 (PR #12 리뷰, 김동건). 실명 치환도
    여기서 하지 않는다 — 매핑을 적용한 입력 가공은 AI 쪽 담당이다 (ai-data-contract.md
    "내부 ID와 LLM 입력").

    빈 Bundle도 저장하며, 생성에 쓸 관찰 근거가 없으면 orchestrate_drafts가 미분류로 끝낸다.
    """
    media = _cap_photos(media_service.collect_media_for_llm(session, UUID(child_id), target_date))
    bundle = EvidenceBundle(
        id=uuid4(),
        child_id=UUID(child_id),
        date=target_date,
        media_refs=[str(item.media_id) for item in media],
        # TODO(eun): media.TranscriptPart에 segment_id가 생기면 구간 단위로 가리킨다.
        #   지금은 발화가 있는 미디어 id로 둔다 (EvidenceBundleResponse.transcript_refs: list[str]).
        transcript_refs=[str(item.media_id) for item in media if item.transcript],
        # TODO(eun): 발달지침·교사 문체의 출처(organization TeacherPersona 등)가 연결되면 채운다.
        #   키는 테크스펙 데이터 모델 ④의 두 고정 키를 그대로 둔다.
        context_lookup={"developmental_guideline": None, "teacher_persona": None},
    )
    session.add(bundle)
    session.commit()
    return bundle


def _cap_photos(media: list[media_service.MediaEvidence]) -> list[media_service.MediaEvidence]:
    """사진을 MAX_PHOTOS_PER_CHILD장까지만 남긴다. 영상·음성은 1차 근거라 자르지 않는다
    (NFR-08).

    collect_media_for_llm이 촬영 시각 순으로 주므로, 앞에서 자르면 오전 사진만 남는다.
    하루 전체에서 고르게 뽑는다 — 처음·마지막 사진을 포함해 같은 간격으로 고른다
    (#103 리뷰, 김동건).
    """
    photo_positions = [i for i, item in enumerate(media) if item.type == "photo"]
    if len(photo_positions) <= MAX_PHOTOS_PER_CHILD:
        return media

    step = (len(photo_positions) - 1) / (MAX_PHOTOS_PER_CHILD - 1)
    kept = {photo_positions[round(i * step)] for i in range(MAX_PHOTOS_PER_CHILD)}
    return [item for i, item in enumerate(media) if item.type != "photo" or i in kept]


# 사진 분석 응답이 형식을 어기면 그 사진만 이만큼 다시 부른다. 호출 예외는 여기서 잡지 않고
# Celery task 재시도가 맡는다 (테크스펙 §오류 복구 '사진 분석 응답 오류', #155).
PHOTO_RESPONSE_RETRIES = 1


def _photo_inputs(media: Sequence[media_service.MediaEvidence]) -> list[PhotoInput]:
    """근거 미디어 중 사진을 사진 분석 입력으로 바꾼다.

    귀속(child_links)은 브라우저 얼굴 인식과 교사 확정을 거쳐 저장된 값을 그대로 옮긴다.
    귀속이 없는 사진은 근거로 쓸 수 없어 뺀다 — collect_media_for_llm은 대상 원아에게 귀속된
    미디어만 주므로 정상이라면 생기지 않는다.
    """
    return [
        PhotoInput(
            media_id=str(item.media_id),
            captured_at=item.captured_at
            if item.captured_at.tzinfo
            else item.captured_at.replace(tzinfo=UTC),
            links=tuple(
                ChildLink(child_id=str(link.child_id), method=link.method)
                for link in item.child_links
            ),
        )
        for item in media
        if item.type == "photo" and item.child_links
    ]


def _analyze_photos(
    session: Session, photos: Sequence[PhotoInput], *, target_child_id: str, record_date: date
) -> list[tuple[PhotoInput, PerceptionResult]]:
    """사진을 1장씩 분석해 (사진, 결과) 짝으로 돌려준다 (파이프라인 5단계, NFR-09).

    결과는 tools.perception.merge.merge_perception_results에 그대로 넘긴다. 다시 불러도 응답
    오류인 사진도 빼지 않고 RESPONSE_ERROR 결과로 둔다 — 빼면 사진이 모두 실패했을 때 근거가
    없는 경우와 구분되지 않는다 (merge.py). 사진은 S3 서명 URL로 넘긴다(llm.call_vision).
    LLM에는 이미지와 아이 수만 가고 media_id·child_id·이름은 가지 않는다 (H-2).
    """
    urls = {
        signed.media_id: signed.url
        for signed in media_service.get_signed_urls(
            session, [UUID(photo.media_id) for photo in photos]
        )
    }
    results = []
    for photo in photos:
        prompt = build_single_photo_prompt(photo)
        for _ in range(PHOTO_RESPONSE_RETRIES + 1):
            raw = call_vision(prompt.instructions, [urls[UUID(photo.media_id)]])
            result = parse_single_photo_analysis(
                raw, photo=photo, target_child_id=target_child_id, record_date=record_date
            )
            if result.status != PerceptionStatus.RESPONSE_ERROR:
                break
        results.append((photo, result))
    return results


class PhotoAnalysisFailed(Exception):
    """사진 분석 형식 오류로 사용할 관찰이 남지 않았다."""


class InsufficientEvidence(Exception):
    """생성에 쓸 관찰 근거가 없다. 미분류함으로 보낸다."""


@dataclass(frozen=True)
class GenerationInputs:
    """초안 생성에 필요한, 서버 안에만 있는 값."""

    request: contracts.GenerationRequest
    # 동의·귀속 필터(H-2)를 이미 거친 근거 후보. 실명 호명이 본문에 남아 있을 수 있다.
    evidence: list[contracts.EvidenceItem]
    # **반 원아 전체**의 원아 ID → 본문에서 토큰으로 바꿀 이름들. 근거에 귀속되지 않은 원아도
    # 발화에서 불릴 수 있다 (#137 리뷰). 첫 값은 저장 전 본문에 되돌려 넣는 호칭이다.
    # LLM에 보내지 않는다.
    names_by_child_id: dict[str, list[str]]
    doc_type: contracts.DocType = contracts.DocType.PARENT_NOTE
    routine: DailyRoutine | None = None
    age_band: str = "unknown"
    trace: Callable[[str, str, str | None], None] | None = None
    source_versions: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True)
class GeneratedDraft:
    """생성 한 번의 결과. 검증에는 토큰 사본을, 저장에는 원본을 쓴다 (#137 리뷰)."""

    # 본문이 CHILD_A류 토큰 그대로인 초안. 검증(Critic)에 그대로 넘긴다.
    document: contracts.DraftDocument
    # 실명을 토큰으로 바꾼 근거 사본. LLM으로 가는 검증에만 쓴다 (H-2).
    masked_evidence_by_id: dict[str, contracts.EvidenceItem]
    # 원본 근거. 교사 근거 패널(SentenceEvidence.source_text, FR-07)에 저장한다.
    source_evidence_by_id: dict[str, contracts.EvidenceItem]
    request: contracts.GenerationRequest
    # CHILD_A → 호칭. 서버 안에만 둔다.
    name_by_token: dict[str, str]


def _load_generation_inputs(bundle: EvidenceBundle) -> GenerationInputs:
    """동의 게이트를 다시 통과한 사진만 분석해 실제 생성 입력으로 연결한다(H-2, FR-05)."""
    session = object_session(bundle)
    if session is None:
        raise ValueError("EvidenceBundle must belong to a session")
    target_date = bundle.date
    if target_date.tzinfo is None:
        target_date = target_date.replace(tzinfo=UTC)
    record_date = target_date.astimezone(_KST).date()
    class_id = organization_service.get_child_class_id(session, bundle.child_id)
    names = organization_service.get_class_child_names(session, class_id)
    # 수집 이후 동의가 철회되었거나 자료가 바뀐 경우에도 외부 호출 전에 제외한다.
    allowed = media_service.collect_media_for_llm(session, bundle.child_id, record_date)
    media = [item for item in allowed if str(item.media_id) in bundle.media_refs]
    segments = [
        TranscriptSegmentInput(
            segment_id=str(segment.segment_id),
            media_id=str(item.media_id),
            source=segment.source or ("video_audio" if item.type == "video" else "voice_memo"),
            captured_at=item.captured_at
            if item.captured_at.tzinfo
            else item.captured_at.replace(tzinfo=UTC),
            start_time=segment.start_time,
            end_time=segment.end_time,
            raw_text=segment.raw_text,
            text=segment.text if segment.text is not None else segment.raw_text,
            speaker=segment.speaker,
            child_ids=tuple(str(link.child_id) for link in item.child_links),
            excluded=False,
        )
        for item in media
        if item.type in {"video", "voice_memo"}
        for segment in item.transcript
        if segment.segment_id is not None
    ]
    merged = merge_perception_results(
        normalize_transcript(
            segments, target_child_id=str(bundle.child_id), record_date=record_date
        ),
        _analyze_photos(
            session,
            _photo_inputs([item for item in media if item.type == "photo"]),
            target_child_id=str(bundle.child_id),
            record_date=record_date,
        ),
        target_child_id=str(bundle.child_id),
        record_date=record_date,
    )
    bundle.failed_photo_ids = failed_photo_ids(merged)
    if merged.status == PerceptionStatus.RESPONSE_ERROR:
        raise PhotoAnalysisFailed
    evidence = list(merged.items)
    # 교사가 글로 남긴 추가 근거는 그 아이·그날의 관찰이다(FR-05). 생성 때마다 새로 읽으므로
    # 저장 뒤 다음 생성부터 반영되고, 이미 만든 초안은 바뀌지 않는다.
    for note in session.scalars(
        select(TeacherEvidence).where(
            TeacherEvidence.child_id == bundle.child_id,
            TeacherEvidence.record_date == record_date,
        )
    ):
        evidence.append(
            contracts.EvidenceItem(
                evidence_id=f"{TEACHER_NOTE_EVIDENCE_PREFIX}{note.id}",
                source_type=contracts.SourceType.TEACHER_NOTE,
                child_ids=[str(bundle.child_id)],
                observed_date=record_date,
                text=note.text,
                assignment_status=contracts.AssignmentStatus.TEACHER_CONFIRMED,
            )
        )
    # FR-05: 다른 요일의 계획을 해당 날짜의 관찰 맥락으로 섞지 않는다.
    weekday = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[record_date.weekday()]
    for plan in organization_service.get_activity_plans_for_date(session, class_id, record_date):
        evidence.append(
            contracts.EvidenceItem(
                evidence_id=f"plan:{plan.plan_id}",
                source_type=contracts.SourceType.ACTIVITY_PLAN,
                child_ids=[str(bundle.child_id)],
                observed_date=record_date,
                text=" / ".join(
                    part
                    for part in [plan.title, plan.goal, plan.daily_activities.get(weekday, "")]
                    if part
                ),
                assignment_status=contracts.AssignmentStatus.TEACHER_CONFIRMED,
            )
        )
    return GenerationInputs(
        request=contracts.GenerationRequest(
            request_id=str(bundle.id),
            class_id=str(class_id),
            child_id=str(bundle.child_id),
            record_date=record_date,
            evidence_ids=[item.evidence_id for item in evidence],
        ),
        evidence=evidence,
        names_by_child_id={str(key): value for key, value in names.items()},
    )


def _generate_draft(
    inputs: GenerationInputs,
    *,
    draft_id: str,
    version: int,
    previous: contracts.DraftDocument | None,
    issues: Sequence[contracts.VerificationIssue],
) -> GeneratedDraft:
    """근거 선별 → 비식별화 → 프롬프트 → LLM → DraftDocument (파이프라인 6단계, FR-05·FR-07).

    응답 형식이 깨졌으면 DraftResponseError를 올린다. 호출하는 쪽이 7-A 실패로 기록하고
    재생성한다.
    """
    request = inputs.request
    # 프롬프트·검증·저장 모두 builder 결과의 키를 기준으로 한다 (#117 리뷰).
    selected = build_evidence(inputs.evidence, request=request)
    if not any(
        item.source_type != contracts.SourceType.ACTIVITY_PLAN for item in selected.values()
    ):
        # 활동계획만 남으면 모든 문장이 PLAN_AS_OBSERVED_FACT로 걸려 재생성 상한까지
        # 돌기만 한다. 관찰 근거가 없는 것과 같게 본다 (#117 리뷰).
        raise InsufficientEvidence

    masked = pseudonymize_evidence(
        selected,
        target_child_id=request.child_id,
        names_by_child_id=inputs.names_by_child_id,
    )
    if inputs.routine is None:
        raise AgentExecutionError("AGENT_ROUTINE_MISSING")
    role = "observation" if inputs.doc_type == contracts.DocType.OBSERVATION_LOG else "parent_note"
    routine = routine_json(inputs.routine, masked.llm_items)
    feedback = _to_feedback(issues, previous=previous)
    if role == "observation":
        prompt = (
            role_prompt("observation")
            + "\n자료:\n"
            + routine
            + "\n피드백:\n"
            + json.dumps([asdict(f) for f in feedback], ensure_ascii=False)
        )
        tools = OBSERVATION_TOOLS
    else:
        prompt = build_draft_prompt(inputs.doc_type, masked.llm_items, feedback, routine=routine)
        tools = PARENT_TOOLS
    if inputs.trace:
        inputs.trace(role, "started", None)
    raw = _agent_conversation(
        role=role,
        prompt=prompt,
        names=tools,
        required=set(tools),
        execute=lambda name, args: writing_guidance(
            name, age_band=inputs.age_band, focus=args.focus
        ),
        trace=inputs.trace,
    )
    document = parse_draft_response(
        raw,
        evidence_id_by_ref={
            ref: eid
            for ref, eid in masked.evidence_id_by_ref.items()
            if ref in {r for fact in inputs.routine.facts for r in fact.evidence_refs}
        },
        doc_type=inputs.doc_type,
        child_id=request.child_id,
        record_date=request.record_date,
        draft_id=draft_id,
        version=version,
    )
    if inputs.trace:
        inputs.trace(role, "completed", None)
    return GeneratedDraft(
        document=document,
        masked_evidence_by_id=masked.evidence_by_id,
        source_evidence_by_id=selected,
        request=request,
        name_by_token={
            token: inputs.names_by_child_id[child_id][0]
            for token, child_id in masked.child_id_by_token.items()
            if inputs.names_by_child_id[child_id]
        },
    )


def _restore_names(generated: GeneratedDraft) -> contracts.DraftDocument:
    """통과한 초안의 토큰을 호칭으로 되돌린다. 저장 직전에만 부른다 — 검증은 토큰으로 한다."""
    data = generated.document.model_dump()
    for sentence in data["sentences"]:
        sentence["text"] = restore_names(sentence["text"], generated.name_by_token)
    return contracts.DraftDocument.model_validate(data)


def _record_draft_response_error(
    session: Session,
    draft_id: str,
    version: int,
    issue: contracts.VerificationIssue,
    regeneration_count: int,
) -> contracts.Decision:
    """생성 응답 형식 오류를 문서 전체 사유로 남기고 다음 행동을 정한다 (#141).

    응답을 초안으로 읽지 못해 decide()를 거칠 수 없으므로, 재생성 상한만 같은 값
    (MAX_REGENERATIONS)으로 판정한다.
    """
    decision = (
        contracts.Decision.NEEDS_TEACHER_REVIEW
        if regeneration_count >= MAX_REGENERATIONS
        else contracts.Decision.REGENERATE
    )
    checked_at = datetime.now(UTC)
    session.add(
        VerificationResultRow(
            draft_id=UUID(draft_id),
            doc_version=version,
            check_type=issue.check_type.value,
            sentence_id=None,
            result=False,
            detail=issue.reason,
            checked_at=checked_at,
        )
    )
    session.add(
        DraftDecisionLog(
            draft_id=UUID(draft_id),
            doc_version=version,
            decision=decision.value,
            reason=issue.reason,
            regeneration_count=regeneration_count,
            critic_retry_count=0,
            checked_at=checked_at,
        )
    )
    session.commit()
    return decision


def _to_feedback(
    issues: Sequence[contracts.VerificationIssue],
    *,
    previous: contracts.DraftDocument | None,
) -> list[DraftFeedback]:
    """검증 문제를 LLM에 보낼 피드백으로 바꾼다.

    서버 ID(근거 ID)는 싣지 않는다. 코드 검증 사유에는 근거 ID가 섞여 있어 문제 종류만
    넘기고, Critic 사유는 토큰으로 된 입력에서 나온 문장이라 그대로 넘긴다.
    """
    text_by_sentence_id = (
        {sentence.sentence_id: sentence.text for sentence in previous.sentences} if previous else {}
    )
    return [
        DraftFeedback(
            problem=issue.check_type.value,
            sentence=text_by_sentence_id.get(issue.sentence_id) if issue.sentence_id else None,
            detail=(
                issue.reason
                if issue.check_type == contracts.VerificationCheckType.CRITIC_CONTENT
                else "응답 형식이 잘못되었거나 출력 한도를 넘었습니다. 문장 수와 길이를 줄이고 완전한 JSON 하나만 작성하세요."
                if issue.check_type == contracts.VerificationCheckType.DRAFT_RESPONSE_ERROR
                else None
            ),
        )
        for issue in issues
    ]


def _verify_and_record(
    session: Session,
    document: contracts.DraftDocument,
    evidence_by_id: dict[str, contracts.EvidenceItem],
    request: contracts.GenerationRequest,
    regeneration_count: int,
    critic_retry_count: int = 0,
) -> contracts.DecisionResult:
    """7-A 코드 검증(references/target) → 7-B Critic → 최종 판정까지 실행하고 기록한다.

    코드 검증에서 실패하면 Critic을 호출하지 않는다 (CLAUDE.md: "거기서 실패하면
    Critic을 호출하지 않고 바로 재생성"). 연결 방식은
    tests/agents/fixtures/verification_flow.py의 verify_example과 같다.

    검증 기록(VerificationResult·DraftDecisionLog)만 남기고 커밋한다. PASS여도 문장별
    근거는 여기서 남기지 않는다 — 본문 저장과 같은 트랜잭션으로 묶어야 해서
    _save_passed_draft가 맡는다 (#75 3번).
    """
    code_checks = (
        (
            contracts.VerificationStage.REFERENCES,
            validate_references(document, evidence_by_id),
        ),
        (
            contracts.VerificationStage.TARGET,
            validate_target(document, evidence_by_id, request=request),
        ),
    )
    stage_results: list[contracts.VerificationResult] = [
        contracts.VerificationResult(
            draft_id=document.draft_id,
            doc_type=document.doc_type,
            doc_version=document.version,
            stage=stage,
            passed=not issues,
            issues=issues,
        )
        for stage, issues in code_checks
    ]

    if all(result.passed for result in stage_results):
        stage_results.append(_run_critic(document, evidence_by_id))

    decision_result = decide(stage_results, regeneration_count, document=document)

    _record_verification_issues(session, document, stage_results)
    session.add(
        DraftDecisionLog(
            draft_id=UUID(document.draft_id),
            doc_version=document.version,
            decision=decision_result.decision.value,
            reason=decision_result.reason,
            regeneration_count=regeneration_count,
            critic_retry_count=critic_retry_count,
            checked_at=datetime.now(UTC),
        )
    )
    session.commit()

    return decision_result


def _save_passed_draft(
    session: Session,
    job: Job,
    bundle: EvidenceBundle,
    document: contracts.DraftDocument,
    evidence_by_id: dict[str, contracts.EvidenceItem],
    *,
    expected_version: int | None = None,
) -> bool:
    """PASS한 초안을 documents에 저장하고, 문장별 근거를 같은 트랜잭션에 남긴다 (FR-05, FR-07).

    커밋은 하지 않는다 — orchestrate_drafts가 Job 성공 상태와 함께 한 번에 커밋한다
    (#102 리뷰). 저장이 충돌하면 근거까지 되돌려서,
    저장되지 않은 draft_id나 반영되지 않은 AI 초안을 가리키는 근거가 남지 않게 한다
    (#75 3번). 검증 기록은 _verify_and_record가 이미 커밋해서 되돌려지지 않는다.

    충돌하면 교사 문서를 그대로 두고 False를 반환한다. 호출자가 실패 안내로 종료하며
    미분류함에는 보내지 않는다 (#257).
    """
    data = DraftSaveInput(
        # agents가 만든 draft_id로 저장해야 검증 기록과 문서가 서로를 찾는다 (#75 2번).
        draft_id=UUID(document.draft_id),
        child_id=document.child_id,
        author_teacher_id=_author_teacher_id(session, job),
        doc_type=document.doc_type.value,
        record_date=document.record_date,
        # 문장 단위·순서 그대로 넘긴다. 합쳤다가 다시 자르면 근거와 어긋난다 (#75 ①).
        sentences=[
            DraftSentenceInput(
                sentence_id=sentence.sentence_id, text=sentence.text, section=sentence.section
            )
            for sentence in document.sentences
        ],
        ai_version=document.version,
        evidence_bundle_id=bundle.id,
        # 근거로 쓴 사진을 보낼 사진의 기본 선택으로 넘긴다. 비어 있으면 교사가 매번 골라야 하고
        # 게시해도 글만 나간다(9주차 #257 리뷰 4번). 근거 사진은 collect_media_for_llm을 거친
        # 그 원아의 사진이라 학부모에게 보여도 되는 범위 안이다. 공개는 승인·게시가 따로 정한다(H-1).
        selected_media_ids=_photo_media_ids(evidence_by_id),
    )
    try:
        documents.save_draft(session, data, expected_version=expected_version)
        if expected_version is not None:
            # sentence_id를 재사용하므로 이전 본문의 근거도 같은 트랜잭션에서 교체한다.
            session.execute(
                delete(SentenceEvidenceRow).where(SentenceEvidenceRow.draft_id == data.draft_id)
            )
        _record_sentence_evidence(session, document, evidence_by_id)
        return True
    except DraftVersionConflict:
        session.rollback()
        # 검증 PASS 기록은 남았는데 문서가 없는 이유를 나중에 추적하려고 남긴다 (#90).
        # 서버 id와 코드만 남기고 본문·실명은 넣지 않는다 (H-4).
        logger.warning(
            "draft save skipped: code=%s job_id=%s draft_id=%s",
            DRAFT_SAVE_CONFLICT,
            job.id,
            document.draft_id,
        )
        return False


def _photo_media_ids(evidence_by_id: dict[str, contracts.EvidenceItem]) -> list[UUID]:
    """생성에 쓴 근거 중 사진의 media_id. 근거 순서(촬영 시각 순)를 지키고 중복은 한 번만 쓴다."""
    return list(
        dict.fromkeys(
            UUID(item.media_id)
            for item in evidence_by_id.values()
            if item.source_type == contracts.SourceType.PHOTO_OBSERVATION and item.media_id
        )
    )


def _author_teacher_id(session: Session, job: Job) -> UUID:
    """초안의 작성 교사. 요청한 교사를 GenerationJob에서 읽는다 (FR-26, 테크스펙 데이터 모델 ④).

    Child → Class로 유추하지 않는다 — 비동기 task에는 세션 교사가 없어서, 요청 시점에
    저장해 둔 교사를 쓴다 (#75 4번).
    """
    generation_job = session.get(GenerationJob, job.generation_job_id)
    if generation_job is None:
        raise ValueError(f"GenerationJob {job.generation_job_id} not found")
    return generation_job.requested_by_teacher_id


def _run_critic(
    document: contracts.DraftDocument,
    evidence_by_id: dict[str, contracts.EvidenceItem],
) -> contracts.VerificationResult:
    """Critic에는 서버 근거 ID 대신 E1… 임시 참조를 보내고, 결과를 서버 ID로 되돌린다.

    근거 ID에는 media_id·segment_id가 들어 있어 외부 LLM으로 보내지 않는다
    (ai-data-contract.md "내부 ID와 LLM 입력", #137 리뷰). 참조 번호는 evidence_by_id 순서라
    생성 프롬프트의 E1…과 같고, 코드 검증(references·target)은 서버 ID 그대로 한다.
    코드 검증을 통과한 뒤에만 불리므로 문장의 근거 ID는 모두 evidence_by_id에 있다.
    """
    evidence_id_by_ref = {
        f"E{index}": evidence_id for index, evidence_id in enumerate(evidence_by_id, start=1)
    }
    ref_by_evidence_id = {evidence_id: ref for ref, evidence_id in evidence_id_by_ref.items()}

    critic_document = contracts.DraftDocument.model_validate(
        {
            **document.model_dump(),
            "sentences": [
                {
                    **sentence.model_dump(),
                    "evidence_ids": [ref_by_evidence_id[eid] for eid in sentence.evidence_ids],
                }
                for sentence in document.sentences
            ],
        }
    )
    critic_evidence = {
        ref: contracts.EvidenceItem.model_validate(
            {**evidence_by_id[evidence_id].model_dump(), "evidence_id": ref}
        )
        for ref, evidence_id in evidence_id_by_ref.items()
    }

    result = parse_critic_response(
        call_claude(build_critic_prompt(critic_document, critic_evidence)), critic_document
    )
    return contracts.VerificationResult.model_validate(
        {
            **result.model_dump(),
            "issues": [
                {
                    **issue.model_dump(),
                    "evidence_ids": [evidence_id_by_ref[ref] for ref in issue.evidence_ids],
                }
                for issue in result.issues
            ],
        }
    )


def _record_verification_issues(
    session: Session,
    document: contracts.DraftDocument,
    stage_results: list[contracts.VerificationResult],
) -> None:
    """검증에서 나온 실패(issue)를 VerificationResult에 남긴다.

    통과 자체(문서 전체의 최종 판정)는 DraftDecisionLog가 담당한다. 이 함수는
    개별 검사 실패 사유만 남긴다 — VerificationCheckType 8종(PR #7의 7종 + draft_response_error)이
    전부 실패 사유라, 통과한 개별 검사 하나하나를 나타낼 값이 없기 때문이다.
    """
    for stage_result in stage_results:
        for issue in stage_result.issues:
            session.add(
                VerificationResultRow(
                    draft_id=UUID(document.draft_id),
                    doc_version=document.version,
                    check_type=issue.check_type.value,
                    sentence_id=issue.sentence_id,
                    result=False,
                    detail=issue.reason,
                    checked_at=datetime.now(UTC),
                )
            )


def _record_sentence_evidence(
    session: Session,
    document: contracts.DraftDocument,
    evidence_by_id: dict[str, contracts.EvidenceItem],
) -> None:
    """통과한 초안의 문장별 근거를 남긴다 (FR-07).

    문장 하나가 근거를 여러 개 참조하면 (draft_id, sentence_id)가 같은 행을 여러 개
    만든다 (정은-한상균 합의 9/16). evidence_id를 함께 저장해 같은 문장에 같은 근거가
    중복으로 안 들어가게 (draft_id, sentence_id, evidence_id) unique 제약을 건다
    (models.py SentenceEvidence — ai-data-contract.md "근거 ID·버전 연결과 유일성
    규칙", 정은-한상균 합의 09/22).

    활동계획 근거(source_type=activity_plan)는 media가 없어 source_media_id가
    None이 된다 — models.py에서 nullable로 바꿔뒀다.

    source_timestamp는 EvidenceItem.start_ms(밀리초)를 초 단위로 바꾼 값이다 — "근거
    클릭 시 원본 영상 3초 재생"(테크스펙 SentenceEvidence)에서 재생 시작 지점으로 쓸
    것이라 판단했다. 정확한 변환·표시 방식이 스펙에 없어 팀 확인이 필요하다.
    """
    for sentence in document.sentences:
        for evidence_id in sentence.evidence_ids:
            evidence = evidence_by_id[evidence_id]
            session.add(
                SentenceEvidenceRow(
                    draft_id=UUID(document.draft_id),
                    sentence_id=sentence.sentence_id,
                    evidence_id=evidence_id,
                    source_media_id=UUID(evidence.media_id) if evidence.media_id else None,
                    source_timestamp=(
                        evidence.start_ms / 1000 if evidence.start_ms is not None else None
                    ),
                    source_document_id=UUID(evidence.source_document_id)
                    if evidence.source_document_id
                    else None,
                    source_text=evidence.text,
                )
            )


def _send_to_unclassified(
    session: Session, job_id: str, child_id: str, *, reason: str = "verification_failed"
) -> None:
    job = _get_job(session, job_id)
    target = job.target_date
    if target.tzinfo is None:
        target = target.replace(tzinfo=UTC)
    job.unclassified_reason = reason
    parent_job = session.get(GenerationJob, job.generation_job_id)
    if parent_job and parent_job.doc_type == contracts.DocType.OBSERVATION_LOG.value:
        # 월별 실패는 Job에서 안내한다. 일별 알림장 미분류함과 섞지 않는다.
        return
    documents.record_unclassified(
        session,
        child_id=UUID(child_id),
        record_date=target.astimezone(_KST).date(),
        reason=reason,
        job_id=UUID(job_id),
    )


class AgentExecutionError(RuntimeError):
    """안전한 코드만 담는 실행 실패. 모델 본문·도구 인자는 담지 않는다."""


MAX_AGENT_TURNS = 6
MAX_AGENT_INPUT_CHARS = 60_000


def _agent_conversation(
    *,
    role: str,
    prompt: str,
    names: tuple[str, ...],
    required: set[str],
    execute: Callable[[str, ToolArguments], str],
    trace: Callable[[str, str, str | None], None] | None = None,
) -> str:
    """네이티브 function calling의 유한 루프. 역할마다 대화는 새로 시작한다(FR-05)."""
    messages = [{"role": "user", "content": prompt}]
    called: set[str] = set()
    results: dict[str, tuple[ToolArguments, str]] = {}
    for _ in range(MAX_AGENT_TURNS):
        if len(json.dumps(messages, ensure_ascii=False)) > MAX_AGENT_INPUT_CHARS:
            raise AgentExecutionError("AGENT_INPUT_TOO_LARGE")
        try:
            response = call_agent(messages, tool_definitions(names))
        except AgentResponseTruncated:
            raise DraftResponseError(
                "출력 한도를 넘었습니다. 사실·문장 수와 길이를 줄여 완전한 JSON으로 작성하세요."
            ) from None
        except ValueError:
            raise AgentExecutionError("AGENT_RESPONSE_INVALID") from None
        calls = response.tool_calls or []
        if not calls:
            if required - called:
                messages.append({"role": "assistant", "content": response.content or ""})
                messages.append(
                    {
                        "role": "user",
                        "content": "필수 도구 조회가 빠졌습니다: "
                        + ", ".join(sorted(required - called)),
                    }
                )
                continue
            if not response.content:
                raise AgentExecutionError("AGENT_RESPONSE_INVALID")
            if trace:
                trace(role, "responded", None)
            return response.content
        messages.append(
            response.model_dump(include={"role", "content", "tool_calls"}, exclude_none=True)
        )
        for call in calls:
            if call.type != "function" or call.function.name not in names:
                raise AgentExecutionError("AGENT_TOOL_NOT_ALLOWED")
            name = call.function.name
            try:
                args = ToolArguments.model_validate_json(call.function.arguments)
            except ValidationError:
                raise AgentExecutionError("AGENT_TOOL_ARGUMENTS_INVALID") from None
            if name in results:
                previous_args, result = results[name]
                if args != previous_args:
                    raise AgentExecutionError("AGENT_TOOL_LIMIT")
                # 병렬 중복 호출에도 각 call ID로 응답하되 조회는 한 번만 한다.
                messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
                continue
            # ID·URL·SQL은 도구 인자 스키마에 없다. 조회 범위는 execute의 서버 클로저에 고정.
            try:
                result = execute(name, args)
            except Exception:
                if trace:
                    trace(role, "failed", name)
                raise
            called.add(name)
            results[name] = (args, result)
            if trace:
                trace(role, "tool_completed", name)
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    raise AgentExecutionError("AGENT_STEP_LIMIT")


def _agent_trace(
    session: Session,
    job: Job,
    role: str,
    outcome: str,
    tool: str | None = None,
    *,
    stage: str | None = None,
) -> None:
    """경로 판정을 재현할 메타데이터만 기록. 생성 본문·프롬프트는 기록하지 않는다(H-4)."""
    event = {"agent": role, "outcome": outcome, "tool": tool}
    history = [*(job.agent_trace or []), event]
    # worker 재시도를 포함해도 로그가 무한히 커지지 않게 제한한다.
    job.agent_trace = history[-100:]
    if stage:
        job.stage = stage
    session.commit()


def _prepare_agent_inputs(
    session: Session, job: Job, bundle: EvidenceBundle, inputs: GenerationInputs
) -> GenerationInputs:
    selected = build_evidence(inputs.evidence, request=inputs.request)
    if not any(
        item.source_type != contracts.SourceType.ACTIVITY_PLAN for item in selected.values()
    ):
        raise InsufficientEvidence
    masked = pseudonymize_evidence(
        selected,
        target_child_id=inputs.request.child_id,
        names_by_child_id=inputs.names_by_child_id,
    )
    observed = [
        item for item in masked.llm_items if item.source_type != contracts.SourceType.ACTIVITY_PLAN
    ]

    def trace(role: str, outcome: str, tool: str | None) -> None:
        stage = "collecting_evidence" if role == "collector" else "generating"
        _agent_trace(session, job, role, outcome, tool, stage=stage)

    def execute(name: str, args: ToolArguments) -> str:
        if name == "child_roster":
            return json.dumps({"children": list(masked.child_id_by_token)})
        if name == "activity_plan":
            return json.dumps(
                {
                    "context_only": [
                        item.text
                        for item in masked.llm_items
                        if item.source_type == contracts.SourceType.ACTIVITY_PLAN
                    ]
                },
                ensure_ascii=False,
            )
        records = documents.published_records_for_agents(
            session,
            child_id=UUID(inputs.request.child_id),
            start_date=inputs.request.record_date - timedelta(days=31),
            end_date=inputs.request.record_date - timedelta(days=1),
        )
        # 과거 기록은 근거 후보로 승격하지 않는다. E 참조도 주지 않는다.
        contexts = [
            contracts.EvidenceItem(
                evidence_id=f"history:{record.document_id}",
                source_type=contracts.SourceType.ACTIVITY_PLAN,
                child_ids=[inputs.request.child_id],
                observed_date=inputs.request.record_date,
                text=record.text,
                assignment_status=contracts.AssignmentStatus.TEACHER_CONFIRMED,
            )
            for record in records
            if record.text.strip()
        ]
        safe = pseudonymize_evidence(
            {item.evidence_id: item for item in contexts},
            target_child_id=inputs.request.child_id,
            names_by_child_id=inputs.names_by_child_id,
        )
        return json.dumps(
            {"context_only": [item.text for item in safe.llm_items]}, ensure_ascii=False
        )

    # 모델이 만든 요약이 망가진 경우에도 재시도는 2회로 제한한다. 성공한 사진 분석은 반복하지 않는다.
    routine = None
    for attempt in range(MAX_REGENERATIONS + 1):
        prompt = (
            role_prompt("collector")
            + "\n관찰 자료:\n"
            + json.dumps([asdict(item) for item in observed], ensure_ascii=False)
        )
        if attempt:
            prompt += "\n이전 응답의 형식·참조·공동 귀속 구분이 잘못되었거나 출력 한도를 넘었습니다. 사실 수와 길이를 줄이고 지정한 JSON과 실제 관찰 근거만 사용하세요. shared_with_others가 다른 근거는 별도 사실로 나누세요."
        try:
            raw = _agent_conversation(
                role="collector",
                prompt=prompt,
                names=COLLECTOR_TOOLS,
                required=set(),
                execute=execute,
                trace=trace,
            )
            routine = parse_routine(raw, observed)
            trace("collector", "completed", None)
            break
        except DraftResponseError:
            trace("collector", "invalid_output", None)
    if routine is None:
        raise AgentExecutionError("AGENT_ROUTINE_INVALID")
    bundle.daily_routine = routine.model_dump(mode="json")
    session.commit()
    return replace(
        inputs,
        routine=routine,
        trace=trace,
        age_band=organization_service.get_class_age_band(session, UUID(inputs.request.class_id)),
    )


def _month_end(start: date) -> date:
    return start.replace(day=calendar.monthrange(start.year, start.month)[1])


def start_observation_job(
    db: Session,
    *,
    child_id: UUID,
    month: date,
    request_id: UUID,
    teacher_id: UUID,
    center_id: UUID | None,
) -> StartedGenerationJob:
    """교사가 요청한 원아·월만 실행. 기본 양식부터 연결한다(FR-06, #225)."""
    organization_service.ensure_child_access(db, child_id, center_id)
    month = month.replace(day=1)
    if month > datetime.now(_KST).date():
        raise InvalidRecordDate("미래 월의 관찰일지를 만들 수 없습니다.")
    # 원아 행 잠금을 커밋까지 유지해 서로 다른 request_id의 동시 요청도 하나로 모은다.
    class_id = organization_service.get_child_class_id(db, child_id, lock=True)
    existing = _find_job_by_request_id(db, request_id)
    if existing:
        return _started_again(db, existing, center_id)
    now = datetime.now(UTC)
    active = db.scalar(
        select(GenerationJob)
        .join(Job, Job.generation_job_id == GenerationJob.id)
        .where(
            Job.child_id == child_id,
            GenerationJob.record_date == month,
            GenerationJob.doc_type == contracts.DocType.OBSERVATION_LOG.value,
            or_(
                and_(
                    Job.status == JobStatus.RUNNING.value, Job.updated_at >= now - _STALE_JOB_AFTER
                ),
                and_(
                    Job.status == JobStatus.PENDING.value,
                    Job.updated_at >= now - _STALE_PENDING_JOB_AFTER,
                ),
            ),
        )
        .order_by(GenerationJob.created_at)
        .limit(1)
    )
    if active:
        return _started_again(db, active, center_id)
    records = documents.published_records_for_agents(
        db, child_id=child_id, start_date=month, end_date=_month_end(month)
    )
    if not records:
        raise NoTargetChildren("이 달에 게시된 알림장이 없습니다.")
    parent = GenerationJob(
        class_id=class_id,
        record_date=month,
        request_id=str(request_id),
        requested_by_teacher_id=teacher_id,
        doc_type=contracts.DocType.OBSERVATION_LOG.value,
    )
    try:
        with db.begin_nested():
            db.add(parent)
            db.flush()
    except IntegrityError:
        existing = _find_job_by_request_id(db, request_id)
        if existing is None:
            raise
        return _started_again(db, existing, center_id)
    job = Job(
        generation_job_id=parent.id,
        child_id=child_id,
        target_date=datetime.combine(month, time.min, tzinfo=_KST),
    )
    db.add(job)
    db.flush()
    return StartedGenerationJob(status=_job_status(db, parent), to_enqueue=[(job.id, child_id)])


def _monthly_bundle(session: Session, job: Job) -> EvidenceBundle:
    bundle = EvidenceBundle(
        child_id=job.child_id,
        date=job.target_date,
        media_refs=[],
        transcript_refs=[],
        context_lookup={"developmental_guideline": None, "teacher_persona": None},
    )
    session.add(bundle)
    session.commit()
    return bundle


def _load_monthly_inputs(session: Session, bundle: EvidenceBundle) -> GenerationInputs:
    target = bundle.date if bundle.date.tzinfo else bundle.date.replace(tzinfo=UTC)
    start = target.astimezone(_KST).date().replace(day=1)
    class_id = organization_service.get_child_class_id(session, bundle.child_id)
    records = documents.published_records_for_agents(
        session, child_id=bundle.child_id, start_date=start, end_date=_month_end(start)
    )
    evidence = [
        contracts.EvidenceItem(
            evidence_id=f"note:{record.document_id}",
            source_document_id=str(record.document_id),
            source_type=contracts.SourceType.PARENT_NOTE,
            child_ids=[str(bundle.child_id)],
            observed_date=record.record_date,
            text=record.text,
            assignment_status=contracts.AssignmentStatus.TEACHER_CONFIRMED,
        )
        for record in records
        if record.text.strip()
    ]
    if not evidence:
        raise InsufficientEvidence
    return GenerationInputs(
        request=contracts.GenerationRequest(
            request_id=str(bundle.id),
            class_id=str(class_id),
            child_id=str(bundle.child_id),
            record_date=start,
            period_end=_month_end(start),
            evidence_ids=[item.evidence_id for item in evidence],
        ),
        evidence=evidence,
        names_by_child_id={
            str(k): v
            for k, v in organization_service.get_class_child_names(session, class_id).items()
        },
        doc_type=contracts.DocType.OBSERVATION_LOG,
        source_versions=tuple((str(record.document_id), record.version) for record in records),
    )


def _ensure_monthly_sources_current(session: Session, inputs: GenerationInputs) -> None:
    current = documents.published_records_for_agents(
        session,
        child_id=UUID(inputs.request.child_id),
        start_date=inputs.request.record_date,
        end_date=inputs.request.period_end,
        lock=True,
    )
    versions = {str(record.document_id): record.version for record in current}
    if any(versions.get(key) != version for key, version in inputs.source_versions):
        raise AgentExecutionError("AGENT_SOURCE_CHANGED")


def get_job_trace(db: Session, *, job_id: UUID, center_id: UUID | None) -> JobTraceResponse:
    get_generation_job(db, job_id=job_id, center_id=center_id)
    jobs = db.scalars(
        select(Job).where(Job.generation_job_id == job_id).order_by(Job.child_id)
    ).all()
    return JobTraceResponse(
        job_id=job_id,
        children=[
            ChildAgentTrace(
                child_id=job.child_id,
                events=[AgentTraceEvent.model_validate(event) for event in (job.agent_trace or [])],
            )
            for job in jobs
        ],
    )


def get_daily_routine(db: Session, bundle_id: UUID | None) -> list[str]:
    """documents의 교사 권한 확인 후에만 호출한다. 외부/학부모 응답에는 포함하지 않는다(FR-27)."""
    bundle = db.get(EvidenceBundle, bundle_id) if bundle_id else None
    if bundle is None or not bundle.daily_routine:
        return []
    class_id = organization_service.get_child_class_id(db, bundle.child_id)
    names = {
        str(key): value
        for key, value in organization_service.get_class_child_names(db, class_id).items()
    }
    # 다른 원아 토큰은 반 구성 변경으로 순서가 달라질 수 있다. 현재 명단으로 과거
    # CHILD_B…를 다른 아이 이름에 연결하지 않고, 대상 원아만 복원한다.
    routine = DailyRoutine.model_validate(bundle.daily_routine)
    target_names = names.get(str(bundle.child_id), [])
    by_token = {"CHILD_A": target_names[0] if target_names else "대상 원아"}
    for fact in routine.facts:
        for token in re.findall(r"CHILD_[A-Z]+", fact.text):
            by_token.setdefault(token, "친구")
    return [restore_names(fact.text, by_token) for fact in routine.facts]
