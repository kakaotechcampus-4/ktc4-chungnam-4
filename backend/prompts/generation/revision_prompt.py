"""초안 다듬기 요청 프롬프트 조립 (FR-18).

본문은 같은 폴더의 revision.md에 두고, 이 모듈은 문체·지시문·문장 목록을 채운다.
실제 LLM 호출은 domains/agents/llm.py가 맡는다.

H-2: 이 모듈은 tools/generation/revision.py가 실명을 토큰으로 바꾼 입력만 받는다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from functools import cache
from pathlib import Path

from tools.contracts import DocType
from tools.generation.revision import RevisionSentence

PROMPT_VERSION = "revision.v1"

_TONE_SLOT = "{{TONE}}"
_INSTRUCTION_SLOT = "{{INSTRUCTION}}"
_SENTENCES_SLOT = "{{SENTENCES}}"
_SLOT_PATTERN = re.compile(r"\{\{(?:TONE|INSTRUCTION|SENTENCES)\}\}")
_META_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)

# 초안 생성 프롬프트(parent_note.md·observation_log.md)의 문체 규칙과 같게 둔다.
_TONE_BY_DOC_TYPE = {
    DocType.PARENT_NOTE: (
        '학부모에게 보내는 다정한 존댓말("~했어요", "~하는 모습이었어요")로 쓴다. '
        "문장은 짧게, 한 문장에 한 가지 사실만 담는다."
    ),
    DocType.OBSERVATION_LOG: "'~하였다' 문체로 관찰한 행동만 쓴다.",
}


def build_revision_prompt(
    doc_type: DocType, instruction: str, sentences: Sequence[RevisionSentence]
) -> str:
    if not sentences:
        raise ValueError("다듬을 문장이 없으면 프롬프트를 만들지 않습니다.")
    sentence_list = json.dumps(
        [
            {"id": sentence.sentence_id, "text": sentence.text, "locked": sentence.locked}
            for sentence in sentences
        ],
        ensure_ascii=False,
        indent=1,
    )
    values = {
        _TONE_SLOT: _TONE_BY_DOC_TYPE[doc_type],
        # 문자열로 한 번 감싸 지시문이 프롬프트 구조를 흉내 내지 못하게 한다.
        _INSTRUCTION_SLOT: json.dumps(instruction, ensure_ascii=False),
        _SENTENCES_SLOT: sentence_list,
    }
    template = _load_template("revision.md")
    # 한 번에 치환한다. 지시문·문장 본문에 슬롯 문자열이 섞여 있어도 다시 치환되지 않는다.
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
    for slot in (_TONE_SLOT, _INSTRUCTION_SLOT, _SENTENCES_SLOT):
        if body.count(slot) != 1:
            raise RuntimeError(f"{file_name}: {slot}가 정확히 한 번 있어야 한다")
    return body
