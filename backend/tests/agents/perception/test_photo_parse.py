import json
import random
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

import pytest
from pydantic import ValidationError

from prompts.perception.photo_analysis import PhotoPromptImage, build_photo_analysis_prompt
from tests.agents.fixtures.perception import (
    CAPTURED_AT,
    CHILD_A_ID,
    CHILD_B_ID,
    CHILD_C_ID,
    PHOTO_A_ID,
    PHOTO_B_ID,
    PHOTO_C_ID,
    RECORD_DATE,
    answer,
    link,
    photo,
    response,
)
from tools.contracts import AssignmentStatus, EvidenceItem, SourceType
from tools.perception.photo import assign_photo_refs, parse_photo_analysis
from tools.perception.types import (
    ChildLink,
    Dropped,
    DropReason,
    PerceptionResult,
    PerceptionStatus,
    PhotoInput,
)

TEXT = "합성 관찰 문장"  # 결과에 남으면 안 되는 경우를 찾기 쉽게 한 값으로 둔다
REASON = "합성 관찰 없음 사유"


def _parse(raw: str | None, *photos: PhotoInput, target: str = CHILD_A_ID) -> PerceptionResult:
    return parse_photo_analysis(
        raw,
        photos_by_ref=assign_photo_refs(photos or (photo(),)),
        target_child_id=target,
        record_date=RECORD_DATE,
    )


def _links(*child_ids: str) -> tuple[ChildLink, ...]:
    return tuple(link(child_id) for child_id in child_ids)


def test_아이_1명_사진의_개별_관찰은_교사_확인_근거가_된다() -> None:
    result = _parse(response(answer("P1", (f"  {TEXT}\n", "individual"))))

    assert result.status == PerceptionStatus.OK
    assert result.dropped == []
    assert result.items == [
        EvidenceItem(
            evidence_id=f"photo:{PHOTO_A_ID}:1",
            source_type=SourceType.PHOTO_OBSERVATION,
            child_ids=[CHILD_A_ID],
            observed_date=RECORD_DATE,
            text=TEXT,
            media_id=PHOTO_A_ID,
            assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
        )
    ]
    assert (result.items[0].start_ms, result.items[0].end_ms) == (None, None)


@pytest.mark.parametrize(
    ("child_ids", "scope", "is_kept"),
    [
        ((CHILD_A_ID,), "individual", True),
        ((CHILD_A_ID,), "group", False),
        ((CHILD_B_ID, CHILD_A_ID), "group", True),
        ((CHILD_B_ID, CHILD_A_ID), "individual", False),
        ((CHILD_C_ID, CHILD_A_ID, CHILD_B_ID), "group", True),
        ((CHILD_C_ID, CHILD_A_ID, CHILD_B_ID), "individual", False),
    ],
)
def test_아이_수와_scope가_맞는_관찰만_근거가_되고_group은_전원의_공동_근거다(
    child_ids: tuple[str, ...], scope: str, is_kept: bool
) -> None:
    result = _parse(response(answer("P1", (TEXT, scope))), photo(links=_links(*child_ids)))

    if is_kept:
        assert [item.child_ids for item in result.items] == [sorted(child_ids)]
        assert result.dropped == []
    else:
        assert result.items == []
        assert result.dropped == [Dropped(source_id=PHOTO_A_ID, reason=DropReason.AMBIGUOUS_ACTOR)]


@pytest.mark.parametrize(
    ("methods", "expected"),
    [
        (("manual",), AssignmentStatus.TEACHER_CONFIRMED),
        (("manual", "manual"), AssignmentStatus.TEACHER_CONFIRMED),
        (("face_recognition",), AssignmentStatus.AUTO_LINKED),
        (("manual", "face_recognition"), AssignmentStatus.AUTO_LINKED),
    ],
)
def test_자동_인식_귀속이_하나라도_섞이면_AUTO_LINKED다(
    methods: tuple[Literal["face_recognition", "manual"], ...], expected: AssignmentStatus
) -> None:
    links = tuple(link(c, m) for c, m in zip((CHILD_A_ID, CHILD_B_ID), methods, strict=False))
    scope = "individual" if len(links) == 1 else "group"
    result = _parse(response(answer("P1", (TEXT, scope))), photo(links=links))

    assert [item.assignment_status for item in result.items] == [expected]


