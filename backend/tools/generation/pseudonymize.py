"""생성 근거를 LLM 전송용 사본으로 바꾼다 (파이프라인 3단계, H-2).

- 원아 ID는 CHILD_A(대상 원아), CHILD_B…(함께 등장한 원아) 토큰으로, 근거 ID는 E1…En
  임시 참조로 바꾼다. 서버 ID와 토큰의 대응(매핑)은 반환값에만 두고 LLM에 보내지 않는다.
- 근거 본문 속 실명 호명은 호출하는 쪽이 넘긴 이름 목록으로 토큰으로 바꾼다. 이름 조회는
  organization 소유라 이 모듈은 이름을 직접 찾지 않는다 (docs/ai-data-contract.md
  "내부 ID와 LLM 입력": 매핑 생성·보관은 백엔드, 매핑을 이용한 입력 가공은 이 모듈).
- 순수 함수다. 로그를 남기지 않는다 (H-4).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from tools.contracts import EvidenceItem, SourceType

TARGET_CHILD_TOKEN = "CHILD_A"


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
    # 본문의 실명을 토큰으로 바꾼 서버용 사본(키는 서버 evidence_id). 검증(Critic)도
    # 이 사본으로 해야 Critic 프롬프트에 실명이 실리지 않는다.
    evidence_by_id: dict[str, EvidenceItem]


def pseudonymize_evidence(
    evidence_by_id: Mapping[str, EvidenceItem],
    *,
    target_child_id: str,
    names_by_child_id: Mapping[str, Sequence[str]],
) -> PseudonymizedEvidence:
    """근거를 E1… 순서(입력 순서)로 번호 매기고 본문의 실명을 토큰으로 바꾼다.

    names_by_child_id: 원아 ID → 본문에서 찾을 이름들(성명, 이름, 애칭 등). 근거에 등장한
    원아는 모두 있어야 한다 — 이름을 모르는 원아가 있으면 호명이 그대로 남을 수 있으므로
    추측해서 넘어가지 않고 거부한다.
    """
    involved = {child_id for item in evidence_by_id.values() for child_id in item.child_ids}
    involved.add(target_child_id)
    if involved - names_by_child_id.keys():
        raise ValueError("근거에 등장한 원아의 이름 목록이 없습니다.")

    token_by_child_id = _child_tokens(target_child_id, involved)
    replacements = sorted(
        (
            (name.strip(), token_by_child_id[child_id])
            for child_id in involved
            for name in names_by_child_id[child_id]
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
    )


def _child_tokens(target_child_id: str, involved: set[str]) -> dict[str, str]:
    """대상 원아는 항상 CHILD_A. 나머지는 ID 순으로 B부터 붙여 호출마다 같게 한다."""
    others = sorted(involved - {target_child_id})
    if len(others) > 25:
        raise ValueError("한 근거 묶음에 등장한 원아가 너무 많습니다.")
    tokens = {target_child_id: TARGET_CHILD_TOKEN}
    for offset, child_id in enumerate(others, start=1):
        tokens[child_id] = f"CHILD_{chr(ord('A') + offset)}"
    return tokens


def _replace_names(text: str, replacements: Sequence[tuple[str, str]]) -> str:
    for name, token in replacements:
        text = text.replace(name, token)
    return text
