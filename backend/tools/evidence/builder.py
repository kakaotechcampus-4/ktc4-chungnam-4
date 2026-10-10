"""생성 요청에 사용할 근거를 선별한다. 저장소 조회·모델 호출은 호출자 책임이다."""

from collections.abc import Sequence

from pydantic import ValidationError

from tools.contracts import AssignmentStatus, EvidenceItem, GenerationRequest


def build_evidence(
    items: Sequence[EvidenceItem], *, request: GenerationRequest
) -> dict[str, EvidenceItem]:
    """요청 ID 순서로 대상 원아·날짜에 맞는 확정 근거의 독립 사본을 반환한다.

    호출자는 접근 권한·반 소속·동의가 확인된 근거를 전달해야 한다. 이 함수는
    권한 확인이나 익명화를 수행하지 않으며 반환값은 외부 LLM용 payload가 아니다.
    요청하지 않은 근거와 NEEDS_CONFIRMATION 근거는 포함하지 않는다.
    입력/요청 ID 중복, 요청한 ID 누락, 손상된 계약 객체는 ValueError로 거부한다.

    공동 활동의 귀속 목록과 활동계획의 출처를 보존한다. 활동계획은 배경 정보이며
    실제 관찰을 뒷받침하는 근거로 단독 사용할 수 없다(후속 verification에서 검증).
    빈 요청/선별 결과는 빈 dict이다. 비어 있지 않더라도 생성 가능 판정은 아니다.
    TODO(엄태은): 근거 부족 상태·최소 관찰 기준은 공통 계약 합의 후 호출자에서 처리한다.
    """
    # 계약 모델은 가변이므로 재검증하며, 오류에 원문·식별자를 포함하지 않는다.
    try:
        validated_request = GenerationRequest.model_validate(request.model_dump())
        snapshots = [EvidenceItem.model_validate(item.model_dump()) for item in items]
    except ValidationError:
        raise ValueError("근거 선별 입력이 공통 데이터 계약에 맞지 않습니다.") from None

    requested_ids = validated_request.evidence_ids
    if len(requested_ids) != len(set(requested_ids)):
        raise ValueError("생성 요청에 중복된 근거 ID가 있습니다.")

    by_id: dict[str, EvidenceItem] = {}
    for item in snapshots:
        if item.evidence_id in by_id:
            raise ValueError("입력에 중복된 근거 ID가 있습니다.")
        by_id[item.evidence_id] = item

    if any(evidence_id not in by_id for evidence_id in requested_ids):
        raise ValueError("생성 요청에 해당하는 근거가 입력에 없습니다.")

    return {
        evidence_id: by_id[evidence_id]
        for evidence_id in requested_ids
        if validated_request.child_id in by_id[evidence_id].child_ids
        and validated_request.record_date == by_id[evidence_id].observed_date
        and by_id[evidence_id].assignment_status != AssignmentStatus.NEEDS_CONFIRMATION
    }
