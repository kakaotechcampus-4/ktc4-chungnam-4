"""초안 생성 프롬프트 조립 (파이프라인 6단계).

본문은 같은 폴더의 <doc_type>.md에 두고, 이 모듈은 근거 목록과 피드백을 채운다.
실제 LLM 호출은 domains/agents/llm.py가 맡는다.

H-2: 이 모듈은 tools/generation/pseudonymize.py가 만든 LlmEvidence만 받는다. LlmEvidence에는
서버 ID·미디어 ID·시간 필드가 없고, 본문의 실명은 이미 토큰으로 바뀐 상태다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from tools.contracts import DocType
from tools.generation.pseudonymize import LlmEvidence

PROMPT_VERSION = "parent_note.v2"

_EVIDENCE_SLOT = "{{EVIDENCE_LIST}}"
_FEEDBACK_SLOT = "{{FEEDBACK}}"
_SLOT_PATTERN = re.compile(r"\{\{(?:EVIDENCE_LIST|FEEDBACK)\}\}")
_META_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)

# TODO(엄태은): 관찰일지는 매일 쓰지 않고 주기·양식이 원마다 다르다(#115, open-questions 32번).
#   생성 조건이 정해지면 observation_log.md를 추가한다.
_TEMPLATE_BY_DOC_TYPE = {DocType.PARENT_NOTE: "parent_note.md"}


@dataclass(frozen=True)
class DraftFeedback:
    """재생성 때 넘기는 직전 초안의 문제 한 건. 서버 ID를 담지 않는다."""

    problem: str
    sentence: str | None = None
    detail: str | None = None


def build_draft_prompt(
    doc_type: DocType,
    evidence: Sequence[LlmEvidence],
    feedback: Sequence[DraftFeedback] = (),
) -> str:
    if not evidence:
        raise ValueError("근거가 없으면 초안을 만들지 않습니다.")
    evidence_list = json.dumps(
        [
            {
                "ref": item.ref,
                "source_type": item.source_type.value,
                "shared_with_others": item.shared_with_others,
                "text": item.text,
            }
            for item in evidence
        ],
        ensure_ascii=False,
        indent=1,
    )
    feedback_list = json.dumps(
        [
            {key: value for key, value in vars(item).items() if value is not None}
            for item in feedback
        ],
        ensure_ascii=False,
        indent=1,
    )
    values = {_EVIDENCE_SLOT: evidence_list, _FEEDBACK_SLOT: feedback_list}
    template = _load_template(_TEMPLATE_BY_DOC_TYPE[doc_type])
    # 한 번에 치환한다. 근거 본문에 슬롯 문자열이 섞여 있어도 다시 치환되지 않는다.
    return _SLOT_PATTERN.sub(lambda match: values[match.group(0)], template)


@cache
def _load_template(file_name: str) -> str:
    """메타데이터 주석을 뗀 본문. 템플릿이 깨졌으면 프로그래밍 오류로 본다."""
    path = Path(__file__).with_name(file_name)
    raw = path.read_text(encoding="utf-8-sig")
    comment = _META_COMMENT.match(raw)
    if comment is None:
        raise RuntimeError(f"{file_name}: 맨 앞 메타데이터 주석이 없다")
    body = raw[comment.end() :].strip()
    if "<!--" in body or "-->" in body:
        raise RuntimeError(f"{file_name}: 본문에 주석 표시가 남아 있다")
    for slot in (_EVIDENCE_SLOT, _FEEDBACK_SLOT):
        if body.count(slot) != 1:
            raise RuntimeError(f"{file_name}: {slot}가 정확히 한 번 있어야 한다")
    return body
