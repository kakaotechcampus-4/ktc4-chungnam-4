"""STT 이름 바로잡기 프롬프트 조립 (파이프라인 1-C). 합성 이름만 쓴다."""

import re

import pytest

from prompts.perception import name_fix
from prompts.perception.name_fix import PROMPT_VERSION, build_name_fix_prompt, roster_lines

# 원아마다 [호칭, 성명] (organization.get_class_enrolled_child_names의 값). 세 글자가 아니면 성명 하나다
CLASS = [["서아", "김서아"], ["하준", "이하준"], ["남궁민"]]
UUID_PATTERN = re.compile(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.IGNORECASE)


def _lines_part(prompt: str) -> str:
    return prompt.split("받아 적은 말:\n", 1)[1]


def test_원아마다_성명_다음_호칭을_성명_가나다순으로_쓴다():
    assert roster_lines(CLASS) == ["- 김서아 / 서아", "- 남궁민", "- 이하준 / 하준"]


def test_같은_원아는_한_번만_쓰고_빈_이름은_버린다():
    assert roster_lines([["서아", "김서아"], [" 김서아 ", "서아"], ["", " "]]) == [
        "- 김서아 / 서아"
    ]


def test_명단과_번호_붙인_조각이_들어가고_줄바꿈은_한_줄로_잇는다():
    prompt = build_name_fix_prompt(CLASS, ["서화야, 블록 정리하자.", "하준이가\n웃었어요."])

    assert "- 김서아 / 서아\n- 남궁민\n- 이하준 / 하준" in prompt
    assert _lines_part(prompt) == "1. 서화야, 블록 정리하자.\n2. 하준이가 웃었어요."


def test_메타_주석과_자리표시자가_남지_않는다():
    prompt = build_name_fix_prompt(CLASS, ["서화야"])

    assert "<!--" not in prompt
    assert "-->" not in prompt
    assert "{{" not in prompt
    assert '{"fixes": []}' in prompt  # 출력 형식 예시는 남는다
    assert PROMPT_VERSION.startswith("name_fix.v")


def test_반_원아_이름과_전사문_말고는_들어가지_않는다():
    # H-2 예외의 범위: 이 프롬프트에는 이름과 문장만 실린다. 받는 값에 ID가 들어갈 자리가 없다
    prompt = build_name_fix_prompt(CLASS, ["서화야"])

    assert UUID_PATTERN.search(prompt) is None


@pytest.mark.parametrize("children, lines", [([], ["서화야"]), ([[" "]], ["서화야"]), (CLASS, [])])
def test_명단이나_조각이_비면_ValueError(children, lines):
    with pytest.raises(ValueError):
        build_name_fix_prompt(children, lines)


def test_자리표시자가_빠진_템플릿은_RuntimeError로_멈춘다(tmp_path, monkeypatch):
    broken = tmp_path / "name_fix.md"
    broken.write_text("<!-- 메타 -->\n본문 {{ROSTER}}만 있음", encoding="utf-8")
    monkeypatch.setattr(name_fix, "_TEMPLATE_PATH", broken)
    name_fix._load_template.cache_clear()
    try:
        with pytest.raises(RuntimeError):
            build_name_fix_prompt(CLASS, ["서화야"])
    finally:
        name_fix._load_template.cache_clear()
