"""초안 다듬기 요청(FR-18)의 입력 마스킹과 응답 검증.

교사가 지시문으로 AI에게 초안 문장을 다시 쓰게 한다 (docs/api/agents.md §AI에게 다듬기 요청).
이 모듈은 호출 자체(domains/agents/llm.py)와 저장(documents)을 모른다. 두 가지만 한다.

- 보내기 전: 지시문과 문장 본문의 실명을 토큰으로 바꾼다(H-2). 초안 생성과 같은 규칙을 쓰려고
  `pseudonymize_evidence`를 그대로 부른다 — 호칭 보완 같은 규칙이 늘어도 한 곳만 고치면 된다.
- 받은 뒤: "호출은 성공했지만 믿을 수 있는 응답인가"만 본다. 형식이 어긋난 응답은 고쳐 쓰지 않고
  RevisionResponseError로 올린다(재시도 대상). 호출 실패(타임아웃·API 오류)는 여기 범위가 아니다.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from tools.contracts import AssignmentStatus, EvidenceItem, SourceType
from tools.generation.pseudonymize import pseudonymize_evidence, restore_names
from tools.json_response import parse_json_response

MAX_INSTRUCTION_CHARS = 500
MAX_SENTENCE_CHARS = 500

_TOKEN_PATTERN = re.compile(r"CHILD_[A-Z]+")
_INSTRUCTION_KEY = "instruction"
_SENTENCE_KEY_PREFIX = "sentence:"


class RevisionResponseError(ValueError):
    """AI 응답이 약속한 형식·규칙을 어겼다. 메시지에 응답 본문을 싣지 않는다 (H-4)."""


@dataclass(frozen=True)
class RevisionSentence:
    """다듬기 대상 초안의 문장 하나. locked는 교사가 직접 고친 문장이라 AI가 바꾸지 못한다."""

    sentence_id: str
    text: str
    locked: bool


@dataclass(frozen=True)
class MaskedRevision:
    """LLM에 보낼 사본과 응답을 실명으로 되돌릴 대응표."""

    instruction: str
    sentences: list[RevisionSentence]
    # CHILD_A → 원아 ID. 응답의 토큰을 저장 전에 실명으로 되돌릴 때 쓴다.
    child_id_by_token: dict[str, str]


def mask_revision_inputs(
    *,
    instruction: str,
    sentences: Sequence[RevisionSentence],
    child_id: str,
    record_date: date,
    names_by_child_id: Mapping[str, Sequence[str]],
) -> MaskedRevision:
    """지시문과 문장 본문의 실명을 토큰으로 바꾼다 (H-2).

    names_by_child_id는 **반 원아 전체**의 이름 목록이다. 대상 원아의 이름을 모르면 호명이 그대로
    남을 수 있어 ValueError로 거부한다(추측해서 넘어가지 않는다).
    """
    items = {
        f"{_SENTENCE_KEY_PREFIX}{sentence.sentence_id}": _as_evidence(
            f"{_SENTENCE_KEY_PREFIX}{sentence.sentence_id}", sentence.text, child_id, record_date
        )
        for sentence in sentences
    }
    items[_INSTRUCTION_KEY] = _as_evidence(_INSTRUCTION_KEY, instruction, child_id, record_date)
    masked = pseudonymize_evidence(
        items, target_child_id=child_id, names_by_child_id=names_by_child_id
    )
    return MaskedRevision(
        instruction=masked.evidence_by_id[_INSTRUCTION_KEY].text,
        sentences=[
            RevisionSentence(
                sentence_id=sentence.sentence_id,
                text=masked.evidence_by_id[f"{_SENTENCE_KEY_PREFIX}{sentence.sentence_id}"].text,
                locked=sentence.locked,
            )
            for sentence in sentences
        ],
        child_id_by_token=masked.child_id_by_token,
    )


def _as_evidence(evidence_id: str, text: str, child_id: str, record_date: date) -> EvidenceItem:
    """마스킹 로직을 재사용하려고 본문을 근거 모양으로 감싼다. 서버 밖으로 나가지 않는다."""
    return EvidenceItem(
        evidence_id=evidence_id,
        source_type=SourceType.TEACHER_NOTE,
        child_ids=[child_id],
        assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
        observed_date=record_date,
        text=text,
    )


def parse_revision_response(raw_response: str | None, *, editable_ids: set[str]) -> dict[str, str]:
    """응답을 검증해 {문장 ID: 새 문장}으로 돌려준다. 바꿀 문장이 없으면 빈 딕셔너리다.

    잠긴 문장이나 이 초안에 없는 문장 ID, 문자열이 아닌 값, 빈 문장, 너무 긴 문장은 응답 전체를
    거부한다 — 일부만 골라 쓰면 AI가 무엇을 바꾸려 했는지 알 수 없다.
    """
    if not raw_response:
        raise RevisionResponseError("다듬기 응답이 비어 있습니다.")
    try:
        payload = parse_json_response(raw_response)
    except ValueError:
        raise RevisionResponseError("다듬기 응답이 JSON이 아닙니다.") from None
    if not isinstance(payload, dict) or set(payload) != {"sentences"}:
        raise RevisionResponseError("다듬기 응답이 약속한 JSON 형식이 아닙니다.")
    changes = payload["sentences"]
    if not isinstance(changes, dict):
        raise RevisionResponseError("다듬기 응답의 sentences가 객체가 아닙니다.")
    result: dict[str, str] = {}
    for sentence_id, text in changes.items():
        if sentence_id not in editable_ids:
            raise RevisionResponseError("바꿀 수 없는 문장을 다듬었습니다.")
        if not isinstance(text, str):
            raise RevisionResponseError("다듬은 문장이 문자열이 아닙니다.")
        stripped = text.strip()
        if not stripped or len(stripped) > MAX_SENTENCE_CHARS:
            raise RevisionResponseError("다듬은 문장이 비었거나 너무 깁니다.")
        result[sentence_id] = stripped
    return result


def restore_revision_text(
    text: str,
    *,
    child_id_by_token: Mapping[str, str],
    names_by_child_id: Mapping[str, Sequence[str]],
) -> str:
    """응답의 토큰을 실명으로 되돌린다. 첫 이름이 승인 전 초안 본문에 쓰는 호칭이다."""
    name_by_token = {
        token: names[0]
        for token, child_id in child_id_by_token.items()
        if (names := names_by_child_id.get(child_id))
    }
    return restore_names(text, name_by_token)


def has_leftover_token(text: str) -> bool:
    """되돌리지 못한 CHILD_X 토큰이 남았는가. 남았으면 그 응답은 버린다."""
    return _TOKEN_PATTERN.search(text) is not None
