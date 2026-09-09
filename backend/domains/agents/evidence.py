"""근거 준비와 근거 연결 검사.

# TODO(C): 이 파일은 "작업 상세" 문서에서 C 담당으로 지정된 파일이다.
#   지금 들어있는 구현은 상균이 전체 흐름을 연결하기 위해 만든 임시 버전이며,
#   실제 예시 근거(tests/agents/fixtures)·DB 모델 설계는 C가 이어서 맡는다.
#   - prepare_evidence(): 비식별화 방식(H-2)은 유지하되, 실제 서비스에서는
#     evidence_ids 조회를 근거 저장소(추후 media/documents 도메인)에서 가져와야 한다.
#   - validate_evidence_refs(): check_type 값 이름은 "확정 필요" 상태.
"""

from __future__ import annotations

from domains.agents.schemas import (
    AssignmentStatus,
    DraftDocument,
    DraftSentence,
    EvidenceItem,
    PreparedEvidenceRef,
    VerificationIssue,
    VerificationResult,
)


class PreparedEvidenceSet:
    """한 번의 생성 요청에서 쓰는 근거 묶음.

    ref_map: 모델용 참조 번호("E1") -> 실제 evidence_id.
    evidence_by_id: 실제 evidence_id -> EvidenceItem (검증 시 조회용, 모델에는 전달하지 않음).
    """

    def __init__(
        self,
        refs: list[PreparedEvidenceRef],
        ref_map: dict[str, str],
        evidence_by_id: dict[str, EvidenceItem],
    ) -> None:
        self.refs = refs
        self.ref_map = ref_map
        self.evidence_by_id = evidence_by_id

    @property
    def is_empty(self) -> bool:
        return len(self.refs) == 0


def prepare_evidence(evidence_items: list[EvidenceItem], child_id: str) -> PreparedEvidenceSet:
    """원아 한 명 분의 근거를 모델용 참조 번호로 치환한다.

    - 대상 아동(child_id)이 child_ids에 포함된 근거만 사용한다.
    - assignment_status가 확인 필요(needs_confirmation)인 근거는 제외한다 (계획서 §6).
    - 모델에는 evidence_id·media_id 등 실제 식별자를 넘기지 않고 text만 전달한다 (H-2).
    """
    usable = [
        item
        for item in evidence_items
        if child_id in item.child_ids
        and item.assignment_status != AssignmentStatus.NEEDS_CONFIRMATION
    ]

    refs: list[PreparedEvidenceRef] = []
    ref_map: dict[str, str] = {}
    evidence_by_id: dict[str, EvidenceItem] = {}
    for index, item in enumerate(usable, start=1):
        ref = f"E{index}"
        ref_map[ref] = item.evidence_id
        evidence_by_id[item.evidence_id] = item
        refs.append(PreparedEvidenceRef(ref=ref, source_type=item.source_type, text=item.text))

    return PreparedEvidenceSet(refs=refs, ref_map=ref_map, evidence_by_id=evidence_by_id)


def validate_evidence_refs(
    draft: DraftDocument,
    prepared: PreparedEvidenceSet,
    child_id: str,
) -> VerificationResult:
    """모델이 참조한 근거 번호가 실제로 제공된 것인지, 대상 아이 것인지 코드로 검사한다.

    "그 근거로 이 내용을 말해도 되는가"는 Critic(B)의 몫이고, 여기서는 참조 자체의
    존재·소유만 본다 (작업 상세 C 담당 "주의" 항목).
    """
    valid_refs = set(prepared.ref_map.keys())
    issues: list[VerificationIssue] = []

    for sentence in draft.sentences:
        if not sentence.evidence_ids:
            issues.append(
                VerificationIssue(
                    sentence_id=sentence.sentence_id,
                    check_type="missing_evidence_ref",
                    reason="문장에 근거 참조가 없습니다.",
                )
            )
            continue

        for ref in sentence.evidence_ids:
            if ref not in valid_refs:
                issues.append(
                    VerificationIssue(
                        sentence_id=sentence.sentence_id,
                        check_type="invalid_evidence_ref",
                        reason=f"제공되지 않은 근거 참조({ref})를 사용했습니다.",
                    )
                )
                continue

            evidence_id = prepared.ref_map[ref]
            evidence = prepared.evidence_by_id.get(evidence_id)
            if evidence is None or child_id not in evidence.child_ids:
                issues.append(
                    VerificationIssue(
                        sentence_id=sentence.sentence_id,
                        check_type="wrong_child_evidence",
                        reason=f"다른 원아의 근거({ref})를 참조했습니다.",
                    )
                )

    return VerificationResult(doc_type=draft.doc_type, passed=len(issues) == 0, issues=issues)


def resolve_draft_evidence_ids(
    draft: DraftDocument, prepared: PreparedEvidenceSet
) -> DraftDocument:
    """검증을 통과한 초안의 모델용 참조 번호를 실제 evidence_id로 바꾼다 (계획서 §7.3)."""
    resolved_sentences = [
        DraftSentence(
            sentence_id=sentence.sentence_id,
            text=sentence.text,
            evidence_ids=[prepared.ref_map.get(ref, ref) for ref in sentence.evidence_ids],
        )
        for sentence in draft.sentences
    ]
    return DraftDocument(doc_type=draft.doc_type, sentences=resolved_sentences)
