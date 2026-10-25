"""근거수집 → 초안생성 → Critic 검증 오케스트레이션.

tasks.py는 이 모듈의 orchestrate_drafts만 호출합니다 (CLAUDE.md: tasks.py는 로직을 갖지 않음).
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.exceptions import (
    DraftVersionConflict,
    InvalidRecordDate,
    JobAlreadyRunning,
    JobNotFound,
    MediaNotReady,
    NoTargetChildren,
)
from domains.agents.llm import call_claude
from domains.agents.models import (
    DraftDecisionLog,
    EvidenceBundle,
    GenerationJob,
    Job,
    JobStatus,
)
from domains.agents.models import SentenceEvidence as SentenceEvidenceRow
from domains.agents.models import VerificationResult as VerificationResultRow
from domains.documents import service as documents
from domains.documents.schemas import DraftSaveInput
from domains.media import service as media_service
from domains.organization.service import ensure_class_access
from prompts.generation.draft import DraftFeedback, build_draft_prompt
from prompts.verification.critic import build_critic_prompt
from tools import contracts
from tools.evidence.builder import build_evidence
from tools.generation.draft import DraftResponseError, parse_draft_response
from tools.generation.pseudonymize import pseudonymize_evidence, restore_names
from tools.verification.critic_result import parse_critic_response
from tools.verification.decision import MAX_REGENERATIONS, decide
from tools.verification.references import validate_references
from tools.verification.target import validate_target

# Critic 응답 오류(RETRY_CRITIC)만 재시도하는 횟수. CLAUDE.md 규칙상 이 재시도는 초안
# 재생성 횟수에 포함되지 않는다. 상한 값 자체는 스펙에 없어 무한 루프 방지용으로 1을
# 임의로 골랐다 — 팀 확인 필요.
MAX_CRITIC_RETRIES = 1

# 백엔드 로그 형식: 모듈마다 getLogger(__name__), 정상 흐름 안의 예외 상황은 WARNING (#90).
logger = logging.getLogger(__name__)

# PASS 초안 저장이 교사 문서와 충돌해 건너뛴 경우의 로그 코드. 원인은 세분화하지 않는다 (#75).
DRAFT_SAVE_CONFLICT = "draft_save_conflict"

# 원아 1명·하루에 LLM으로 보낼 사진 수 상한. agents CLAUDE.md의 "3~5장 권장"에서 위쪽 값을
# 골랐다. TODO(eun): 정확한 상한과 고르는 기준(지금은 하루 전체에서 고르게)은 확정 예정이다.
MAX_PHOTOS_PER_CHILD = 5

# 매일 도는 Job이 만드는 문서. 관찰일지는 주기·양식이 원마다 달라 생성 조건이 정해진 뒤
# 따로 붙인다 (#115, open-questions 32번).
DAILY_DOC_TYPE = contracts.DocType.PARENT_NOTE

# record_date는 KST 기준 하루다 (docs/api/agents.md).
_KST = ZoneInfo("Asia/Seoul")
_UNFINISHED_STATUSES = frozenset({JobStatus.PENDING, JobStatus.RUNNING})


# ---------------------------------------------------------------------------
# 초안 생성 작업 시작·조회 (POST /classes/{class_id}/jobs, GET /jobs/{job_id})
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChildJobStatus:
    child_id: UUID
    status: JobStatus


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

    대상 원아는 그 날짜에 귀속된 자료가 있는 원아 전원이다. ③ 미동의 원아도 빼지 않고,
    그 원아가 귀속된 사진만 근거 수집에서 빠진다(H-2·H-3). 커밋과 큐 넣기는 호출자가 한다.
    """
    ensure_class_access(db, class_id, center_id)
    existing = db.scalar(select(GenerationJob).where(GenerationJob.request_id == str(request_id)))
    if existing is not None:
        # request_id가 작업을 가리키므로, 경로의 반과 다르면 그 작업의 반으로 다시 확인한다.
        ensure_class_access(db, existing.class_id, center_id)
        return StartedGenerationJob(status=_job_status(db, existing), to_enqueue=[])

    if record_date > datetime.now(_KST).date():
        raise InvalidRecordDate("오늘보다 뒤 날짜의 초안은 만들 수 없습니다.")
    running_id = db.scalar(
        select(GenerationJob.id)
        .join(Job, Job.generation_job_id == GenerationJob.id)
        .where(
            GenerationJob.class_id == class_id,
            GenerationJob.record_date == record_date,
            Job.status.in_([status.value for status in _UNFINISHED_STATUSES]),
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
    child_ids = media_service.get_attributed_children(db, class_id, record_date)
    if not child_ids:
        raise NoTargetChildren("이 날짜에 원아에게 연결된 자료가 없습니다.")

    generation_job = GenerationJob(
        class_id=class_id,
        record_date=record_date,
        request_id=str(request_id),
        requested_by_teacher_id=teacher_id,
    )
    db.add(generation_job)
    db.flush()
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
    children = [ChildJobStatus(child_id=job.child_id, status=JobStatus(job.status)) for job in jobs]
    finished = sum(child.status not in _UNFINISHED_STATUSES for child in children)
    # TODO(eun): 문서의 진행률은 원아별로 끝낸 단계 수로 세지만 Job에 단계 컬럼이 없다.
    #   지금은 끝난 원아 비율로 센다 (docs/api/agents.md 임시 결정(정은)).
    percent = finished * 100 // len(children) if children else 0
    return GenerationJobStatus(
        generation_job=generation_job,
        status=_overall_status(children),
        percent=percent,
        finished_children=finished,
        children=children,
        # 원아별 Job이 바뀌어도 부모 행은 갱신되지 않으므로 가장 늦은 시각을 쓴다.
        updated_at=max([generation_job.updated_at, *(job.updated_at for job in jobs)]),
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


def orchestrate_drafts(job_id: str, child_id: str) -> None:
    """원아 한 명의 초안을 만든다. 초안 저장이나 미분류로 끝나면 Job을 SUCCEEDED로 둔다.

    예외는 잡지 않고 올린다 — 재시도와 최종 실패 표시는 tasks.py의 Celery 설정이
    record_job_retry / mark_job_failed로 처리한다.
    """
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        _set_job_status(session, job, JobStatus.RUNNING)
        bundle = _collect_evidence(session, child_id, job.target_date)

        # 재생성 상한은 tools/verification/decision.py의 decide()가 판정한다
        # (MAX_REGENERATIONS). 여기서 별도로 횟수를 세지 않고, decide()가
        # NEEDS_TEACHER_REVIEW를 낼 때까지 regeneration_count를 그대로 늘려서 넘긴다.
        regeneration_count = 0
        # 재생성은 같은 초안의 새 버전이다 (documents DraftDocument 설계).
        # TODO(eun): 같은 원아·종류·날짜 문서가 이미 있으면 get_draft_version(#140)으로
        #   draft_id·버전을 이어받는다 (#133 리뷰). 지금은 Job마다 새 초안으로 시작한다.
        draft_id = str(uuid4())
        version = 1
        previous: contracts.DraftDocument | None = None
        issues: list[contracts.VerificationIssue] = []
        # 인식 결과(사진 분석 LLM 포함)는 재생성마다 다시 만들지 않는다. 루프 안에서 부르면
        # 재생성 2회에 사진 호출이 최대 3배가 된다 (#137 리뷰, 송유진).
        inputs = _load_generation_inputs(bundle)
        while True:
            try:
                generated = _generate_draft(
                    inputs, draft_id=draft_id, version=version, previous=previous, issues=issues
                )
            except InsufficientEvidence:
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

            decision_result = _verify_with_critic_retry(
                session,
                generated.document,
                generated.masked_evidence_by_id,
                generated.request,
                regeneration_count,
            )

            if decision_result.decision == contracts.Decision.PASS:
                _save_passed_draft(
                    session,
                    job,
                    bundle,
                    _restore_names(generated),
                    generated.source_evidence_by_id,
                )
                _commit_job_succeeded(session, job)
                return
            if decision_result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW:
                break
            # 남은 경우는 REGENERATE뿐이다 — 걸린 문제를 넘겨 초안을 다시 만든다.
            issues = decision_result.issues
            regeneration_count += 1
            version += 1

        _send_to_unclassified(session, job_id, child_id)
        _commit_job_succeeded(session, job)


def _commit_job_succeeded(session: Session, job: Job) -> None:
    """초안·근거(또는 미분류 기록)와 성공 상태를 한 번에 커밋한다.

    미분류도 예외가 아니라 정상 종료다 (docs/api/agents.md 상태값). 따로 커밋하면 초안은
    저장됐는데 상태 커밋만 실패해 Job이 FAILED로 끝날 수 있다 (#102 리뷰, 엄태은).
    """
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


def mark_job_failed(job_id: str) -> None:
    """재시도를 다 쓰거나 재시도 대상이 아닌 오류로 끝났을 때 부른다.

    이미 SUCCEEDED로 커밋된 Job은 덮어쓰지 않는다. 시간 제한이 커밋 직후에 터지는 것처럼
    성공 뒤에 실패 훅이 오는 경우가 있다 (#102 리뷰, 엄태은). 읽고 쓰는 사이에 상태가
    바뀌지 않게 조건을 UPDATE 한 문장에 건다.

    TODO(eun): docs/api/agents.md의 error_code·failed_stage를 채울 컬럼이 Job에 없다.
    agents 모델 후속 마이그레이션에서 추가한 뒤 여기서 함께 남긴다.
    """
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        session.execute(
            update(Job)
            .where(Job.id == job.id, Job.status != JobStatus.SUCCEEDED.value)
            .values(status=JobStatus.FAILED.value)
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
    job = session.get(Job, job_id)
    if job is None:
        raise ValueError(f"Job {job_id} not found")
    return job


def _collect_evidence(session: Session, child_id: str, target_date: datetime) -> EvidenceBundle:
    """원아 한 명의 하루치 근거를 모아 EvidenceBundle로 저장한다 (파이프라인 3단계, FR-07).

    미디어는 media.collect_media_for_llm으로만 받는다. 동의·llm_allowed·파기 필터(H-2)는
    그 함수가 하므로 여기서 규칙을 복제하지 않는다 (PR #12 리뷰, 김동건). 실명 치환도
    여기서 하지 않는다 — 매핑을 적용한 입력 가공은 AI 쪽 담당이다 (ai-data-contract.md
    "내부 ID와 LLM 입력").

    TODO(eun): 근거가 하나도 없을 때 미분류함으로 보내는 기준은 "근거 부족 상태 계약"
      (ai-data-contract.md, 태은님과 합의)이 정해지면 연결한다. 지금은 빈 Bundle을 저장한다.
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
    """Bundle의 미디어를 근거(EvidenceItem)로 바꾸고 반 원아 이름을 모은다.

    orchestrate_drafts가 재생성 루프 전에 한 번만 부른다 — 사진 분석 LLM이 재생성마다
    다시 돌지 않게 하기 위함이다 (#137 리뷰).

    TODO(eun): 인식 결과 병합(#128, 송유진)이 develop에 들어오면 bundle.media_refs의
      사진 분석·발화 정규화 결과를 합쳐 evidence로 넘긴다. GenerationRequest.class_id도
      그때 Child에서 채운다. merged.status가 응답 오류면 근거 부족(InsufficientEvidence)과
      구분해 다룬다 — 둘 다 items가 비어 같은 길로 떨어지면 #128에서 나눈 상태가 사라진다.
    TODO(이한나): 반 원아 전체의 이름 목록(호칭·성명·이름)을 주는 organization 함수가
      필요하다. 이름 없이 보내면 발화 속 호명이 LLM에 그대로 가므로(H-2) 비워 두고
      진행하지 않는다 — tools/generation/pseudonymize.py가 이름이 빠진 원아를 거부한다.
    """
    raise NotImplementedError("인식 결과 병합(#128)과 원아 이름 조회 연결 후 동작합니다.")


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
    prompt = build_draft_prompt(
        DAILY_DOC_TYPE, masked.llm_items, _to_feedback(issues, previous=previous)
    )
    document = parse_draft_response(
        call_claude(prompt),
        evidence_id_by_ref=masked.evidence_id_by_ref,
        doc_type=DAILY_DOC_TYPE,
        child_id=request.child_id,
        record_date=request.record_date,
        draft_id=draft_id,
        version=version,
    )
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
            draft_id=draft_id,
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
            draft_id=draft_id,
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
            draft_id=document.draft_id,
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
) -> None:
    """PASS한 초안을 documents에 저장하고, 문장별 근거를 같은 트랜잭션에 남긴다 (FR-05, FR-07).

    커밋은 하지 않는다 — orchestrate_drafts가 Job 성공 상태와 함께 한 번에 커밋한다
    (#102 리뷰). 저장이 충돌하면 근거까지 되돌려서,
    저장되지 않은 draft_id나 반영되지 않은 AI 초안을 가리키는 근거가 남지 않게 한다
    (#75 3번). 검증 기록은 _verify_and_record가 이미 커밋해서 되돌려지지 않는다.

    충돌하면 교사 문서를 그대로 두고 돌아온다. 원아 Job은 성공으로 끝내고 미분류함에는
    보내지 않는다 (#75 6번).
    """
    data = DraftSaveInput(
        # agents가 만든 draft_id로 저장해야 검증 기록과 문서가 서로를 찾는다 (#75 2번).
        draft_id=document.draft_id,
        child_id=document.child_id,
        author_teacher_id=_author_teacher_id(session, job),
        doc_type=document.doc_type.value,
        record_date=document.record_date,
        content=_join_sentences(document),
        ai_version=document.version,
        evidence_bundle_id=bundle.id,
    )
    try:
        # TODO(eun): 같은 원아·종류·날짜 문서가 이미 있으면 documents의 get_draft_version
        #   (#75 5번, 한상균)으로 버전을 읽어 재생성으로 저장한다. 교사가 수정·승인한 문서면
        #   건너뛴다(#75 6-1). 그 함수가 생기기 전에는 항상 최초 저장으로 보내므로, 이미 있는
        #   문서는 충돌로 거부되고 그대로 남는다.
        documents.save_draft(session, data, expected_version=None)
        _record_sentence_evidence(session, document, evidence_by_id)
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


def _author_teacher_id(session: Session, job: Job) -> UUID:
    """초안의 작성 교사. 요청한 교사를 GenerationJob에서 읽는다 (FR-26, 테크스펙 데이터 모델 ④).

    Child → Class로 유추하지 않는다 — 비동기 task에는 세션 교사가 없어서, 요청 시점에
    저장해 둔 교사를 쓴다 (#75 4번).
    """
    generation_job = session.get(GenerationJob, job.generation_job_id)
    if generation_job is None:
        raise ValueError(f"GenerationJob {job.generation_job_id} not found")
    return generation_job.requested_by_teacher_id


def _join_sentences(document: contracts.DraftDocument) -> str:
    """문장을 줄바꿈으로 합친 본문.

    TODO(eun): 문장 단위 저장(#75 ①)이 documents 스키마에 들어오면 합치지 않고
    sentence_id·순서째로 넘긴다. 그전까지 DraftSaveInput.content가 문자열 하나라 임시로 합친다.
    """
    return "\n".join(sentence.text for sentence in document.sentences)


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
    개별 검사 실패 사유만 남긴다 — PR #7의 VerificationCheckType 7종이 전부
    실패 사유라, 통과한 개별 검사 하나하나를 나타낼 값이 없기 때문이다.
    """
    for stage_result in stage_results:
        for issue in stage_result.issues:
            session.add(
                VerificationResultRow(
                    draft_id=document.draft_id,
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
                    draft_id=document.draft_id,
                    sentence_id=sentence.sentence_id,
                    evidence_id=evidence_id,
                    source_media_id=evidence.media_id,
                    source_timestamp=(
                        evidence.start_ms / 1000 if evidence.start_ms is not None else None
                    ),
                    source_text=evidence.text,
                )
            )


def _send_to_unclassified(session: Session, job_id: str, child_id: str) -> None:
    # TODO(eun): documents 도메인의 UnclassifiedItem이 준비되면 여기로 기록합니다.
    # 재시도 상한을 넘겨도 예외로 터뜨리지 않고 이 함수로 떨어뜨립니다 (CLAUDE.md 규칙).
    pass
