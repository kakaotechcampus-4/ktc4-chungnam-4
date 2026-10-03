import math
import random
import time
from collections.abc import Iterator
from contextlib import nullcontext
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from pydantic import ValidationError

from tests.agents.fixtures.perception import (
    CAPTURED_AT,
    CHILD_A_ID,
    CHILD_B_ID,
    MEDIA_MEMO_ID,
    MEDIA_VIDEO_ID,
    RECORD_DATE,
    SEGMENT_ID,
    segment,
)
from tools.contracts import AssignmentStatus, EvidenceItem, SourceType
from tools.perception.transcript import (
    NO_SPEECH_TEXT,
    kst_date,
    normalize_transcript,
    seconds_to_ms,
)
from tools.perception.types import (
    AudioSource,
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    Speaker,
    TranscriptSegmentInput,
)


def _normalize(*segments: TranscriptSegmentInput) -> PerceptionResult:
    return normalize_transcript(segments, target_child_id=CHILD_A_ID, record_date=RECORD_DATE)


def test_정상_구간은_교사_확인_근거가_된다() -> None:
    result = _normalize(segment())

    assert result.status == PerceptionStatus.OK
    assert result.dropped == []
    assert result.items == [
        EvidenceItem(
            evidence_id=f"seg:{SEGMENT_ID}",
            source_type=SourceType.VIDEO_SPEECH,
            child_ids=[CHILD_A_ID],
            observed_date=RECORD_DATE,
            text="제가 높은 탑을 만들었어요",
            media_id=MEDIA_VIDEO_ID,
            start_ms=12000,
            end_ms=15000,
            assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
        )
    ]


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"excluded": True}, DropReason.EXCLUDED_BY_TEACHER),
        ({"child_ids": ()}, DropReason.NO_CHILD_LINK),
        ({"child_ids": (CHILD_B_ID,)}, DropReason.NOT_TARGET_CHILD),
        ({"captured_at": CAPTURED_AT + timedelta(days=1)}, DropReason.DATE_MISMATCH),
        ({"raw_text": NO_SPEECH_TEXT, "text": NO_SPEECH_TEXT}, DropReason.STT_NO_SPEECH),
        # 교사가 text를 고쳤어도 인식 실패 구간은 버린다
        ({"raw_text": f" {NO_SPEECH_TEXT} ", "text": "탑을 만들었어요"}, DropReason.STT_NO_SPEECH),
        ({"text": " \n "}, DropReason.EMPTY_TEXT),
        ({"speaker": None}, DropReason.UNMAPPED_SPEAKER),
    ],
)
def test_쓸_수_없는_구간은_사유만_남기고_버린다(
    overrides: dict[str, Any], reason: DropReason
) -> None:
    fields = {"raw_text": "합성 발화 원문", "text": "합성 발화 원문"} | overrides
    result = _normalize(segment(**fields))

    assert result.status == PerceptionStatus.EMPTY
    assert result.items == []
    assert result.dropped == [Dropped(source_id=SEGMENT_ID, reason=reason)]
    assert set(Dropped.model_fields) == {"source_id", "reason"}
    # 실제로 넣은 원문이 결과 어디에도 남지 않는다 (H-4)
    dumped = str(result.model_dump())
    assert all(t.strip() not in dumped for t in (fields["raw_text"], fields["text"]) if t.strip())


