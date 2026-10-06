import random
from datetime import date, timedelta

import pytest

from prompts.perception.photo_analysis import (
    PhotoPromptImage,
    build_photo_analysis_prompt,
    build_single_photo_prompt,
    photo_prompt_images,
)
from tests.agents.fixtures.perception import (
    CAPTURED_AT,
    CHILD_A_ID,
    CHILD_B_ID,
    PHOTO_A_ID,
    PHOTO_B_ID,
    PHOTO_C_ID,
    RECORD_DATE,
    SEGMENT_ID,
    answer,
    link,
    photo,
    response,
    segment,
)
from tools.perception.merge import evidence_by_id, merge_perception_results
from tools.perception.photo import (
    assign_photo_refs,
    parse_photo_analysis,
    parse_single_photo_analysis,
)
from tools.perception.transcript import normalize_transcript
from tools.perception.types import (
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    PhotoInput,
    TranscriptSegmentInput,
)

TEXT = "합성 관찰 문장"
REASON = "합성 관찰 없음 사유"
OK_RAW = response(answer("P1", (TEXT, "individual")))

# 촬영 시각 순서: PHOTO_B(11:00 KST) → PHOTO_A(12:00) → PHOTO_C(13:00)
PHOTO_A = photo(media_id=PHOTO_A_ID)
PHOTO_B = photo(media_id=PHOTO_B_ID, captured_at=CAPTURED_AT - timedelta(hours=1))
PHOTO_C = photo(media_id=PHOTO_C_ID, captured_at=CAPTURED_AT + timedelta(hours=1))


def _analyze_one(
    p: PhotoInput, raw: str | None, *, target: str = CHILD_A_ID, day: date = RECORD_DATE
) -> PerceptionResult:
    """service의 사진 한 장 흐름을 LLM 호출 없이 따라간다. raw가 LLM 응답 자리다."""
    build_single_photo_prompt(p)
    return parse_single_photo_analysis(raw, photo=p, target_child_id=target, record_date=day)


def _transcript(*segments_: TranscriptSegmentInput) -> PerceptionResult:
    return normalize_transcript(
        list(segments_) or [segment()], target_child_id=CHILD_A_ID, record_date=RECORD_DATE
    )


def _no_speech() -> PerceptionResult:
    return normalize_transcript([], target_child_id=CHILD_A_ID, record_date=RECORD_DATE)


def _merge(
    transcript: PerceptionResult,
    photos: list[tuple[PhotoInput, PerceptionResult]],
    *,
    target: str = CHILD_A_ID,
) -> PerceptionResult:
    return merge_perception_results(
        transcript, photos, target_child_id=target, record_date=RECORD_DATE
    )


def test_발화_근거_다음에_사진_근거를_촬영_시각_순으로_합친다() -> None:
    photos = [(p, _analyze_one(p, OK_RAW)) for p in (PHOTO_A, PHOTO_C, PHOTO_B)]

    result = _merge(_transcript(), photos)

    assert result.status == PerceptionStatus.OK
    assert [item.evidence_id for item in result.items] == [
        f"seg:{SEGMENT_ID}",
        f"photo:{PHOTO_B_ID}:1",
        f"photo:{PHOTO_A_ID}:1",
        f"photo:{PHOTO_C_ID}:1",
    ]
    assert result.dropped == []


@pytest.mark.parametrize("seed", range(5))
def test_사진_순서가_달라도_결과가_같다(seed: int) -> None:
    photos = [(p, _analyze_one(p, OK_RAW)) for p in (PHOTO_A, PHOTO_B, PHOTO_C)]
    shuffled = photos.copy()
    random.Random(seed).shuffle(shuffled)

    assert _merge(_transcript(), shuffled) == _merge(_transcript(), photos)


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param("합성 응답입니다", id="not_json"),
        pytest.param(None, id="no_content"),
    ],
)
def test_응답_오류_사진은_그_사진만_버리고_나머지는_쓴다(raw: str | None) -> None:
    photos = [(PHOTO_A, _analyze_one(PHOTO_A, OK_RAW)), (PHOTO_B, _analyze_one(PHOTO_B, raw))]

    result = _merge(_transcript(), photos)

    assert result.status == PerceptionStatus.OK
    assert [item.evidence_id for item in result.items] == [
        f"seg:{SEGMENT_ID}",
        f"photo:{PHOTO_A_ID}:1",
    ]
    assert result.dropped == [Dropped(source_id=PHOTO_B_ID, reason=DropReason.PHOTO_RESPONSE_ERROR)]


def test_사진이_모두_실패하고_발화도_없으면_RESPONSE_ERROR가_아니라_EMPTY다() -> None:
    photos = [(p, _analyze_one(p, None)) for p in (PHOTO_A, PHOTO_B)]

    result = _merge(_no_speech(), photos)

    assert result == PerceptionResult(
        status=PerceptionStatus.EMPTY,
        items=[],
        dropped=[
            Dropped(source_id=PHOTO_B_ID, reason=DropReason.PHOTO_RESPONSE_ERROR),
            Dropped(source_id=PHOTO_A_ID, reason=DropReason.PHOTO_RESPONSE_ERROR),
        ],
    )


def test_발화와_사진의_버림_사유를_그대로_옮긴다() -> None:
    transcript = _transcript(segment(excluded=True))
    photos = [(PHOTO_A, _analyze_one(PHOTO_A, response(answer("P1", reason=REASON))))]

    result = _merge(transcript, photos)

    assert result.status == PerceptionStatus.EMPTY
    assert result.dropped == [
        Dropped(source_id=SEGMENT_ID, reason=DropReason.EXCLUDED_BY_TEACHER),
        Dropped(source_id=PHOTO_A_ID, reason=DropReason.NO_VISIBLE_OBSERVATION),
    ]


