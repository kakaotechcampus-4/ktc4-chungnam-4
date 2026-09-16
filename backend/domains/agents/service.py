"""근거수집 → 초안생성 → Critic 검증 오케스트레이션.

tasks.py는 이 모듈의 orchestrate_drafts만 호출합니다 (CLAUDE.md: tasks.py는 로직을 갖지 않음).
"""

from datetime import datetime, timezone
from typing import TypedDict

from sqlalchemy.orm import Session

from core.database import SessionLocal
from domains.agents.models import EvidenceBundle, Job, SentenceEvidence, VerificationResult

MAX_GENERATION_ATTEMPTS = 2


class GeneratedSentence(TypedDict):
    draft_id: str
    sentence_index: int
    source_media_id: str
    source_timestamp: float | None  # 사진 근거는 시간 구간이 없을 수 있음 (PR #7 계약)
    source_text: str


def orchestrate_drafts(job_id: str, child_id: str) -> None:
    with SessionLocal() as session:
        job = _get_job(session, job_id)
        bundle = _collect_evidence(session, child_id, job.target_date)

        for _ in range(MAX_GENERATION_ATTEMPTS):
            sentences = _generate_draft(bundle)
            if _verify_and_record(session, sentences):
                return

        _send_to_unclassified(session, job_id, child_id)


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


def _generate_draft(bundle: EvidenceBundle) -> list[GeneratedSentence]:
    # TODO(AI 리드): tools/, prompts/가 준비되면 근거 기반 프롬프트 구성과
    # domains/agents/llm.call_claude 호출을 여기서 수행합니다.
    raise NotImplementedError("tools/, prompts/ 완료 후 연결 예정")


def _verify_and_record(session: Session, sentences: list[GeneratedSentence]) -> bool:
    """문장마다 근거(SentenceEvidence)를 남기고 검증 결과를 기록합니다.

    근거 없는 문장이 하나라도 있으면 이 초안 전체를 통과시키지 않습니다 (CLAUDE.md).
    """
    if not sentences:
        return False

    all_passed = True
    for sentence in sentences:
        session.add(SentenceEvidence(**sentence))

        # PR #7 VerificationCheckType 중 references.py 단계에 해당하는 검사만 수행.
        # target.py(원아/날짜 일치), critic.py(내용 대조) 검증은 tools/, prompts/ 연결 후 추가.
        passed = bool(sentence["source_media_id"])
        session.add(
            VerificationResult(
                draft_id=sentence["draft_id"],
                check_type="missing_evidence_ref",
                sentence_index=sentence["sentence_index"],
                result=passed,
                checked_at=datetime.now(timezone.utc),
            )
        )
        all_passed = all_passed and passed

    session.commit()
    return all_passed


def _send_to_unclassified(session: Session, job_id: str, child_id: str) -> None:
    # TODO(eun): documents 도메인의 UnclassifiedItem이 준비되면 여기로 기록합니다.
    # 재시도 상한을 넘겨도 예외로 터뜨리지 않고 이 함수로 떨어뜨립니다 (CLAUDE.md 규칙).
    pass