# 모든 버림 조건을 가진 구간에서 조건을 앞에서부터 하나씩 걷어 내며 맨 앞 사유만 남는지 본다.
_ALL_DROP_CONDITIONS: dict[str, Any] = {
    "excluded": True,
    "child_ids": (),
    "captured_at": CAPTURED_AT + timedelta(days=1),
    "raw_text": NO_SPEECH_TEXT,
    "text": "",
    "speaker": None,
}
_PEEL_STEPS: list[tuple[dict[str, Any], DropReason]] = [
    ({}, DropReason.EXCLUDED_BY_TEACHER),
    ({"excluded": False}, DropReason.NO_CHILD_LINK),
    ({"child_ids": (CHILD_B_ID,)}, DropReason.NOT_TARGET_CHILD),
    ({"child_ids": (CHILD_A_ID,)}, DropReason.DATE_MISMATCH),
    ({"captured_at": CAPTURED_AT}, DropReason.STT_NO_SPEECH),
    ({"raw_text": "합성 발화 원문"}, DropReason.EMPTY_TEXT),
    ({"text": "합성 발화 원문"}, DropReason.UNMAPPED_SPEAKER),
]


@pytest.mark.parametrize("step", range(len(_PEEL_STEPS)), ids=[r.value for _, r in _PEEL_STEPS])
def test_사유가_겹치면_정해진_순서에서_앞의_사유를_남긴다(step: int) -> None:
    fields = dict(_ALL_DROP_CONDITIONS)
    for overrides, _ in _PEEL_STEPS[: step + 1]:
        fields |= overrides

    assert _normalize(segment(**fields)).dropped == [
        Dropped(source_id=SEGMENT_ID, reason=_PEEL_STEPS[step][1])
    ]


@pytest.mark.parametrize(
    ("source", "speaker", "expected"),
    [
        (AudioSource.VIDEO_AUDIO, Speaker.CHILD, SourceType.VIDEO_SPEECH),
        (AudioSource.VIDEO_AUDIO, Speaker.TOGETHER, SourceType.VIDEO_SPEECH),
        (AudioSource.VIDEO_AUDIO, Speaker.TEACHER_OBSERVATION, SourceType.TEACHER_VOICE_MEMO),
        (AudioSource.VIDEO_AUDIO, None, DropReason.UNMAPPED_SPEAKER),
        *[
            (AudioSource.VOICE_MEMO, speaker, SourceType.TEACHER_VOICE_MEMO)
            for speaker in [*Speaker, None]
        ],
    ],
)
def test_출처와_화자로_근거_종류를_정한다(
    source: AudioSource, speaker: Speaker | None, expected: SourceType | DropReason
) -> None:
    result = _normalize(segment(source=source, speaker=speaker))

    assert [i.source_type for i in result.items] + [d.reason for d in result.dropped] == [expected]


def test_교사_수정본_text를_앞뒤_공백만_지워_쓴다() -> None:
    result = _normalize(segment(raw_text="제가 노픈 타블 만드러써요", text="  제가 높은 탑을\n"))

    assert result.items[0].text == "제가 높은 탑을"


def test_공동_발화는_child_ids를_정렬하고_중복을_없앤다() -> None:
    child_ids = (CHILD_B_ID, CHILD_A_ID, CHILD_B_ID)
    result = _normalize(segment(speaker=Speaker.TOGETHER, child_ids=child_ids))

    assert result.items[0].child_ids == [CHILD_A_ID, CHILD_B_ID]


def test_대상_원아_ID는_앞뒤_공백을_지우고_비교한다() -> None:
    result = normalize_transcript(
        [segment()], target_child_id=f" {CHILD_A_ID}\n", record_date=RECORD_DATE
    )

    assert [i.evidence_id for i in result.items] == [f"seg:{SEGMENT_ID}"]