@pytest.mark.parametrize(
    ("answers", "overrides", "reason"),
    [
        (
            [answer("P1", (TEXT, "individual"))],
            {"links": _links(CHILD_B_ID)},
            DropReason.NOT_TARGET_CHILD,
        ),
        (
            [answer("P1", (TEXT, "individual"))],
            {"captured_at": CAPTURED_AT + timedelta(days=1)},
            DropReason.DATE_MISMATCH,
        ),
        ([answer("P1", reason=REASON)], {}, DropReason.NO_VISIBLE_OBSERVATION),
    ],
)
def test_쓸_수_없는_사진은_사유만_남기고_버린다(
    answers: list[dict[str, Any]], overrides: dict[str, Any], reason: DropReason
) -> None:
    result = _parse(response(*answers), photo(**overrides))

    assert (result.status, result.items) == (PerceptionStatus.EMPTY, [])
    assert result.dropped == [Dropped(source_id=PHOTO_A_ID, reason=reason)]
    # 관찰 문장·사유 문장이 결과 어디에도 남지 않는다 (H-4)
    dumped = str(result.model_dump())
    assert TEXT not in dumped
    assert REASON not in dumped


def test_사유가_겹치면_응답_누락_대상_날짜_관찰_없음_순으로_앞의_사유를_남긴다() -> None:
    wrong = {"links": _links(CHILD_B_ID), "captured_at": CAPTURED_AT + timedelta(days=1)}
    # 아무것도 답하지 않은 응답은 형식 오류라, 응답 누락은 P2만 답한 응답으로 만든다.
    p2_only = response(answer("P2", reason=REASON))
    both = response(answer("P1", reason=REASON), answer("P2", reason=REASON))
    steps: list[tuple[str, dict[str, Any], DropReason]] = [
        (p2_only, wrong, DropReason.PHOTO_NOT_ANSWERED),
        (both, wrong, DropReason.NOT_TARGET_CHILD),
        (both, wrong | {"links": _links(CHILD_A_ID)}, DropReason.DATE_MISMATCH),
        (both, {}, DropReason.NO_VISIBLE_OBSERVATION),
    ]

    for raw, overrides, reason in steps:
        result = parse_photo_analysis(
            raw,
            photos_by_ref={"P1": photo(**overrides), "P2": photo(media_id=PHOTO_B_ID)},
            target_child_id=CHILD_A_ID,
            record_date=RECORD_DATE,
        )
        assert [d.reason for d in result.dropped if d.source_id == PHOTO_A_ID] == [reason]


@pytest.mark.parametrize(
    ("captured_at", "is_kept"),
    [
        (datetime(2026, 9, 7, 14, 59, 59, tzinfo=UTC), False),  # KST 9/7 23:59:59
        (datetime(2026, 9, 7, 15, 0, 0, tzinfo=UTC), True),  # KST 9/8 00:00:00
        (datetime(2026, 9, 8, 14, 59, 59, tzinfo=UTC), True),  # KST 9/8 23:59:59
        (datetime(2026, 9, 8, 15, 0, 0, tzinfo=UTC), False),  # KST 9/9 00:00:00
        (datetime(2026, 9, 8, 0, 0, 0, tzinfo=timezone(timedelta(hours=9))), True),
    ],
)
def test_기록_날짜는_한국_시간_자정으로_가른다(captured_at: datetime, is_kept: bool) -> None:
    result = _parse(response(answer("P1", (TEXT, "individual"))), photo(captured_at=captured_at))

    assert len(result.items) == int(is_kept)
    assert [d.reason for d in result.dropped] == ([] if is_kept else [DropReason.DATE_MISMATCH])


