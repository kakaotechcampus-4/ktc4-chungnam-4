"""근거수집 → 초안생성 → Critic 검증 오케스트레이션.

tasks.py는 이 모듈의 orchestrate_drafts만 호출합니다 (CLAUDE.md: tasks.py는 로직을 갖지 않음).
"""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.database import SessionLocal
from domains.agents.llm import call_claude
from domains.agents.models import DraftDecisionLog, EvidenceBundle, Job
from domains.agents.models import SentenceEvidence as SentenceEvidenceRow
from domains.agents.models import VerificationResult as VerificationResultRow
from prompts.verification.critic import build_critic_prompt
from tools import contracts
from tools.verification.critic_result import parse_critic_response
from tools.verification.decision import decide
from tools.verification.references import validate_references
from tools.verification.target import validate_target

# Critic 응답 오류(RETRY_CRITIC)만 재시도하는 횟수. CLAUDE.md 규칙상 이 재시도는 초안
# 재생성 횟수에 포함되지 않는다. 상한 값 자체는 스펙에 없어 무한 루프 방지용으로 1을
# 임의로 골랐다 — 팀 확인 필요.
MAX_CRITIC_RETRIES = 1

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
        previous_draft_id: str | None = None
        while True:
            document, evidence_by_id, request = _generate_draft(
                bundle, previous_draft_id=previous_draft_id
            )
            previous_draft_id = document.draft_id

            decision_result = _verify_with_critic_retry(
                session, document, evidence_by_id, request, regeneration_count
            )

            if decision_result.decision == contracts.Decision.PASS:
                return
            if decision_result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW:
                break
            # 남은 경우는 REGENERATE뿐이다 — 초안을 다시 만든다.
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
    # TODO(eun): organization.Child 준비되면 발달 맥락을 조회해서 EvidenceBundle을 구성합니다.
    # 미디어는 MediaAsset을 여기서 직접 조회하지 않고 media.service.collect_media_for_llm(
    # session, child_id, target_date)를 호출해서 받습니다 — 동의 필터링(H-2)이 그 함수 안에서
    # 이미 처리되어 있어야 하므로 이 함수에서 규칙을 복제하지 않습니다 (PR #12 리뷰, 김동건).
    raise NotImplementedError("media/organization 도메인 완료 후 연결 예정")


def _generate_draft(bundle: EvidenceBundle, *, previous_draft_id: str | None) -> GeneratedDraft:
    # TODO(AI 리드): tools/, prompts/가 준비되면 근거 기반 프롬프트 구성과 call_claude
    # 호출을 여기서 수행합니다. 반환하는 세 값 중 evidence_by_id는 실제 생성에 사용한
    # EvidenceItem 풀(검증 단계가 문장의 evidence_ids를 그대로 다시 조회하는 데 씀)이고,
    # GenerationRequest.class_id는 organization.Child 연결 전까지는 채울 수 없습니다 —
    # _collect_evidence가 실제로 구현될 때 함께 정해야 합니다.
    #
    # previous_draft_id: 재생성 호출이면(2번째 시도부터) 이전 시도의 document.draft_id가
    # 넘어옵니다. 새 DraftDocument의 draft_id로 그대로 재사용하세요 — 재생성은 같은
    # 초안의 새 버전(version 증가)이지 새 초안이 아닙니다 (documents 도메인
    # DraftDocument 설계와 일치). 첫 시도는 None이므로 새로 발급합니다.
    raise NotImplementedError("tools/, prompts/ 완료 후 연결 예정")


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
    if decision_result.decision == contracts.Decision.PASS:
        _record_sentence_evidence(session, document, evidence_by_id)
    session.commit()

    return decision_result


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