@pytest.mark.parametrize(
    ("segments", "target", "message"),
    [
        ([segment(text="합성 A"), segment(text="합성 B")], CHILD_A_ID, "duplicate segment_id"),
        ([segment()], "", "target_child_id"),
        ([segment()], " \n", "target_child_id"),
    ],
    ids=["duplicate_segment_id", "empty_target", "blank_target"],
)
def test_어느_쪽을_쓸지_정할_수_없는_호출은_거부한다(
    segments: list[TranscriptSegmentInput], target: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        normalize_transcript(segments, target_child_id=target, record_date=RECORD_DATE)


@pytest.mark.parametrize(
    ("seconds", "expected"),
    [
        (0.0025, 3),
        (12.3456, 12346),
        (0, 0),
        (None, None),
        (-0.5, None),
        (math.nan, None),
        (math.inf, None),
    ],
)
def test_초를_ms로_사사오입한다(seconds: float | None, expected: int | None) -> None:
    assert seconds_to_ms(seconds) == expected


@pytest.mark.parametrize(
    ("start_time", "end_time", "expected"),
    [
        (1.0, 1.0004, (1000, None)),  # 반올림하면 끝 = 시작
        (5.0, 3.0, (5000, None)),
        (3.0, None, (3000, None)),
        (None, 2.0, (None, 2000)),
        (math.nan, 2.0, (None, 2000)),
    ],
)
def test_시작과_끝_시각을_ms로_옮기고_뒤집힌_끝_시각은_비운다(
    start_time: float | None, end_time: float | None, expected: tuple[int | None, int | None]
) -> None:
    item = _normalize(segment(start_time=start_time, end_time=end_time)).items[0]

    assert (item.start_ms, item.end_ms) == expected


@pytest.fixture
def local_tz_not_utc(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """naive를 로컬 시간으로 읽는 회귀가 UTC 호스트(CI)에서도 드러나도록 로컬 시간대를 바꾼다."""
    if not hasattr(time, "tzset"):
        pytest.skip("time.tzset은 POSIX에서만 쓸 수 있다")
    monkeypatch.setenv("TZ", "America/Los_Angeles")
    time.tzset()
    yield
    monkeypatch.undo()
    time.tzset()


@pytest.mark.usefixtures("local_tz_not_utc")
@pytest.mark.parametrize(
    ("captured_at", "expected"),
    [
        (datetime(2026, 9, 7, 14, 59, 59, tzinfo=UTC), date(2026, 9, 7)),
        (datetime(2026, 9, 7, 15, 0, 0, tzinfo=UTC), date(2026, 9, 8)),
        # naive는 UTC로 본다
        (datetime(2026, 9, 7, 14, 59, 59, tzinfo=UTC).replace(tzinfo=None), date(2026, 9, 7)),
        (datetime(2026, 9, 7, 15, 0, 0, tzinfo=UTC).replace(tzinfo=None), date(2026, 9, 8)),
    ],
)
def test_촬영_시각을_한국_시간_날짜로_바꾼다(captured_at: datetime, expected: date) -> None:
    assert kst_date(captured_at) == expected


@pytest.mark.parametrize(
    ("captured_at", "kept"),
    [
        (datetime(2026, 9, 7, 14, 59, 59, tzinfo=UTC), False),  # KST 9/7 23:59:59
        (datetime(2026, 9, 7, 15, 0, 0, tzinfo=UTC), True),  # KST 9/8 00:00:00
        (datetime(2026, 9, 8, 14, 59, 59, tzinfo=UTC), True),  # KST 9/8 23:59:59
        (datetime(2026, 9, 8, 15, 0, 0, tzinfo=UTC), False),  # KST 9/9 00:00:00
    ],
)
def test_기록_날짜는_한국_시간_자정으로_가른다(captured_at: datetime, kept: bool) -> None:
    result = _normalize(segment(captured_at=captured_at))

    assert len(result.items) == int(kept)
    assert [d.reason for d in result.dropped] == ([] if kept else [DropReason.DATE_MISMATCH])


def _mixed_segments() -> list[TranscriptSegmentInput]:
    memo = {"media_id": MEDIA_MEMO_ID, "source": AudioSource.VOICE_MEMO, "speaker": None}
    together = {"speaker": Speaker.TOGETHER, "child_ids": (CHILD_B_ID, CHILD_A_ID, CHILD_B_ID)}
    return [
        segment(segment_id="s1", start_time=30.0, end_time=31.0),
        segment(segment_id="s2", start_time=None, end_time=None),
        segment(segment_id="s3", start_time=1.0, end_time=2.0),
        segment(segment_id="s4", captured_at=CAPTURED_AT - timedelta(hours=1), **memo),
        segment(segment_id="s5", excluded=True),
        segment(segment_id="s6", child_ids=(CHILD_B_ID,)),
        segment(segment_id="s7", start_time=1.0, end_time=0.5),  # 끝 시각이 시작보다 앞섬
        segment(segment_id="s8", start_time=math.nan, **together),  # NaN은 비교가 깨진다
        segment(segment_id="s9", start_time=-1.0),
    ]


@pytest.mark.parametrize("seed", range(5))
def test_입력_순서가_달라도_결과가_같다(seed: int) -> None:
    segments = _mixed_segments()
    expected = _normalize(*segments)
    shuffled = random.Random(seed).sample(segments, k=len(segments))

    assert _normalize(*shuffled).model_dump() == expected.model_dump()
    assert _normalize(*reversed(segments)).model_dump() == expected.model_dump()
    # 촬영 시각 → 시작 시각(없거나 NaN·음수면 뒤로) → segment_id 순
    evidence_ids = [i.evidence_id for i in expected.items]
    assert evidence_ids == ["seg:s4", "seg:s3", "seg:s7", "seg:s1", "seg:s2", "seg:s8", "seg:s9"]
    assert [d.source_id for d in expected.dropped] == ["s5", "s6"]


def test_모든_근거가_EvidenceItem_검증을_다시_통과한다() -> None:
    # 지금은 생성자가 검증하지만, model_construct처럼 검증을 건너뛰게 바뀌어도
    # 경계 입력(NaN·음수 시작, 뒤집힌 끝 시각, 중복 child_ids, 음성메모)에서 계약을 지키는지 본다.
    items = _normalize(*_mixed_segments()).items

    assert items
    assert all(EvidenceItem.model_validate(item.model_dump()) == item for item in items)


@pytest.mark.parametrize(
    "segments",
    [[], [segment(segment_id="s1", excluded=True), segment(segment_id="s2", child_ids=())]],
)
def test_쓸_근거가_없으면_EMPTY다(segments: list[TranscriptSegmentInput]) -> None:
    result = _normalize(*segments)

    assert (result.status, result.items) == (PerceptionStatus.EMPTY, [])


@pytest.mark.parametrize(
    ("status", "has_items", "valid"),
    [
        (PerceptionStatus.OK, True, True),
        (PerceptionStatus.OK, False, False),
        (PerceptionStatus.EMPTY, False, True),
        (PerceptionStatus.EMPTY, True, False),
        (PerceptionStatus.RESPONSE_ERROR, False, True),
        (PerceptionStatus.RESPONSE_ERROR, True, False),
    ],
)
def test_결과_상태는_OK일_때만_근거를_가진다(
    status: PerceptionStatus, has_items: bool, valid: bool
) -> None:
    items = _normalize(segment()).items if has_items else []

    with nullcontext() if valid else pytest.raises(ValidationError):
        PerceptionResult(status=status, items=items, dropped=[])


@pytest.mark.parametrize(
    "overrides",
    [{"captured_at": CAPTURED_AT.replace(tzinfo=None)}, {"unknown_field": "x"}],
    ids=["naive_captured_at", "extra_field"],
)
def test_잘못된_발화_입력은_거부한다(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        segment(**overrides)


def test_발화_입력_검증_오류_문자열에_원문을_싣지_않는다() -> None:
    fields = segment().model_dump(exclude={"speaker", "raw_text", "text"})
    # 숨기지 않으면 dict 끝에 온 원문이 pydantic 요약(input_value)의 꼬리에 실린다
    fields |= {"raw_text": "합성 호명 문장", "text": "합성 호명 문장"}

    with pytest.raises(ValidationError) as exc_info:
        TranscriptSegmentInput.model_validate(fields)

    assert "합성 호명 문장" not in str(exc_info.value)
