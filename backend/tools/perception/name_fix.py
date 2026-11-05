"""STT 이름 바로잡기 응답 읽기와 적용 (파이프라인 1-C).

- LLM이 낸 수정은 서버가 세 가지를 확인한 것만 그 줄에 적용한다.
  1. 고친 말에 명단 이름이 들어 있다 — "이름이 아닌 낱말은 고치지 않는다"는 프롬프트 규칙을 코드로
     지킨다. "블로그"→"블록"처럼 소리만 가까운 일반 낱말 수정이 여기서 걸린다(#270 리뷰).
  2. 고치기 전후 말의 소리가 가깝다. 소리 거리는 띄어쓰기를 뺀 두 말을 자모로 풀어 잰 편집 거리이고,
     MAX_SOUND_DISTANCE(3) 이하만 받는다. 소음 속 헛말을 명단 이름으로 바꾼 수정("송시스러"→"송하은",
     거리 5)은 걸리고, "안노아가"→"한로하가"(거리 3) 같은 맞는 수정은 통과한다. 11/05 합성 음성
     실험에서 이 기준이 막은 수정 10개 중 7개가 다른 원아·없던 이름이었다. 2로 줄이면 맞는 수정까지
     막아 3%p를 잃었다.
  3. 적힌 말이 그 줄에 한 번만 나온다 — 두 번 이상이면 LLM이 가리킨 자리를 알 수 없어 건너뛴다.
  같은 실험의 Claude 응답(수정 34개)에 다시 적용해 보니 1·3이 막은 맞는 수정은 없었다.
- 순수 함수다. LLM·DB·로그를 모른다 — 문장과 이름을 로그에 남기지 않는다 (H-4).
"""

from __future__ import annotations

import json
import re
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, ValidationError

MAX_SOUND_DISTANCE = 3

_CODE_FENCE = re.compile(r"\A```(?:json)?\s*(.*?)\s*```\Z", re.DOTALL)

_CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNGSEONG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONGSEONG = ("", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")
_HANGUL_FIRST, _HANGUL_COUNT = 0xAC00, 11172


@dataclass(frozen=True)
class NameFix:
    """고칠 곳 하나. line은 1부터 센 줄 번호다."""

    line: int
    source: str  # 그 줄에 적힌 말 (응답의 "from")
    target: str  # 고친 말 (응답의 "to")


@dataclass(frozen=True)
class NameFixOutcome:
    lines: list[str]
    applied: int  # 적용한 수정 수
    blocked_not_name: int  # 고친 말에 명단 이름이 없어서 막은 수
    blocked_sound: int  # 소리가 멀어서 막은 수
    skipped_repeated: int  # 적힌 말이 그 줄에 두 번 이상 나와 건너뛴 수

    @property
    def blocked(self) -> int:
        """적용하지 않은 수정 수(이유 모두)."""
        return self.blocked_not_name + self.blocked_sound + self.skipped_repeated


class _FixItem(BaseModel):
    """응답의 fixes 항목 하나. 모델이 덧붙이는 다른 키(이유 등)는 무시한다."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    line: int
    source: str = Field(alias="from", min_length=1)
    target: str = Field(alias="to", min_length=1)


def jamo(text: str) -> list[str]:
    """한글 음절을 초성·중성·종성으로 푼다. 한글이 아닌 글자는 그대로 둔다.

    초성과 종성의 같은 자음은 같은 글자로 본다(호환용 자모) — 실험의 거리 기준과 같다.
    """
    out: list[str] = []
    for char in text:
        code = ord(char) - _HANGUL_FIRST
        if 0 <= code < _HANGUL_COUNT:
            out += [_CHOSEONG[code // 588], _JUNGSEONG[(code % 588) // 28]]
            if code % 28:
                out.append(_JONGSEONG[code % 28])
        else:
            out.append(char)
    return out


def sound_distance(before: str, after: str) -> int:
    """띄어쓰기를 뺀 두 말을 자모로 풀어 잰 편집 거리."""
    a, b = jamo(before.replace(" ", "")), jamo(after.replace(" ", ""))
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def _last_fixes_object(content: str) -> object | None:
    """본문 끝에 붙은 {"fixes": ...} 객체를 찾는다. 뒤에 다른 글이 남으면 끝 객체가 아니다."""
    decoder = json.JSONDecoder()
    for start in range(len(content) - 1, -1, -1):
        if content[start] != "{":
            continue
        try:
            value, end = decoder.raw_decode(content[start:])
        except ValueError:
            continue
        if (
            isinstance(value, dict)
            and "fixes" in value
            and not content[start + end :].strip("` \n")
        ):
            return value
    return None


def parse_name_fix_response(content: str | None, line_count: int) -> list[NameFix] | None:
    """응답에서 고칠 곳을 읽는다. 형식이 깨졌으면 None이다 — 호출하는 쪽이 원문을 쓴다.

    reasoning_effort=low에서 생각 과정을 본문 앞에 쓰고 끝에 JSON을 붙이는 일이 잦아(11/05 실측,
    5건 중 4건), 본문 전체가 JSON이 아니면 끝에 붙은 객체를 찾는다. 항목 하나가 깨졌거나 줄 번호가
    범위를 벗어나면 그 항목만 버린다.
    """
    if not content or not content.strip():
        return None
    text = content.strip()
    fenced = _CODE_FENCE.match(text)
    try:
        data: object = json.loads(fenced.group(1) if fenced else text)
    except ValueError:
        data = _last_fixes_object(content)
    if not isinstance(data, dict) or not isinstance(data.get("fixes"), list):
        return None
    fixes = []
    for raw in data["fixes"]:
        try:
            item = _FixItem.model_validate(raw)
        except ValidationError:
            continue
        if 1 <= item.line <= line_count:
            fixes.append(NameFix(line=item.line, source=item.source, target=item.target))
    return fixes


def apply_name_fixes(
    lines: Sequence[str],
    fixes: Sequence[NameFix],
    names: Collection[str],
    *,
    max_distance: int = MAX_SOUND_DISTANCE,
) -> NameFixOutcome:
    """서버가 확인한 수정만 그 줄에 적용한다. names는 프롬프트에 넣은 명단의 호칭·성명이다.

    고친 말에 명단 이름이 있는지, 소리가 가까운지, 적힌 말이 그 줄에 한 번만 나오는지를 차례로 본다
    (모듈 설명). 적힌 말이 그 줄에 없으면(다른 줄 번호를 댔거나 말을 바꿔 옮겼으면) 적용하지 않고
    세지도 않는다.
    """
    known = [name.strip() for name in names if name.strip()]
    fixed = list(lines)
    applied = not_name = far = repeated = 0
    for fix in fixes:
        source, target = fix.source.strip(), fix.target.strip()
        index = fix.line - 1
        if not source or not target or not 0 <= index < len(fixed) or source not in fixed[index]:
            continue
        if not any(name in target for name in known):
            not_name += 1
            continue
        if sound_distance(source, target) > max_distance:
            far += 1
            continue
        if fixed[index].count(source) > 1:
            repeated += 1
            continue
        fixed[index] = fixed[index].replace(source, target, 1)
        applied += 1
    return NameFixOutcome(
        lines=fixed,
        applied=applied,
        blocked_not_name=not_name,
        blocked_sound=far,
        skipped_repeated=repeated,
    )
