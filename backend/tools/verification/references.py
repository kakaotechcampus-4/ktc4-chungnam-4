"""근거 참조 유효성 검사 (코드 검증 1/2).

문장이 참조한 근거ID가 실제로 존재하고, 활동계획만으로 실제 관찰처럼 서술하지 않았는지
확인한다. 내용이 근거로 뒷받침되는지(의미 대조)는 Critic의 몫이다.
"""

from __future__ import annotations

from tools.contracts import (
    DraftDocument,
    EvidenceItem,
    SourceType,
    VerificationCheckType,
    VerificationIssue,
)


def validate_references(
    document: DraftDocument, evidence_by_id: dict[str, EvidenceItem]
) -> list[VerificationIssue]:
    """문장별 근거 참조를 검사한다.

    evidence_by_id는 이번 생성 요청에서 실제로 제공된(=모델에 전달된) 근거만 담는다.
    제공되지 않은 evidence_id를 문장이 참조하면 무조건 실패다 — 모델이 지어낸 근거이거나,
    다른 요청의 근거를 잘못 섞어 쓴 것이다.
    """
    issues: list[VerificationIssue] = []

    for sentence in document.sentences:
        if not sentence.evidence_ids:
            issues.append(
                VerificationIssue(
                    sentence_id=sentence.sentence_id,
                    check_type=VerificationCheckType.MISSING_EVIDENCE_REF,
                    reason="문장에 근거 참조가 없습니다.",
                )
            )
            continue

        referenced: list[EvidenceItem] = []
        for evidence_id in sentence.evidence_ids:
            evidence = evidence_by_id.get(evidence_id)
            if evidence is None:
                issues.append(
                    VerificationIssue(
                        sentence_id=sentence.sentence_id,
                        check_type=VerificationCheckType.INVALID_EVIDENCE_REF,
                        reason=f"제공되지 않은 근거({evidence_id})를 참조했습니다.",
                        evidence_ids=[evidence_id],
                    )
                )
                continue
            referenced.append(evidence)

        if referenced and all(item.source_type == SourceType.ACTIVITY_PLAN for item in referenced):
            issues.append(
                VerificationIssue(
                    sentence_id=sentence.sentence_id,
                    check_type=VerificationCheckType.PLAN_AS_OBSERVED_FACT,
                    reason="활동계획 근거만으로 실제 관찰처럼 서술했습니다.",
                    evidence_ids=[item.evidence_id for item in referenced],
                )
            )

    return issues