# P1(아이 1명)은 맞는 답, P2(아이 2명)를 어긴 응답. 한 원소만 어겨도 P1 결과를 쓰지 않는다.
_P1_OK = answer("P1", (TEXT, "individual"))
_P2_OK = answer("P2", (TEXT, "group"))


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param(None, id="no_content"),
        pytest.param("", id="empty"),
        pytest.param(f"{TEXT}입니다", id="not_json"),
        pytest.param(json.dumps(_P1_OK, ensure_ascii=False), id="object_not_array"),
        pytest.param(f"생각: 블록이 보인다.\n{response(_P1_OK, _P2_OK)}", id="thinking_prefix"),
        pytest.param(f"{response(_P1_OK, _P2_OK)}\n설명: {TEXT}", id="trailing_text"),
        pytest.param(f"```json\n{response(_P1_OK, _P2_OK)}\n```\n{TEXT}", id="text_after_fence"),
        pytest.param(f"```json\n```json\n{response(_P1_OK)}\n```\n```", id="double_fence"),
        pytest.param(response(_P1_OK, answer("P3", (TEXT, "group"))), id="unknown_ref"),
        pytest.param(response(_P1_OK, _P2_OK, _P2_OK), id="duplicate_ref"),
        pytest.param(
            response(_P1_OK, _P2_OK).replace('"ref": "P1"', '"ref": "P3", "ref": "P1"', 1),
            id="duplicate_key",
        ),
        pytest.param(response(_P1_OK, answer(" P2", (TEXT, "group"))), id="ref_not_exact"),
        pytest.param(response(_P1_OK, {"ref": "P2", "observations": []}), id="missing_key"),
        pytest.param(
            response(_P1_OK, {"ref": "P2", "observations": [{"text": TEXT, "scope": "group"}]}),
            id="missing_reason",
        ),
        pytest.param(
            response(_P1_OK, {"ref": "P2", "no_observation_reason": REASON}),
            id="missing_observations",
        ),
        pytest.param(response(_P1_OK, _P2_OK | {"confidence": 0.9}), id="extra_key"),
        pytest.param(
            response(
                _P1_OK, {**_P2_OK, "observations": [{"text": TEXT, "scope": "group", "x": 1}]}
            ),
            id="observation_extra_key",
        ),
        pytest.param(response(_P1_OK, answer("P2", (TEXT, "both"))), id="bad_scope"),
        pytest.param(
            response(_P1_OK, answer("P2", *[(TEXT, "group")] * 4)), id="four_observations"
        ),
        pytest.param(response(_P1_OK, answer("P2", (" \n", "group"))), id="blank_text"),
        pytest.param(
            response(_P1_OK, answer("P2", (TEXT, "group"), reason=REASON)),
            id="reason_with_observations",
        ),
        pytest.param(response(_P1_OK, answer("P2")), id="no_reason_without_observations"),
        pytest.param(response(_P1_OK, answer("P2", reason=" ")), id="blank_reason"),
        pytest.param(response(_P1_OK, {**_P2_OK, "ref": 2}), id="ref_not_string"),
        pytest.param("[" * 100_000, id="deep_nesting"),
    ],
)
def test_형식을_어긴_응답은_부분_결과_없이_RESPONSE_ERROR다(raw: str | None) -> None:
    result = _parse(raw, photo(), photo(media_id=PHOTO_B_ID, links=_links(CHILD_A_ID, CHILD_B_ID)))

    assert result == PerceptionResult(status=PerceptionStatus.RESPONSE_ERROR, items=[], dropped=[])
    assert TEXT not in str(result.model_dump())


@pytest.mark.parametrize(
    ("answers", "status", "unanswered"),
    [
        ([], PerceptionStatus.RESPONSE_ERROR, []),
        ([answer("P1", (TEXT, "individual"))], PerceptionStatus.OK, [PHOTO_B_ID]),
        ([answer("P2", reason=REASON)], PerceptionStatus.EMPTY, [PHOTO_A_ID]),
    ],
    ids=["none_answered", "partly_answered", "partly_answered_empty"],
)
def test_일부만_빠지면_그_사진만_버리고_하나도_답하지_않으면_형식_오류다(
    answers: list[dict[str, Any]], status: PerceptionStatus, unanswered: list[str]
) -> None:
    result = _parse(response(*answers), photo(), photo(media_id=PHOTO_B_ID))

    assert result.status == status
    not_answered = [d for d in result.dropped if d.reason == DropReason.PHOTO_NOT_ANSWERED]
    assert not_answered == [
        Dropped(source_id=media_id, reason=DropReason.PHOTO_NOT_ANSWERED) for media_id in unanswered
    ]
    if status == PerceptionStatus.RESPONSE_ERROR:
        assert (result.items, result.dropped) == ([], [])


@pytest.mark.parametrize(
    ("before", "after"),
    [("```json\n", "\n```"), ("```\n", "\n```"), ("\n ```json", "```  \n"), ("```json ", " ```")],
)
def test_응답_전체를_감싼_코드_블록_한_겹은_벗겨_읽는다(before: str, after: str) -> None:
    body = response(answer("P1", (TEXT, "individual")))

    assert _parse(f"{before}{body}{after}") == _parse(body)
    assert _parse(body).status == PerceptionStatus.OK


def _mixed_photos() -> list[PhotoInput]:
    # C는 media_id가 가장 크지만 먼저 찍혔다. A와 B는 촬영 시각이 같아 media_id로 갈린다.
    return [
        photo(media_id=PHOTO_C_ID, captured_at=CAPTURED_AT - timedelta(hours=1)),
        photo(
            media_id=PHOTO_B_ID,
            links=(link(CHILD_B_ID), link(CHILD_A_ID, "face_recognition")),
        ),
        photo(media_id=PHOTO_A_ID),
    ]


