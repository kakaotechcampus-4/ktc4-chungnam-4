"""perception 발화 정규화·사진 분석 파싱 테스트용 합성 데이터.

ID는 형식만 UUID인 합성 값이고 실제 원아·미디어가 아니다. 발화·관찰 문장도 지어낸 것이다 (H-2).
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any, Literal

from tools.perception.types import (
    AudioSource,
    ChildLink,
    PhotoInput,
    Speaker,
    TranscriptSegmentInput,
)

CHILD_A_ID = "00000000-0000-4000-a000-00000000000a"
CHILD_B_ID = "00000000-0000-4000-a000-00000000000b"
CHILD_C_ID = "00000000-0000-4000-a000-00000000000c"
MEDIA_VIDEO_ID = "00000000-0000-4000-b000-000000000001"
MEDIA_MEMO_ID = "00000000-0000-4000-b000-000000000002"
SEGMENT_ID = "00000000-0000-4000-c000-000000000001"
PHOTO_A_ID = "00000000-0000-4000-b000-000000000011"
PHOTO_B_ID = "00000000-0000-4000-b000-000000000012"
PHOTO_C_ID = "00000000-0000-4000-b000-000000000013"

RECORD_DATE = date(2026, 9, 8)
# RECORD_DATE의 한국 시간 정오(12:00 KST = 03:00 UTC).
CAPTURED_AT = datetime(2026, 9, 8, 3, 0, tzinfo=UTC)


def segment(**overrides: Any) -> TranscriptSegmentInput:
    """CHILD_A가 RECORD_DATE에 영상에서 말한 발화 한 구간. 바꿀 필드만 넘긴다."""
    fields: dict[str, Any] = {
        "segment_id": SEGMENT_ID,
        "media_id": MEDIA_VIDEO_ID,
        "source": AudioSource.VIDEO_AUDIO,
        "captured_at": CAPTURED_AT,
        "start_time": 12.0,
        "end_time": 15.0,
        "raw_text": "제가 높은 탑을 만들었어요",
        "text": "제가 높은 탑을 만들었어요",
        "speaker": Speaker.CHILD,
        "child_ids": (CHILD_A_ID,),
        "excluded": False,
    }
    return TranscriptSegmentInput.model_validate(fields | overrides)


def link(child_id: str, method: Literal["face_recognition", "manual"] = "manual") -> ChildLink:
    return ChildLink(child_id=child_id, method=method)


def photo(**overrides: Any) -> PhotoInput:
    """CHILD_A 한 명을 교사가 수동 귀속한, RECORD_DATE 정오의 사진 한 장. 바꿀 필드만 넘긴다."""
    fields: dict[str, Any] = {
        "media_id": PHOTO_A_ID,
        "captured_at": CAPTURED_AT,
        "links": (link(CHILD_A_ID),),
    }
    return PhotoInput.model_validate(fields | overrides)


def answer(ref: str, *observations: tuple[str, str], reason: str | None = None) -> dict[str, Any]:
    """사진 분석 응답 원소 하나. observations는 (text, scope) 쌍이다."""
    return {
        "ref": ref,
        "observations": [{"text": text, "scope": scope} for text, scope in observations],
        "no_observation_reason": reason,
    }


def response(*answers: dict[str, Any]) -> str:
    """원소들을 프롬프트가 요구하는 JSON 배열 응답 문자열로 만든다."""
    return json.dumps(list(answers), ensure_ascii=False)
