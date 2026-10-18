import json
from datetime import date

import pytest

from tools.contracts import DocType
from tools.generation.draft import DraftResponseError, parse_draft_response

RECORD_DATE = date(2026, 9, 8)
REFS = {"E1": "ev-1", "E2": "ev-2"}


def _parse(raw: str | None, *, version: int = 1):
    return parse_draft_response(
        raw,
        evidence_id_by_ref=REFS,
        doc_type=DocType.PARENT_NOTE,
        child_id="child-1",
        record_date=RECORD_DATE,
        draft_id="draft-1",
        version=version,
    )


def _answer(*sentences: tuple[str, list[str]]) -> str:
    return json.dumps(
        {"sentences": [{"text": text, "evidence_refs": refs} for text, refs in sentences]},
        ensure_ascii=False,
    )


def test_참조를_서버_ID로_되돌리고_문장_ID를_순서대로_붙인다():
    document = _parse(_answer(("탑을 쌓았어요.", ["E1"]), ("함께 정리했어요.", ["E1", "E2"])))

    assert document.draft_id == "draft-1"
    assert document.doc_type == DocType.PARENT_NOTE
    assert [(s.sentence_id, s.evidence_ids) for s in document.sentences] == [
        ("s1", ["ev-1"]),
        ("s2", ["ev-1", "ev-2"]),
    ]


def test_코드_블록으로_감싼_응답도_받는다():
    raw = "```json\n" + _answer(("탑을 쌓았어요.", ["E1"])) + "\n```"

    assert _parse(raw, version=2).version == 2


def test_근거_참조가_빠진_문장은_코드_검증에_맡긴다():
    document = _parse(_answer(("탑을 쌓았어요.", [])))

    assert document.sentences[0].evidence_ids == []


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "",
        "알림장입니다",
        "[]",
        json.dumps({"sentences": []}),
        json.dumps({"sentences": [{"text": "  ", "evidence_refs": ["E1"]}]}),
        json.dumps({"sentences": [{"text": "a", "evidence_refs": ["E1"], "extra": 1}]}),
        _answer(*[("문장", ["E1"])] * 11),
    ],
)
def test_약속한_형식이_아니면_거부한다(raw):
    with pytest.raises(DraftResponseError):
        _parse(raw)


@pytest.mark.parametrize("refs", [["E9"], ["ev-1"], ["E1", "E1"]])
def test_주지_않았거나_중복된_참조는_거부한다(refs):
    with pytest.raises(DraftResponseError):
        _parse(_answer(("탑을 쌓았어요.", refs)))


def test_오류_메시지에_응답_원문을_넣지_않는다():
    with pytest.raises(DraftResponseError) as error:
        _parse("CHILD_A 비밀 내용")

    assert "비밀" not in str(error.value)
