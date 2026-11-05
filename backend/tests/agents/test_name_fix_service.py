"""STT 이름 바로잡기 호출 (파이프라인 1-C, agents.fix_transcript_names).

LLM은 바꿔 끼운다(테스트에서 실제로 부르지 않음). 합성 이름만 쓴다.
"""

import json
import logging

import httpx
import openai
import pytest

from domains.agents import service

CLASS = [["서아", "김서아"], ["하준", "이하준"]]


def _answer(*fixes: tuple[int, str, str]) -> str:
    return json.dumps(
        {"fixes": [{"line": line, "from": src, "to": dst} for line, src, dst in fixes]},
        ensure_ascii=False,
    )


def _lines_part(prompt: str) -> list[str]:
    return prompt.split("받아 적은 말:\n", 1)[1].splitlines()


def _fail_if_called(prompt: str) -> str:
    raise AssertionError("LLM을 부르면 안 된다")


def test_고친_곳을_적용하고_같은_길이와_순서로_돌려준다(monkeypatch):
    prompts: list[str] = []

    def fake(prompt: str) -> str:
        prompts.append(prompt)
        return "줄별로 봤다.\n" + _answer((1, "서화야", "서아야"))

    monkeypatch.setattr(service, "call_claude", fake)

    fixed = service.fix_transcript_names(["서화야, 블록 정리하자.", "하준이가 웃었어요."], CLASS)

    assert fixed == ["서아야, 블록 정리하자.", "하준이가 웃었어요."]
    assert len(prompts) == 1
    assert _lines_part(prompts[0]) == ["1. 서화야, 블록 정리하자.", "2. 하준이가 웃었어요."]


def test_조각을_7개씩_묶어_부른다(monkeypatch):
    batches: list[list[str]] = []

    def fake(prompt: str) -> str:
        batches.append(_lines_part(prompt))
        return _answer()

    monkeypatch.setattr(service, "call_claude", fake)
    lines = [f"문장 {index}" for index in range(16)]

    assert service.fix_transcript_names(lines, CLASS) == lines
    assert sorted(len(batch) for batch in batches) == [2, 7, 7]
    assert service.NAME_FIX_LINES_PER_CALL == 7


def test_호출이_실패한_묶음은_원문을_두고_나머지_묶음은_고친다(monkeypatch):
    def fake(prompt: str) -> str:
        if any("서화야" in line for line in _lines_part(prompt)):
            raise openai.APIConnectionError(request=httpx.Request("POST", "http://llm.invalid/v1"))
        return _answer((1, "하주니가", "하준이가"))

    monkeypatch.setattr(service, "call_claude", fake)
    lines = ["서화야"] * 7 + ["하주니가 웃었어요."]

    assert service.fix_transcript_names(lines, CLASS) == ["서화야"] * 7 + ["하준이가 웃었어요."]


def test_형식이_깨진_응답은_원문을_둔다(monkeypatch):
    monkeypatch.setattr(service, "call_claude", lambda prompt: "고칠 곳이 없어 보입니다")

    assert service.fix_transcript_names(["서화야"], CLASS) == ["서화야"]


def test_소리가_먼_수정은_적용하지_않는다(monkeypatch):
    monkeypatch.setattr(service, "call_claude", lambda prompt: _answer((1, "송시스러", "송하은")))

    assert service.fix_transcript_names(["송시스러, 가자."], CLASS) == ["송시스러, 가자."]


@pytest.mark.parametrize("lines, children", [([], CLASS), (["서화야"], []), (["서화야"], [[" "]])])
def test_조각이나_반_원아가_없으면_부르지_않는다(monkeypatch, lines, children):
    monkeypatch.setattr(service, "call_claude", _fail_if_called)

    assert service.fix_transcript_names(lines, children) == lines


def test_고치지_않은_조각은_띄어쓰기까지_원문_그대로다(monkeypatch):
    monkeypatch.setattr(service, "call_claude", lambda prompt: _answer((2, "서화야", "서아야")))
    lines = ["  하준아,  가자. ", "서화야  이리 와."]

    assert service.fix_transcript_names(lines, CLASS) == ["  하준아,  가자. ", "서아야 이리 와."]


def test_로그에는_개수만_남기고_이름과_문장은_남기지_않는다(monkeypatch, caplog):
    # H-4: 이 호출의 입력·출력에는 실명이 있다
    monkeypatch.setattr(service, "call_claude", lambda prompt: _answer((1, "서화야", "서아야")))

    with caplog.at_level(logging.INFO, logger=service.logger.name):
        service.fix_transcript_names(["서화야, 가자."], CLASS)

    assert "1 applied" in caplog.text
    for text in ("서화", "서아", "하준", "가자"):
        assert text not in caplog.text