_MIXED_ANSWERS = [
    answer("P1", reason=REASON),
    answer("P2", (TEXT, "individual")),
    answer(
        "P3", ("합성 공동 관찰 1", "group"), (TEXT, "individual"), ("합성 공동 관찰 3", "group")
    ),
]


def test_참조는_입력_순서와_관계없이_촬영_시각과_media_id_순으로_붙는다() -> None:
    photos = _mixed_photos()
    refs = assign_photo_refs(photos)

    assert {ref: p.media_id for ref, p in refs.items()} == {
        "P1": PHOTO_C_ID,
        "P2": PHOTO_A_ID,
        "P3": PHOTO_B_ID,
    }
    for seed in range(5):
        assert assign_photo_refs(random.Random(seed).sample(photos, k=len(photos))) == refs


@pytest.mark.parametrize("seed", range(5))
def test_사진과_응답_원소의_순서가_달라도_결과가_같다(seed: int) -> None:
    rng = random.Random(seed)
    expected = _parse(response(*_MIXED_ANSWERS), *_mixed_photos())
    shuffled = _parse(response(*rng.sample(_MIXED_ANSWERS, k=3)), *rng.sample(_mixed_photos(), k=3))

    assert shuffled.model_dump() == expected.model_dump()
    # 버린 관찰도 번호를 차지해 B의 세 번째 관찰은 :3이다
    assert [(i.evidence_id, i.child_ids, i.assignment_status) for i in expected.items] == [
        (f"photo:{PHOTO_A_ID}:1", [CHILD_A_ID], AssignmentStatus.TEACHER_CONFIRMED),
        (f"photo:{PHOTO_B_ID}:1", [CHILD_A_ID, CHILD_B_ID], AssignmentStatus.AUTO_LINKED),
        (f"photo:{PHOTO_B_ID}:3", [CHILD_A_ID, CHILD_B_ID], AssignmentStatus.AUTO_LINKED),
    ]
    assert expected.dropped == [
        Dropped(source_id=PHOTO_C_ID, reason=DropReason.NO_VISIBLE_OBSERVATION),
        Dropped(source_id=PHOTO_B_ID, reason=DropReason.AMBIGUOUS_ACTOR),
    ]


def test_사진은_사전_삽입_순서나_문자열_정렬이_아니라_참조_번호_순으로_처리한다() -> None:
    # P10 이상이 있어야 문자열 정렬(P1, P10, P11, P2...)과 번호 순이 갈린다.
    photos = [
        photo(
            media_id=f"00000000-0000-4000-b000-0000000001{n:02d}",
            captured_at=CAPTURED_AT + timedelta(minutes=n),
        )
        for n in range(1, 12)
    ]
    reversed_refs = dict(reversed(assign_photo_refs(photos).items()))
    odd_answers = [answer(f"P{n}", (TEXT, "individual")) for n in range(1, 12, 2)]

    result = parse_photo_analysis(
        response(*odd_answers),
        photos_by_ref=reversed_refs,
        target_child_id=CHILD_A_ID,
        record_date=RECORD_DATE,
    )

    assert [i.media_id for i in result.items] == [p.media_id for p in photos[0::2]]
    assert [d.source_id for d in result.dropped] == [p.media_id for p in photos[1::2]]


def test_모든_근거가_EvidenceItem_검증을_다시_통과한다() -> None:
    items = _parse(response(*_MIXED_ANSWERS), *_mixed_photos()).items

    assert items
    assert all(EvidenceItem.model_validate(item.model_dump()) == item for item in items)


def test_대상_원아_ID는_앞뒤_공백을_지우고_비교한다() -> None:
    result = _parse(response(answer("P1", (TEXT, "individual"))), target=f" {CHILD_A_ID}\n")

    assert [i.evidence_id for i in result.items] == [f"photo:{PHOTO_A_ID}:1"]


