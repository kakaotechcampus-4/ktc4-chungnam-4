"""근거수집 → 초안생성 → Critic 검증 오케스트레이션.

tasks.py는 이 모듈의 orchestrate_drafts만 호출합니다 (CLAUDE.md: tasks.py는 로직을 갖지 않음).
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.exceptions import DraftVersionConflict
from domains.agents.llm import call_claude
from domains.agents.models import DraftDecisionLog, EvidenceBundle, GenerationJob, Job
from domains.agents.models import SentenceEvidence as SentenceEvidenceRow
from domains.agents.models import VerificationResult as VerificationResultRow
from domains.documents import service as documents
from domains.documents.schemas import DraftSaveInput
from domains.media import service as media_service
from prompts.generation.draft import DraftFeedback, build_draft_prompt
from prompts.verification.critic import build_critic_prompt
from tools import contracts
from tools.evidence.builder import build_evidence
from tools.generation.draft import parse_draft_response
from tools.generation.pseudonymize import pseudonymize_evidence
from tools.verification.critic_result import parse_critic_response
from tools.verification.decision import decide
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

GeneratedDraft = tuple[
    contracts.DraftDocument,
    dict[str, contracts.EvidenceItem],
    contracts.GenerationRequest,
]


def orchestrate_drafts(job_id: str, child_id: str) -> None:
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        bundle = _collect_evidence(session, child_id, job.target_date)

        # 재생성 상한은 tools/verification/decision.py의 decide()가 판정한다
        # (MAX_REGENERATIONS). 여기서 별도로 횟수를 세지 않고, decide()가
        # NEEDS_TEACHER_REVIEW를 낼 때까지 regeneration_count를 그대로 늘려서 넘긴다.
        regeneration_count = 0
        previous: contracts.DraftDocument | None = None
        issues: list[contracts.VerificationIssue] = []
        while True:
            try:
                document, evidence_by_id, request = _generate_draft(
                    bundle, previous=previous, issues=issues
                )
            except InsufficientEvidence:
                # 빈 초안을 정상 결과로 내지 않는다 (ai-data-contract.md "근거 부족").
                break
            previous = document

            decision_result = _verify_with_critic_retry(
                session, document, evidence_by_id, request, regeneration_count
            )

            if decision_result.decision == contracts.Decision.PASS:
                _save_passed_draft(session, job, bundle, document, evidence_by_id)
                return
            if decision_result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW:
                break
            # 남은 경우는 REGENERATE뿐이다 — 걸린 문제를 넘겨 초안을 다시 만든다.
            issues = decision_result.issues
            regeneration_count += 1

        _send_to_unclassified(session, job_id, child_id)


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
    """생성에 쓸 수 있는 근거가 하나도 없다. 미분류함으로 보낸다."""


@dataclass(frozen=True)
class GenerationInputs:
    """초안 생성에 필요한, 서버 안에만 있는 값."""

    request: contracts.GenerationRequest
    # 동의·귀속 필터(H-2)를 이미 거친 근거 후보. 실명 호명이 본문에 남아 있을 수 있다.
    evidence: list[contracts.EvidenceItem]
    # 원아 ID → 본문에서 토큰으로 바꿀 이름들. LLM에 보내지 않는다.
    names_by_child_id: dict[str, list[str]]


def _load_generation_inputs(bundle: EvidenceBundle) -> GenerationInputs:
    """Bundle의 미디어를 근거(EvidenceItem)로 바꾸고 원아 이름을 모은다.

    TODO(eun): 인식 결과 병합(#128, 송유진)이 develop에 들어오면 bundle.media_refs의
      사진 분석·발화 정규화 결과를 합쳐 evidence로 넘긴다. GenerationRequest.class_id도
      그때 Child에서 채운다.
    TODO(이한나): 근거에 등장한 원아의 이름 목록(성명·이름)을 주는 organization 함수가
      필요하다. 이름 없이 보내면 발화 속 호명이 LLM에 그대로 가므로(H-2) 비워 두고
      진행하지 않는다 — tools/generation/pseudonymize.py가 이름이 빠진 원아를 거부한다.
    """
    raise NotImplementedError("인식 결과 병합(#128)과 원아 이름 조회 연결 후 동작합니다.")


def _generate_draft(
    bundle: EvidenceBundle,
    *,
    previous: contracts.DraftDocument | None,
    issues: Sequence[contracts.VerificationIssue],
) -> GeneratedDraft:
    """근거 선별 → 비식별화 → 프롬프트 → LLM → DraftDocument (파이프라인 6단계, FR-05·FR-07).

    반환하는 evidence_by_id는 **실명을 토큰으로 바꾼 사본**이다. 검증 단계의 Critic
    프롬프트가 이 본문을 그대로 싣기 때문이다 (H-2).

    재생성이면 이전 초안의 draft_id를 그대로 쓰고 version을 올린다 — 재생성은 같은 초안의
    새 버전이다 (documents DraftDocument 설계).
    """
    inputs = _load_generation_inputs(bundle)
    request = inputs.request
    selected = build_evidence(inputs.evidence, request=request)
    if not selected:
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
        draft_id=previous.draft_id if previous else str(uuid4()),
        version=previous.version + 1 if previous else 1,
    )
    return document, masked.evidence_by_id, request


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
        prompt = build_critic_prompt(document, evidence_by_id)
        raw_response = call_claude(prompt)
        stage_results.append(parse_critic_response(raw_response, document))

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

    본문 저장과 근거 저장을 한 번에 커밋한다. 저장이 충돌하면 근거까지 되돌려서,
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
        session.commit()
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
    sentence_index_by_id = {
        sentence.sentence_id: index for index, sentence in enumerate(document.sentences)
    }
    for stage_result in stage_results:
        for issue in stage_result.issues:
            session.add(
                VerificationResultRow(
                    draft_id=document.draft_id,
                    check_type=issue.check_type.value,
                    sentence_index=(
                        sentence_index_by_id.get(issue.sentence_id) if issue.sentence_id else None
                    ),
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

    문장 하나가 근거를 여러 개 참조하면 (draft_id, sentence_index)가 같은 행을 여러 개
    만든다 (정은-한상균 합의 9/16). evidence_id를 함께 저장해 같은 문장에 같은 근거가
    중복으로 안 들어가게 (draft_id, sentence_index, evidence_id) unique 제약을 건다
    (models.py SentenceEvidence — ai-data-contract.md "근거 ID·버전 연결과 유일성
    규칙", 정은-한상균 합의 09/22).

    활동계획 근거(source_type=activity_plan)는 media가 없어 source_media_id가
    None이 된다 — models.py에서 nullable로 바꿔뒀다.

    source_timestamp는 EvidenceItem.start_ms(밀리초)를 초 단위로 바꾼 값이다 — "근거
    클릭 시 원본 영상 3초 재생"(테크스펙 SentenceEvidence)에서 재생 시작 지점으로 쓸
    것이라 판단했다. 정확한 변환·표시 방식이 스펙에 없어 팀 확인이 필요하다.
    """
    for index, sentence in enumerate(document.sentences):
        for evidence_id in sentence.evidence_ids:
            evidence = evidence_by_id[evidence_id]
            session.add(
                SentenceEvidenceRow(
                    draft_id=document.draft_id,
                    sentence_index=index,
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