def test_사진이_없으면_발화_결과와_같다() -> None:
    transcript = _transcript()

    assert _merge(transcript, []) == transcript


def test_발화_결과가_RESPONSE_ERROR면_호출_오류다() -> None:
    transcript = PerceptionResult(status=PerceptionStatus.RESPONSE_ERROR, items=[], dropped=[])

    with pytest.raises(ValueError):
        _merge(transcript, [])


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(OK_RAW, id="ok"),
        pytest.param(None, id="response_error"),  # 근거가 없어 evidence_id 중복으로는 안 잡힌다
    ],
)
def test_같은_사진이_두_번_오면_호출_오류다(raw: str | None) -> None:
    pair = (PHOTO_A, _analyze_one(PHOTO_A, raw))

    with pytest.raises(ValueError):
        _merge(_no_speech(), [pair, pair])


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(OK_RAW, id="items"),
        pytest.param(response(answer("P1", reason=REASON)), id="dropped"),
    ],
)
def test_사진과_결과의_짝이_맞지_않으면_호출_오류다(raw: str) -> None:
    with pytest.raises(ValueError):
        _merge(_no_speech(), [(PHOTO_B, _analyze_one(PHOTO_A, raw))])


def test_같은_evidence_id가_두_번_나오면_호출_오류다() -> None:
    photo_result = _analyze_one(PHOTO_A, OK_RAW)

    with pytest.raises(ValueError):
        _merge(photo_result, [(PHOTO_A, photo_result)])


def test_다른_원아의_근거가_섞이면_호출_오류다() -> None:
    # 원아 B로 파싱한 사진 결과를 원아 A의 결과에 합치는 실수. 문장이 인용하지 않으면
    # 검증(7-A)에서 걸리지 않으므로 여기서 막는다.
    photo_b = photo(media_id=PHOTO_B_ID, links=(link(CHILD_B_ID),))
    result_b = _analyze_one(photo_b, OK_RAW, target=CHILD_B_ID)
    assert result_b.status == PerceptionStatus.OK

    with pytest.raises(ValueError):
        _merge(_transcript(), [(photo_b, result_b)])


def test_기록_날짜가_다른_근거가_섞이면_호출_오류다() -> None:
    next_day = photo(media_id=PHOTO_B_ID, captured_at=CAPTURED_AT + timedelta(days=1))
    result = _analyze_one(next_day, OK_RAW, day=RECORD_DATE + timedelta(days=1))
    assert result.status == PerceptionStatus.OK

    with pytest.raises(ValueError):
        _merge(_transcript(), [(next_day, result)])


def test_대상_원아_ID는_앞뒤_공백을_지우고_비면_호출_오류다() -> None:
    photos = [(PHOTO_A, _analyze_one(PHOTO_A, OK_RAW))]

    assert _merge(_transcript(), photos, target=f" {CHILD_A_ID}\n") == _merge(_transcript(), photos)
    with pytest.raises(ValueError):
        _merge(_no_speech(), [], target=" ")  # 근거가 없어도 호출 오류다


def test_근거_풀은_evidence_id로_근거를_찾는다() -> None:
    result = _merge(_transcript(), [(PHOTO_A, _analyze_one(PHOTO_A, OK_RAW))])

    pool = evidence_by_id(result)

    assert list(pool) == [f"seg:{SEGMENT_ID}", f"photo:{PHOTO_A_ID}:1"]
    assert list(pool.values()) == result.items


def test_근거_풀에_같은_evidence_id가_있으면_오류다() -> None:
    item = _analyze_one(PHOTO_A, OK_RAW).items[0]
    result = PerceptionResult(status=PerceptionStatus.OK, items=[item, item], dropped=[])

    with pytest.raises(ValueError):
        evidence_by_id(result)


def test_한_장_조립과_파싱은_여러_장_함수에_그_사진만_넣은_것과_같다() -> None:
    refs = assign_photo_refs([PHOTO_A])

    assert build_single_photo_prompt(PHOTO_A) == build_photo_analysis_prompt(
        photo_prompt_images(refs)
    )
    assert parse_single_photo_analysis(
        OK_RAW, photo=PHOTO_A, target_child_id=CHILD_A_ID, record_date=RECORD_DATE
    ) == parse_photo_analysis(
        OK_RAW, photos_by_ref=refs, target_child_id=CHILD_A_ID, record_date=RECORD_DATE
    )


def test_한_장_프롬프트에는_참조와_귀속_원아_수만_간다() -> None:
    # H-2: 한 장 흐름에서도 media_id·child_id가 프롬프트에 실리지 않는다.
    shared = photo(links=(link(CHILD_A_ID), link(CHILD_B_ID, "face_recognition")))

    prompt = build_single_photo_prompt(shared)

    assert prompt.images == [PhotoPromptImage(ref="P1", child_count=2)]
    assert "P1: 아이 2명" in prompt.instructions
    dumped = prompt.model_dump_json()
    for value in (PHOTO_A_ID, CHILD_A_ID, CHILD_B_ID):
        assert value not in dumped


def test_여러_장이면_촬영_시각_순서로_참조와_아이_수가_붙는다() -> None:
    shared = photo(media_id=PHOTO_B_ID, links=(link(CHILD_A_ID), link(CHILD_B_ID)))
    late = photo(media_id=PHOTO_C_ID, captured_at=CAPTURED_AT + timedelta(hours=1))

    images = photo_prompt_images(assign_photo_refs([late, shared]))

    assert images == [
        PhotoPromptImage(ref="P1", child_count=2),
        PhotoPromptImage(ref="P2", child_count=1),
    ]
    assert build_photo_analysis_prompt(images).images == images