@pytest.mark.parametrize(
    ("refs", "target", "message"),
    [
        ([], CHILD_A_ID, "P1..Pn"),
        (["P2"], CHILD_A_ID, "P1..Pn"),
        (["P1", "P3"], CHILD_A_ID, "P1..Pn"),
        (["p1"], CHILD_A_ID, "P1..Pn"),
        (["P1"], "", "target_child_id"),
        (["P1"], " \n", "target_child_id"),
    ],
    ids=["empty", "starts_at_P2", "gap", "lowercase", "empty_target", "blank_target"],
)
def test_참조나_대상을_정할_수_없는_호출은_거부한다(
    refs: list[str], target: str, message: str
) -> None:
    media_ids = [PHOTO_A_ID, PHOTO_B_ID]
    photos_by_ref = {ref: photo(media_id=m) for ref, m in zip(refs, media_ids, strict=False)}

    with pytest.raises(ValueError, match=message):
        parse_photo_analysis(
            "[]", photos_by_ref=photos_by_ref, target_child_id=target, record_date=RECORD_DATE
        )


def test_같은_사진이_두_번_들어오면_거부한다() -> None:
    with pytest.raises(ValueError, match="duplicate media_id") as exc_info:
        assign_photo_refs([photo(), photo(captured_at=CAPTURED_AT + timedelta(hours=1))])
    assert PHOTO_A_ID not in str(exc_info.value)

    with pytest.raises(ValueError, match="duplicate media_id"):
        parse_photo_analysis(
            "[]",
            photos_by_ref={"P1": photo(), "P2": photo()},
            target_child_id=CHILD_A_ID,
            record_date=RECORD_DATE,
        )


@pytest.mark.parametrize(
    "overrides",
    [
        {"links": (link(CHILD_A_ID), link(f" {CHILD_A_ID}", "face_recognition"))},
        {"links": ()},
        {"captured_at": CAPTURED_AT.replace(tzinfo=None)},
        {"links": ({"child_id": CHILD_A_ID, "method": "name_call"},)},
        {"links": ({"child_id": " ", "method": "manual"},)},
        {"media_id": " "},
        {"unknown_field": "x"},
    ],
    ids=[
        "duplicate_child",
        "no_links",
        "naive_captured_at",
        "bad_method",
        "blank_child",
        "blank_media",
        "extra_field",
    ],
)
def test_잘못된_사진_입력은_거부한다(overrides: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        photo(**overrides)


def test_사진_입력_검증_오류_문자열에_ID를_싣지_않는다() -> None:
    # 숨기지 않으면 ORM의 UUID 객체를 그대로 넘겼을 때 잎 값 오류(input_value)에 ID가 실린다
    fields = {
        "media_id": UUID(PHOTO_A_ID),
        "captured_at": CAPTURED_AT,
        "links": ({"child_id": UUID(CHILD_A_ID), "method": "manual"},),
    }

    with pytest.raises(ValidationError) as exc_info:
        PhotoInput.model_validate(fields)

    assert PHOTO_A_ID not in str(exc_info.value)
    assert CHILD_A_ID not in str(exc_info.value)


def test_사진의_child_ids는_정렬된_귀속_원아_전원이다() -> None:
    assert photo(links=_links(CHILD_B_ID, CHILD_A_ID)).child_ids == (CHILD_A_ID, CHILD_B_ID)


def test_프롬프트의_출력_예시를_그대로_파싱하면_기대한_근거가_나온다() -> None:
    # 프롬프트(PR2)와 파서의 응답 계약이 어긋나면 여기서 실패한다.
    photos_by_ref = {
        "P1": photo(media_id=PHOTO_A_ID),
        "P2": photo(media_id=PHOTO_B_ID, links=_links(CHILD_A_ID, CHILD_B_ID)),
        "P3": photo(media_id=PHOTO_C_ID),
    }
    images = [
        PhotoPromptImage(ref=ref, child_count=len(p.child_ids)) for ref, p in photos_by_ref.items()
    ]
    instructions = build_photo_analysis_prompt(images).instructions
    examples = [line for line in instructions.splitlines() if line.startswith('[{"ref"')]
    assert len(examples) == 1  # 예시가 늘면 어느 것이 정답 예시인지 이 테스트가 정할 수 없다

    result = parse_photo_analysis(
        examples[0],
        photos_by_ref=photos_by_ref,
        target_child_id=CHILD_A_ID,
        record_date=RECORD_DATE,
    )

    assert result.status == PerceptionStatus.OK
    assert [(i.evidence_id, i.child_ids) for i in result.items] == [
        (f"photo:{PHOTO_A_ID}:1", [CHILD_A_ID]),
        (f"photo:{PHOTO_B_ID}:1", [CHILD_A_ID, CHILD_B_ID]),
    ]
    assert result.dropped == [
        Dropped(source_id=PHOTO_C_ID, reason=DropReason.NO_VISIBLE_OBSERVATION)
    ]
