"""원아 한 명의 관찰일지·알림장 생성 전체 흐름을 연결한다 (AI팀 개발 계획 v9 §8).

    근거 확인 → 모델용 근거 준비 → 관찰일지·알림장 생성 → 근거 참조 검사(C) → Critic 검증(B)
    → 실패한 문서만 재생성 → 결과 반환

여기서는 업무 순서와 실패 분기만 다룬다. 실제 생성·검증은 llm.py(B), 근거 준비·검사는
evidence.py(C)에 위임한다. 교사 승인·학부모 공개는 documents 도메인의 몫이며 이 파일은
호출하지 않는다 (H-1 — AI 검증 완료를 승인으로 취급하지 않는다).
"""

from __future__ import annotations

import logging

from domains.agents import llm
from domains.agents.evidence import (
    PreparedEvidenceSet,
    prepare_evidence,
    resolve_draft_evidence_ids,
    validate_evidence_refs,
)
from domains.agents.schemas import (
    DocType,
    DocumentGenerationResult,
    EvidenceItem,
    GenerationRequest,
    JobResult,
    JobStatus,
)

logger = logging.getLogger(__name__)

# 최초 생성 1회 + 재생성 최대 2회 (계획서 §8.3)
_MAX_REGENERATIONS = 2


def run_generation_job(
    job_id: str, request: GenerationRequest, evidence_pool: list[EvidenceItem]
) -> JobResult:
    """생성 요청 전체를 처리한다. 요청에 포함된 근거 ID 중 저장된 것만 사용한다."""
    matched = [item for item in evidence_pool if item.evidence_id in request.evidence_ids]
    child_ids = sorted({child_id for item in matched for child_id in item.child_ids})

    if not child_ids:
        return JobResult(job_id=job_id, status=JobStatus.NEEDS_TEACHER_REVIEW, reason="no_evidence")

    # TODO(상균): 이번 주 완료 기준은 "원아 한 명" 흐름이다. 요청에 여러 아이의 근거가
    #   섞여 있으면 첫 번째 아이만 처리한다 — 여러 아이 동시 처리는 이후 주차에 확장.
    child_id = child_ids[0]
    return generate_child_documents(job_id=job_id, child_id=child_id, evidence_items=matched)


def generate_child_documents(
    job_id: str, child_id: str, evidence_items: list[EvidenceItem]
) -> JobResult:
    """원아 한 명 전체 흐름 (계획서 §8.2 `generate_child_documents()`)."""
    prepared = prepare_evidence(evidence_items, child_id)
    if prepared.is_empty:
        return JobResult(
            job_id=job_id,
            child_id=child_id,
            status=JobStatus.NEEDS_TEACHER_REVIEW,
            reason="no_evidence",
        )

    # TODO(상균): 계획서 §9-3 "병렬 실행 확인" — generate_draft/verify_draft가 동기 함수라
    #   지금은 순차 실행한다. B가 비동기 클라이언트로 교체하면 asyncio.gather로 바꾼다.
    doc_results = [
        _generate_and_verify(doc_type, prepared, child_id)
        for doc_type in (DocType.OBSERVATION_LOG, DocType.PARENT_NOTE)
    ]

    if any(result.error for result in doc_results):
        return JobResult(
            job_id=job_id,
            child_id=child_id,
            status=JobStatus.FAILED,
            reason="llm_api_error",
            documents=doc_results,
        )

    return JobResult(
        job_id=job_id, child_id=child_id, status=JobStatus.COMPLETED, documents=doc_results
    )


def _generate_and_verify(
    doc_type: DocType,
    prepared: PreparedEvidenceSet,
    child_id: str,
) -> DocumentGenerationResult:
    """문서 한 종류의 생성·검증·재생성 (계획서 §8.2 `_generate_and_verify()`).

    실패한 문서만 재생성하도록 도출된 결과를 상위(`generate_child_documents`)에서 문서별로
    독립 실행하므로, 한 문서의 재시도는 다른 문서에 영향을 주지 않는다.
    """
    previous_draft = None
    feedback = None

    for attempt in range(_MAX_REGENERATIONS + 1):
        try:
            draft = llm.generate_draft(
                doc_type, prepared, previous_draft=previous_draft, feedback=feedback
            )
        except Exception as exc:  # noqa: BLE001 — API 오류는 예외로, 내용 검증 실패는 결과값으로 구분한다 (§8.3)
            logger.warning("agents.generate_draft API 오류 doc_type=%s attempt=%d", doc_type, attempt)
            return DocumentGenerationResult(doc_type=doc_type, attempts=attempt + 1, error=str(exc))

        ref_check = validate_evidence_refs(draft, prepared, child_id)
        if not ref_check.passed:
            if attempt >= _MAX_REGENERATIONS:
                return DocumentGenerationResult(
                    doc_type=doc_type,
                    draft=resolve_draft_evidence_ids(draft, prepared),
                    verification=ref_check,
                    attempts=attempt + 1,
                )
            previous_draft, feedback = draft, ref_check.issues
            continue

        try:
            verification = llm.verify_draft(draft, prepared)
        except Exception as exc:  # noqa: BLE001
            logger.warning("agents.verify_draft API 오류 doc_type=%s attempt=%d", doc_type, attempt)
            return DocumentGenerationResult(doc_type=doc_type, attempts=attempt + 1, error=str(exc))

        if verification.passed or attempt >= _MAX_REGENERATIONS:
            return DocumentGenerationResult(
                doc_type=doc_type,
                draft=resolve_draft_evidence_ids(draft, prepared),
                verification=verification,
                attempts=attempt + 1,
            )

        previous_draft, feedback = draft, verification.issues

    raise AssertionError("unreachable: for 루프가 항상 위에서 반환한다")
