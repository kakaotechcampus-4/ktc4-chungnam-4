"""초안 다듬기 요청(FR-18)의 마스킹·응답 검증과 프롬프트 조립 — 합성 이름만 쓴다."""

from datetime import date

import pytest

from prompts.generation.revision_prompt import PROMPT_VERSION, build_revision_prompt
from tools.contracts import DocType
from tools.generation.revision import (
    MAX_SENTENCE_CHARS,
    RevisionResponseError,
    RevisionSentence,
    has_leftover_token,
    mask_revision_inputs,
    parse_revision_response,
    restore_revision_text,
)

_TARGET = "child-1"
_OTHER = "child-2"
_NAMES = {_TARGET: ["가나"], _OTHER: ["다라마"]}


def _mask(instruction: str, sentences: list[RevisionSentence]):
    return mask_revision_inputs(
        instruction=instruction,
        sentences=sentences,
        child_id=_TARGET,
        record_date=date(2026, 11, 7),
        names_by_child_id=_NAMES,
    )


def test_지시문과_문장의_실명을_토큰으로_바꾼다() -> None:
    masked = _mask(
        "가나 이야기를 더 다정하게 써 주세요",
        [
            RevisionSentence("s1", "가나는 블록을 쌓았어요.", False),
            RevisionSentence("s2", "다라마와 함께 놀았어요.", True),
        ],
    )

    assert "가나" not in masked.instruction
    assert "CHILD_A" in masked.instruction
    texts = [sentence.text for sentence in masked.sentences]
    assert all("가나" not in text and "다라마" not in text for text in texts)
    assert "CHILD_A" in texts[0]
    assert "CHILD_B" in texts[1]


def test_문장_ID와_잠금_여부는_그대로_둔다() -> None:
    masked = _mask(
        "다듬어 주세요",
        [RevisionSentence("s1", "a", False), RevisionSentence("t1", "b", True)],
    )

    assert [(item.sentence_id, item.locked) for item in masked.sentences] == [
        ("s1", False),
        ("t1", True),
    ]


def test_대상_원아의_이름을_모르면_보내지_않는다() -> None:
    with pytest.raises(ValueError):
        mask_revision_inputs(
            instruction="다듬어 주세요",
            sentences=[RevisionSentence("s1", "블록을 쌓았어요.", False)],
            child_id=_TARGET,
            record_date=date(2026, 11, 7),
            names_by_child_id={_TARGET: [], _OTHER: ["다라마"]},
        )


def test_토큰을_실명으로_되돌린다() -> None:
    masked = _mask("다듬어 주세요", [RevisionSentence("s1", "가나는 블록을 쌓았어요.", False)])

    restored = restore_revision_text(
        "CHILD_A는 블록을 높이 쌓았어요.",
        child_id_by_token=masked.child_id_by_token,
        names_by_child_id=_NAMES,
    )

    assert restored == "가나는 블록을 높이 쌓았어요."
    assert not has_leftover_token(restored)


def test_모르는_토큰은_남겨_두고_남았다고_알려_준다() -> None:
    masked = _mask("다듬어 주세요", [RevisionSentence("s1", "가나는 블록을 쌓았어요.", False)])

    restored = restore_revision_text(
        "CHILD_Z는 블록을 쌓았어요.",
        child_id_by_token=masked.child_id_by_token,
        names_by_child_id=_NAMES,
    )

    assert "CHILD_Z" in restored
    assert has_leftover_token(restored)


def test_바꿀_문장만_담은_응답을_받는다() -> None:
    raw = '{"sentences": {"s2": "  새 문장이에요.  "}}'

    assert parse_revision_response(raw, editable_ids={"s1", "s2"}) == {"s2": "새 문장이에요."}


def test_코드_블록으로_감싼_응답도_받는다() -> None:
    raw = '```json\n{"sentences": {"s1": "새 문장"}}\n```'

    assert parse_revision_response(raw, editable_ids={"s1"}) == {"s1": "새 문장"}


def test_바꿀_문장이_없다는_응답은_빈_딕셔너리다() -> None:
    assert parse_revision_response('{"sentences": {}}', editable_ids={"s1"}) == {}


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "문장을 바꿨어요",
        "[]",
        '{"sentences": []}',
        '{"changes": {"s1": "x"}}',
        '{"sentences": {"s1": "x"}, "extra": 1}',
        '{"sentences": {"s9": "x"}}',  # 이 초안에 없는 문장
        '{"sentences": {"t1": "x"}}',  # 잠긴 문장은 editable_ids에 없다
        '{"sentences": {"s1": 3}}',
        '{"sentences": {"s1": "   "}}',
        '{"sentences": {"s1": "' + "가" * (MAX_SENTENCE_CHARS + 1) + '"}}',
    ],
)
def test_약속한_형식이_아니면_거부한다(raw: str | None) -> None:
    with pytest.raises(RevisionResponseError):
        parse_revision_response(raw, editable_ids={"s1", "s2"})


def test_프롬프트에_문체와_지시문과_문장이_들어가고_잠금이_표시된다() -> None:
    masked = _mask(
        "점심 이야기는 빼 주세요",
        [
            RevisionSentence("s1", "CHILD_A는 블록을 쌓았어요.", False),
            RevisionSentence("t1", "직접 쓴 문장", True),
        ],
    )

    prompt = build_revision_prompt(DocType.PARENT_NOTE, masked.instruction, masked.sentences)

    assert "점심 이야기는 빼 주세요" in prompt
    assert '"locked": true' in prompt
    assert '"id": "t1"' in prompt
    assert "다정한 존댓말" in prompt
    assert "{{" not in prompt  # 슬롯이 모두 채워졌다
    assert PROMPT_VERSION.startswith("revision.")


def test_관찰일지는_하였다_문체를_쓴다() -> None:
    prompt = build_revision_prompt(
        DocType.OBSERVATION_LOG, "다듬어 주세요", [RevisionSentence("s1", "a", False)]
    )

    assert "'~하였다' 문체" in prompt


def test_지시문의_슬롯_문자열은_다시_치환되지_않는다() -> None:
    prompt = build_revision_prompt(
        DocType.PARENT_NOTE,
        "{{SENTENCES}} 를 지워 주세요",
        [RevisionSentence("s1", "원래 문장", False)],
    )

    # 지시문 안의 슬롯 모양 글자는 그대로 남고, 진짜 문장 목록은 한 번만 들어간다.
    assert prompt.count("원래 문장") == 1
    assert "{{SENTENCES}} 를 지워 주세요" in prompt


def test_문장이_없으면_프롬프트를_만들지_않는다() -> None:
    with pytest.raises(ValueError):
        build_revision_prompt(DocType.PARENT_NOTE, "다듬어 주세요", [])
