"""발화·사진 perception 결과를 근거 풀 하나로 합친다.

사진 분석은 사진 1장씩 호출한 결과를 받는다. agents/service의 한 장 흐름은 다음과 같다.

    prompt = build_single_photo_prompt(photo)
    raw = ...  # LLM 호출은 domains/agents/llm.py
    result = parse_single_photo_analysis(raw, photo=photo, ...)

RESPONSE_ERROR인 사진은 service가 정한 횟수만큼 다시 부른다. 재시도를 마친 결과를
merge_perception_results로 발화 결과와 합친다. 호출이 재시도 대상 예외로 끝나 응답이 없는 사진도
photos에서 빼지 않고 parse_single_photo_analysis(None, photo=photo, ...)의 결과로 넘긴다. 빼면
사진이 모두 실패했을 때 EMPTY가 나와 근거가 없는 경우와 구분되지 않는다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

from tools.contracts import EvidenceItem
from tools.perception.types import (
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    PhotoInput,
)


def merge_perception_results(
    transcript: PerceptionResult,
    photos: Sequence[tuple[PhotoInput, PerceptionResult]],
    *,
    target_child_id: str,
    record_date: date,
) -> PerceptionResult:
    """발화 결과와 사진별 결과를 합친다.

    재시도 뒤에도 RESPONSE_ERROR인 사진은 그 사진만 PHOTO_RESPONSE_ERROR로 버리고 나머지
    사진과 발화로 진행한다. 사진 한 장 때문에 다른 근거까지 버리지 않기 위해서다.
    남은 근거가 하나도 없는데 응답 오류로 버린 사진이 있으면 EMPTY가 아니라 RESPONSE_ERROR를
    돌려준다. 정상적으로 근거가 없는 경우와 응답 오류로 근거를 얻지 못한 경우를 상태로 구분하기
    위해서다. 이 RESPONSE_ERROR는 재시도를 마친 뒤의 결과라 service는 다시 부르지 않는다.

    순서는 발화 근거 다음 사진 근거(촬영 시각·media_id 순)로 고정해, 입력 순서와 관계없이
    같은 결과를 낸다. 다음은 호출 오류로 ValueError를 낸다: 발화 결과가 RESPONSE_ERROR,
    같은 사진이 두 번 옴, 사진과 결과의 짝이 맞지 않음(결과의 근거·버림 기록의 media_id가
    사진과 다름. 응답 오류 결과는 기록이 없어 확인할 수 없다), 대상 원아·기록 날짜가 아닌 근거가
    섞임, 같은 evidence_id가 두 번 나옴. 섞인 근거는 문장이 인용할 때만 검증(7-A)에서
    걸리므로 생성 입력에 들어가기 전에 여기서 막는다.
    """
    target = target_child_id.strip()
    if not target:
        raise ValueError("target_child_id must not be empty")
    if transcript.status == PerceptionStatus.RESPONSE_ERROR:
        raise ValueError("transcript result must not be a response error")  # LLM을 거치지 않는다
    if len({photo.media_id for photo, _ in photos}) != len(photos):
        raise ValueError("duplicate media_id")  # ID도 메시지에 싣지 않는다

    items = list(transcript.items)
    dropped = list(transcript.dropped)
    for photo, result in sorted(photos, key=lambda pair: (pair[0].captured_at, pair[0].media_id)):
        if any(item.media_id != photo.media_id for item in result.items) or any(
            drop.source_id != photo.media_id for drop in result.dropped
        ):
            raise ValueError("photo result does not belong to the photo")
        if result.status == PerceptionStatus.RESPONSE_ERROR:
            dropped.append(
                Dropped(source_id=photo.media_id, reason=DropReason.PHOTO_RESPONSE_ERROR)
            )
            continue
        items.extend(result.items)
        dropped.extend(result.dropped)

    if any(target not in item.child_ids or item.observed_date != record_date for item in items):
        raise ValueError("evidence for another child or date")  # ID도 메시지에 싣지 않는다
    if items:
        status = PerceptionStatus.OK
    elif any(drop.reason == DropReason.PHOTO_RESPONSE_ERROR for drop in dropped):
        status = PerceptionStatus.RESPONSE_ERROR
    else:
        status = PerceptionStatus.EMPTY
    merged = PerceptionResult(status=status, items=items, dropped=dropped)
    evidence_by_id(merged)  # 같은 evidence_id가 두 번 나오면 여기서 ValueError
    return merged


def evidence_by_id(result: PerceptionResult) -> dict[str, EvidenceItem]:
    """생성·검증 단계가 문장의 evidence_ids로 근거를 다시 찾는 풀을 만든다.

    값의 text는 비식별화 전 원문이다. 3단계 비식별화를 거치기 전에는 LLM으로 보내지 않는다
    (H-2). 같은 evidence_id가 두 번 나오면 어느 근거인지 정할 수 없어 ValueError를 낸다.
    """
    pool = {item.evidence_id: item for item in result.items}
    if len(pool) != len(result.items):
        raise ValueError("duplicate evidence_id")  # ID도 메시지에 싣지 않는다
    return pool
