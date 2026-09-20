"""대상 원아·날짜 일치 검사 (코드 검증 2/2).

references.py가 "근거가 존재하는가"를 본다면, 이 파일은 "그 근거가 이 문서의 대상과
맞는가"를 본다. evidence_by_id에 없는 근거(=존재 자체가 잘못됨)는 references.py가 이미
잡으므로, 여기서는 존재하는 근거만 대상·날짜를 검사한다.
"""

from __future__ import annotations

from tools.contracts import (
    AssignmentStatus,
    DraftDocument,
    EvidenceItem,
    GenerationRequest,
    VerificationCheckType,
    VerificationIssue,
)


def validate_target(
    document: DraftDocument,
    evidence_by_id: dict[str, EvidenceItem],
    *,
    request: GenerationRequest,
) -> list[VerificationIssue]:
    """문장이 참조한 근거가 문서의 대상 원아·날짜와 일치하는지 검사한다."""
    issues: list[VerificationIssue] = []
    if document.child_id != request.child_id:
        issues.append(
            VerificationIssue(
                check_type=VerificationCheckType.WRONG_CHILD_EVIDENCE,
                reason="요청과 문서의 대상 원아가 다릅니다.",
            )
        )
    if document.record_date != request.record_date:
        issues.append(
            VerificationIssue(
                check_type=VerificationCheckType.WRONG_DATE_EVIDENCE,
                reason="요청과 문서의 날짜가 다릅니다.",
            )
        )

    for sentence in document.sentences:
        for evidence_id in sentence.evidence_ids:
            evidence = evidence_by_id.get(evidence_id)
            if evidence is None:
                continue  # 존재하지 않는 참조는 references.py가 담당

            if (
                document.child_id not in evidence.child_ids
                or evidence.assignment_status == AssignmentStatus.NEEDS_CONFIRMATION
            ):
                issues.append(
                    VerificationIssue(
                        sentence_id=sentence.sentence_id,
                        check_type=VerificationCheckType.WRONG_CHILD_EVIDENCE,
                        reason=f"다른 원아이거나 대상이 확인되지 않은 근거({evidence_id})를 참조했습니다.",
                        evidence_ids=[evidence_id],
                    )
                )
                continue

            if evidence.observed_date != document.record_date:
                issues.append(
                    VerificationIssue(
                        sentence_id=sentence.sentence_id,
                        check_type=VerificationCheckType.WRONG_DATE_EVIDENCE,
                        reason=f"다른 날짜의 근거({evidence_id})를 참조했습니다.",
                        evidence_ids=[evidence_id],
                    )
                )

    return issues
