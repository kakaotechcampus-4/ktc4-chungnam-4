"""생성 근거를 LLM 전송용 사본으로 바꾸고, 통과한 초안의 토큰을 실명으로 되돌린다
(파이프라인 3단계, H-2).

- 원아 ID는 CHILD_A(대상 원아), CHILD_B…(같은 반의 다른 원아) 토큰으로, 근거 ID는 E1…En
  임시 참조로 바꾼다. 서버 ID와 토큰의 대응(매핑)은 반환값에만 두고 LLM에 보내지 않는다.
- 근거 본문 속 실명 호명은 **반 원아 전체**의 이름 목록으로 바꾼다. 근거에 귀속되지 않은
  원아도 발화에서 불릴 수 있기 때문이다 (#137 리뷰, 한상균). 이름 조회는 organization 소유라
  이 모듈은 이름을 직접 찾지 않는다 (docs/ai-data-contract.md "내부 ID와 LLM 입력":
  매핑 생성·보관·복원은 백엔드, 매핑을 이용한 입력 가공은 이 모듈).
- 순수 함수다. 로그를 남기지 않는다 (H-4).
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from tools.contracts import EvidenceItem, SourceType

TARGET_CHILD_TOKEN = "CHILD_A"

_TOKEN_PATTERN = re.compile(r"CHILD_[A-Z]+")
# 받침 유무로 갈리는 조사. (받침 있을 때, 받침 없을 때). 긴 것부터 맞춘다.
_PARTICLES = (
    ("이랑", "랑"),
    ("으로", "로"),
    ("은", "는"),
    ("이", "가"),
    ("을", "를"),
    ("과", "와"),
    ("아", "야"),
)
_COPULA_POLITE = "이에요"
# 한글 음절의 종성 번호에서 ㄹ은 8번이다.
_RIEUL_FINAL_INDEX = 8
_PARTICLE_PATTERN = re.compile(
    "|".join(sorted({p for pair in _PARTICLES for p in pair}, key=len, reverse=True))
)


@dataclass(frozen=True)
class LlmEvidence:
    """LLM에 보내는 근거 한 개. 서버 ID·미디어 ID·시간을 담지 않는다."""

    ref: str
    source_type: SourceType
    shared_with_others: bool
    text: str


@dataclass(frozen=True)
class PseudonymizedEvidence:
    """LLM 전송용 근거와 서버 쪽에만 남길 대응표."""

    llm_items: list[LlmEvidence]
    # E1 → 서버 evidence_id. 응답의 참조를 서버 ID로 되돌릴 때 쓴다.
    evidence_id_by_ref: dict[str, str]
    # 본문의 실명을 토큰으로 바꾼 사본(키는 서버 evidence_id). LLM으로 가는 검증(Critic)에만
    # 쓴다. 저장(SentenceEvidence)에는 원본 근거를 쓴다.
    evidence_by_id: dict[str, EvidenceItem]
    # CHILD_A → 원아 ID. 통과한 초안을 저장하기 전에 실명으로 되돌릴 때 쓴다.
    child_id_by_token: dict[str, str]


def pseudonymize_evidence(
    evidence_by_id: Mapping[str, EvidenceItem],
    *,
    target_child_id: str,
    names_by_child_id: Mapping[str, Sequence[str]],
) -> PseudonymizedEvidence:
    """근거를 E1… 순서(입력 순서)로 번호 매기고 본문의 실명을 토큰으로 바꾼다.

    names_by_child_id: **반 원아 전체**의 원아 ID → 본문에서 찾을 이름들(성명, 이름, 애칭 등).
    대상 원아와 근거에 등장한 원아는 반드시 있어야 한다 — 이름을 모르면 호명이 그대로
    남을 수 있으므로 추측해서 넘어가지 않고 거부한다.
    """
    involved = {child_id for item in evidence_by_id.values() for child_id in item.child_ids}
    involved.add(target_child_id)
    if any(not _has_name(names_by_child_id.get(child_id, ())) for child_id in involved):
        # 키만 있고 이름이 비어 있어도 호명이 그대로 남으므로 같게 거부한다 (#137 리뷰).
        raise ValueError("근거에 등장한 원아의 이름 목록이 없습니다.")

    token_by_child_id = _child_tokens(target_child_id, names_by_child_id.keys())
    replacements = sorted(
        (
            (name.strip(), token_by_child_id[child_id])
            for child_id, names in names_by_child_id.items()
            for name in names
            if name.strip()
        ),
        # "김서연"을 "서연"보다 먼저 바꿔야 "김CHILD_A"가 남지 않는다.
        key=lambda pair: len(pair[0]),
        reverse=True,
    )

    llm_items: list[LlmEvidence] = []
    evidence_id_by_ref: dict[str, str] = {}
    masked_by_id: dict[str, EvidenceItem] = {}
    for index, (evidence_id, item) in enumerate(evidence_by_id.items(), start=1):
        ref = f"E{index}"
        text = _replace_names(item.text, replacements)
        evidence_id_by_ref[ref] = evidence_id
        masked_by_id[evidence_id] = EvidenceItem.model_validate({**item.model_dump(), "text": text})
        llm_items.append(
            LlmEvidence(
                ref=ref,
                source_type=item.source_type,
                shared_with_others=len(item.child_ids) > 1,
                text=text,
            )
        )

    return PseudonymizedEvidence(
        llm_items=llm_items,
        evidence_id_by_ref=evidence_id_by_ref,
        evidence_by_id=masked_by_id,
        child_id_by_token={token: child_id for child_id, token in token_by_child_id.items()},
    )


def restore_names(text: str, name_by_token: Mapping[str, str]) -> str:
    """토큰을 실명으로 되돌리고, 바로 뒤 조사를 이름의 받침에 맞춘다.

    "CHILD_A는" → "민준은" / "서아는". 모르는 토큰은 그대로 둔다 — 지어낸 토큰을
    아무 이름으로나 바꾸지 않는다. 남은 토큰은 검증 단계에서 교사가 보게 된다.
    """

    restored: list[str] = []
    position = 0
    for match in _TOKEN_PATTERN.finditer(text):
        restored.append(text[position : match.start()])
        position = match.end()
        name = name_by_token.get(match.group(0))
        if name is None:
            restored.append(match.group(0))
            continue
        restored.append(name)
        if text.startswith(_COPULA_POLITE, position):
            # 서술격 "이에요"는 받침 없는 이름 뒤에서 "예요"가 된다 ("가나예요").
            restored.append(_COPULA_POLITE if _has_final_consonant(name[-1]) else "예요")
            position += len(_COPULA_POLITE)
            continue
        particle = _PARTICLE_PATTERN.match(text, position)
        if particle and not _is_copula(particle.group(0), text, particle.end()):
            restored.append(_fit_particle(particle.group(0), name))
            position = particle.end()
    restored.append(text[position:])
    return "".join(restored)


def _has_name(names: Sequence[str]) -> bool:
    return any(name.strip() for name in names)


def _is_copula(particle: str, text: str, end: int) -> bool:
    """ "CHILD_A이에요"의 '이'는 조사가 아니라 서술격이다. 뒤에 글자가 이어지면 손대지 않는다."""
    return particle in ("이", "가") and end < len(text) and _is_hangul(text[end])


def _fit_particle(particle: str, name: str) -> str:
    if particle in ("으로", "로"):
        # ㄹ 받침 뒤에는 받침이 있어도 "로"다 ("하늘로").
        return "로" if not _has_final_consonant(name[-1]) or _final_is_rieul(name[-1]) else "으로"
    has_final = _has_final_consonant(name[-1])
    for with_final, without_final in _PARTICLES:
        if particle in (with_final, without_final):
            return with_final if has_final else without_final
    return particle


def _is_hangul(char: str) -> bool:
    return 0 <= ord(char) - 0xAC00 < 11172


def _final_is_rieul(char: str) -> bool:
    return _is_hangul(char) and (ord(char) - 0xAC00) % 28 == _RIEUL_FINAL_INDEX


def _has_final_consonant(char: str) -> bool:
    # 한글 음절이 아니면(영문 이름 등) 받침 없음으로 본다.
    return _is_hangul(char) and (ord(char) - 0xAC00) % 28 != 0


def _child_tokens(target_child_id: str, child_ids: Sequence[str] | set[str]) -> dict[str, str]:
    """대상 원아는 항상 CHILD_A. 나머지는 ID 순으로 B, C, …, Z, BA, BB…를 붙여 호출마다 같게 한다."""
    others = sorted(set(child_ids) - {target_child_id})
    tokens = {target_child_id: TARGET_CHILD_TOKEN}
    for number, child_id in enumerate(others, start=1):
        tokens[child_id] = f"CHILD_{_letters(number)}"
    return tokens


def _letters(number: int) -> str:
    """0 → A, 1 → B, 25 → Z, 26 → BA (A를 0으로 보는 26진법)."""
    letters = ""
    while True:
        number, remainder = divmod(number, 26)
        letters = chr(ord("A") + remainder) + letters
        if number == 0:
            return letters


def _replace_names(text: str, replacements: Sequence[tuple[str, str]]) -> str:
    for name, token in replacements:
        text = text.replace(name, token)
    return text
