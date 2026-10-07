"""perception 발화 정규화 테스트용 합성 데이터.

ID는 형식만 UUID인 합성 값이고 실제 원아·미디어가 아니다. 발화 문장도 지어낸 것이다 (H-2).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from tools.perception.types import AudioSource, Speaker, TranscriptSegmentInput

CHILD_A_ID = "00000000-0000-4000-a000-00000000000a"
CHILD_B_ID = "00000000-0000-4000-a000-00000000000b"
MEDIA_VIDEO_ID = "00000000-0000-4000-b000-000000000001"
MEDIA_MEMO_ID = "00000000-0000-4000-b000-000000000002"
SEGMENT_ID = "00000000-0000-4000-c000-000000000001"

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
