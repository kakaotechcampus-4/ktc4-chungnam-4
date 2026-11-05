"""STT 이름 바로잡기 프롬프트 조립 (파이프라인 1-C).

STT가 비슷한 소리로 잘못 적은 원아 이름만 찾게 하는 프롬프트를 만든다. 본문은 같은 폴더의
name_fix.md에 두고, 이 모듈은 반 원아 명단과 전사문 조각을 채운다. 실제 호출은
domains/agents/service.py의 fix_transcript_names가 한다.

H-2 예외: 이 프롬프트에만 반 원아 성명·호칭과 실명이 든 전사문이 들어간다. 받는 값은 이름
문자열과 문장뿐이라 child_id·생년월일·보호자 정보가 들어갈 자리가 없다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from functools import cache
from pathlib import Path

# 11/05 합성 음성 실험의 name_fix v5(묶음 입력·고친 곳만 출력)를 옮겼다. 본문을 고치면 올린다.
PROMPT_VERSION = "name_fix.v1"

_TEMPLATE_PATH = Path(__file__).with_name("name_fix.md")
_ROSTER_SLOT = "{{ROSTER}}"
_LINES_SLOT = "{{LINES}}"
# 맨 앞 메타데이터 주석(입력 변수·기대 출력 형식). 사람이 읽는 용도라 LLM에는 보내지 않는다.
_META_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)


@cache
def _load_template() -> str:
    """메타데이터 주석을 뗀 본문을 돌려준다. 템플릿이 깨졌으면 프로그래밍 오류로 본다."""
    raw = _TEMPLATE_PATH.read_text(encoding="utf-8-sig")
    comment = _META_COMMENT.match(raw)
    if comment is None:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 맨 앞 메타데이터 주석이 없다")
    body = raw[comment.end() :].strip()
    if not body:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 주석을 뗀 본문이 비어 있다")
    if "<!--" in body or "-->" in body:
        # 메타데이터 안에 닫는 표시가 섞이면 나머지 메타데이터가 본문으로 새어 LLM에 간다.
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: 본문에 주석 표시가 남아 있다")
    for slot in (_ROSTER_SLOT, _LINES_SLOT):
        if body.count(slot) != 1:
            raise RuntimeError(f"{_TEMPLATE_PATH.name}: {slot}가 정확히 한 번 있어야 한다")
    return body


def roster_lines(children: Iterable[Sequence[str]]) -> list[str]:
    """원아마다 "- 성명 / 호칭" 한 줄. 성명 가나다순이고 같은 성명은 한 번만 쓴다.

    children은 원아마다 이름들이다(`organization.get_class_child_names`의 값, [호칭, 성명]).
    가장 긴 이름을 성명으로, 나머지를 호칭으로 본다. 세 글자가 아닌 이름은 성명 하나뿐이라
    "- 성명"만 쓴다.
    """
    by_full_name: dict[str, list[str]] = {}
    for names in children:
        cleaned = list(dict.fromkeys(name.strip() for name in names if name.strip()))
        if cleaned:
            full_name = max(cleaned, key=len)
            by_full_name[full_name] = [name for name in cleaned if name != full_name]
    return [
        " / ".join([f"- {full_name}", *by_full_name[full_name]])
        for full_name in sorted(by_full_name)
    ]


def build_name_fix_prompt(children: Iterable[Sequence[str]], lines: Sequence[str]) -> str:
    """반 원아 명단과 전사문 조각으로 프롬프트를 만든다. 줄 번호는 1부터 lines 순서대로다.

    줄바꿈이 섞인 조각은 한 줄로 이어 번호가 어긋나지 않게 한다. 명단이나 조각이 비면 부를
    이유가 없으므로 ValueError를 낸다.
    """
    roster = roster_lines(children)
    if not roster:
        raise ValueError("children must not be empty")
    if not lines:
        raise ValueError("lines must not be empty")
    numbered = "\n".join(
        f"{index}. {' '.join(line.split())}" for index, line in enumerate(lines, 1)
    )
    # 본문의 JSON 예시에 중괄호가 있어 str.format 대신 자리표시자만 바꾼다.
    return _load_template().replace(_ROSTER_SLOT, "\n".join(roster)).replace(_LINES_SLOT, numbered)
