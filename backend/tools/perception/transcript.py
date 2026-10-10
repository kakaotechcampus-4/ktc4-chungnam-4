"""교사 확인을 거친 발화 구간(STT 결과)을 근거(EvidenceItem)로 정규화한다 (FR-07, NFR-08).

- 구간마다 EvidenceItem 하나 또는 Dropped 하나를 낸다. 같은 입력이면 입력 순서와 관계없이
  같은 결과를 낸다 (backend/CLAUDE.md 멱등 규칙).
- 출력은 비식별화 전 서버 내부용이다. text에 실명 호명이 남아 있을 수 있어 3단계 비식별화를
  거치기 전에는 LLM으로 보내지 않는다 (H-2). 여기서는 로그를 남기지 않는다 (H-4).
- 순수 함수다. domains·DB·네트워크를 모르고 tools.contracts와 tools.perception.types만 쓴다.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from tools.contracts import AssignmentStatus, EvidenceItem, SourceType
from tools.perception.types import (
    AudioSource,
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    Speaker,
    TranscriptSegmentInput,
)

NO_SPEECH_TEXT = "멘트 없음"  # raw_text의 STT 인식 실패 값 (테크스펙 TranscriptSegment)

# 날짜만 있는 값은 한국 시간 기준 하루다. domains.media의 _KST와 같은 기준이다.
_KST = ZoneInfo("Asia/Seoul")


def seconds_to_ms(value: float | None) -> int | None:
    """초를 ms 정수로. 사사오입한다(0.0025초 → 3ms, round()의 은행가 반올림이 아님).

    없거나 쓸 수 없는 값(NaN·무한대·음수)은 추측해 채우지 않고 None으로 둔다.
    """
    if value is None or not math.isfinite(value) or value < 0:
        return None
    return int((Decimal(str(value)) * 1000).to_integral_value(rounding=ROUND_HALF_UP))


def kst_date(captured_at: datetime) -> date:
    """촬영 시각의 한국 시간 날짜. naive면 UTC로 본다(DB는 UTC 저장, media 선례)."""
    aware = captured_at if captured_at.tzinfo else captured_at.replace(tzinfo=UTC)
    return aware.astimezone(_KST).date()


def normalize_transcript(
    segments: Sequence[TranscriptSegmentInput], *, target_child_id: str, record_date: date
) -> PerceptionResult:
    """대상 원아·기록 날짜의 발화 구간을 근거로 바꾸고, 쓸 수 없는 구간은 사유와 함께 버린다.

    target_child_id는 child_ids(NonEmpty)와 같은 규칙으로 앞뒤 공백을 지운다. 비었거나
    segment_id가 겹치면 어느 쪽을 쓸지 추측하지 않고 ValueError를 낸다.
    """
    target = target_child_id.strip()
    if not target:
        raise ValueError("target_child_id must not be empty")
    if len({s.segment_id for s in segments}) != len(segments):
        raise ValueError("duplicate segment_id")  # 원문을 메시지에 싣지 않는다 (H-4)
    items: list[EvidenceItem] = []
    dropped: list[Dropped] = []
    for segment in sorted(segments, key=_order_key):
        outcome = _normalize_segment(segment, target_child_id=target, record_date=record_date)
        if isinstance(outcome, EvidenceItem):
            items.append(outcome)
        else:
            dropped.append(Dropped(source_id=segment.segment_id, reason=outcome))
    status = PerceptionStatus.OK if items else PerceptionStatus.EMPTY
    return PerceptionResult(status=status, items=items, dropped=dropped)


def _order_key(segment: TranscriptSegmentInput) -> tuple[datetime, bool, int, str]:
    """(촬영 시각, 시작 시각 — 없거나 쓸 수 없으면 뒤로, segment_id)."""
    start_ms = seconds_to_ms(segment.start_time)
    return (segment.captured_at, start_ms is None, start_ms or 0, segment.segment_id)


def _source_type(source: AudioSource, speaker: Speaker | None) -> SourceType | None:
    """출처·화자를 근거 종류로. 정할 수 없으면 None."""
    if source == AudioSource.VOICE_MEMO:
        return SourceType.TEACHER_VOICE_MEMO
    if speaker in (Speaker.CHILD, Speaker.TOGETHER):
        return SourceType.VIDEO_SPEECH
    if speaker == Speaker.TEACHER_OBSERVATION:
        # 영상 속 교사 관찰도 교사 진술이라 교사 음성메모로 둔다 (SourceType.TEACHER_VOICE_MEMO).
        return SourceType.TEACHER_VOICE_MEMO
    return None


def _normalize_segment(
    segment: TranscriptSegmentInput, *, target_child_id: str, record_date: date
) -> EvidenceItem | DropReason:
    """구간 하나를 근거로 바꾼다. 쓸 수 없으면 버림 사유를 돌려준다(위에서부터 먼저 걸린 것)."""
    if segment.excluded:
        return DropReason.EXCLUDED_BY_TEACHER
    # 연결된 아이가 없는 발화는 미분류로 근거에 쓰지 않는다 (테크스펙 TranscriptChildLink).
    if not segment.child_ids:
        return DropReason.NO_CHILD_LINK
    if target_child_id not in segment.child_ids:
        return DropReason.NOT_TARGET_CHILD
    if kst_date(segment.captured_at) != record_date:
        return DropReason.DATE_MISMATCH
    text = segment.text.strip()
    # STT가 알아듣지 못한 구간이라도 교사가 들어 보고 문장을 적었으면 그 문장을 쓴다.
    if segment.raw_text.strip() == NO_SPEECH_TEXT and text in ("", NO_SPEECH_TEXT):
        return DropReason.STT_NO_SPEECH
    if not text:
        return DropReason.EMPTY_TEXT
    source_type = _source_type(segment.source, segment.speaker)
    if source_type is None:
        return DropReason.UNMAPPED_SPEAKER

    start_ms = seconds_to_ms(segment.start_time)
    end_ms = seconds_to_ms(segment.end_time)
    if start_ms is not None and end_ms is not None and end_ms <= start_ms:
        end_ms = None  # 끝 시각을 추측해 고치지 않는다
    return EvidenceItem(
        evidence_id=f"seg:{segment.segment_id}",
        source_type=source_type,
        child_ids=sorted(set(segment.child_ids)),
        observed_date=record_date,
        text=text,
        media_id=segment.media_id,
        start_ms=start_ms,
        end_ms=end_ms,
        # 발화는 교사가 아이를 연결한다. 자동 귀속이 없다.
        assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
    )
