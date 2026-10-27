"""Critic 프롬프트 조립 (파이프라인 7-B).

Critic은 코드 검증(references/target)을 통과한 문서의 "내용"을 근거와 대조한다.
본문은 같은 폴더의 critic.md에 두고, 이 모듈은 검증 대상(문장과 근거)을 채운다.
실제 LLM 호출은 domains/agents/llm.py가 맡는다.

H-2: 여기 들어오는 문서·근거는 호출하는 쪽(domains/agents/service.py의 _run_critic)이 근거 ID를
E1… 임시 참조로 바꾼 사본이다. 문장과 근거 본문의 실명도 이미 CHILD_A류 토큰으로 바뀌어
있어야 한다. 이 함수는 그 전제를 검사하지 않는다.
"""

from __future__ import annotations

import json
import re
from functools import cache
from pathlib import Path

from tools.contracts import DraftDocument, EvidenceItem

PROMPT_VERSION = "critic.v1"

_TEMPLATE_PATH = Path(__file__).with_name("critic.md")
_DOCUMENT_SLOT = "{{DOCUMENT}}"
# 맨 앞 메타데이터 주석(입력 변수·기대 출력 형식). 사람이 읽는 용도라 LLM에는 보내지 않는다.
_META_COMMENT = re.compile(r"\A\s*<!--.*?-->\s*", re.DOTALL)


def build_critic_prompt(document: DraftDocument, evidence_by_id: dict[str, EvidenceItem]) -> str:
    """검증 대상 문장과 근거를 직렬화해 Critic 프롬프트를 만든다.

    존재하지 않는 근거를 참조하는 문장은 이미 코드 검증에서 걸러졌다고 가정하지 않고,
    여기서도 evidence_by_id에 없는 참조는 건너뛴다 (Critic이 없는 근거를 판단 재료로
    받지 않도록).
    """
    sentence_payload = []
    for sentence in document.sentences:
        evidences = [
            {
                "evidence_id": evidence_id,
                "source_type": evidence_by_id[evidence_id].source_type.value,
                "shared_with_others": len(evidence_by_id[evidence_id].child_ids) > 1,
                "text": evidence_by_id[evidence_id].text,
            }
            for evidence_id in sentence.evidence_ids
            if evidence_id in evidence_by_id
        ]
        sentence_payload.append(
            {
                "sentence_id": sentence.sentence_id,
                "text": sentence.text,
                "evidences": evidences,
            }
        )

    body = json.dumps(
        {"doc_type": document.doc_type.value, "sentences": sentence_payload},
        ensure_ascii=False,
    )
    # 본문의 응답 형식 예시에 중괄호가 있어 str.format 대신 자리표시자만 바꾼다. 템플릿만
    # 훑으므로 근거 본문에 자리표시자 문자열이 섞여 있어도 다시 치환되지 않는다.
    return _load_template().replace(_DOCUMENT_SLOT, body)


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
    if body.count(_DOCUMENT_SLOT) != 1:
        raise RuntimeError(f"{_TEMPLATE_PATH.name}: {_DOCUMENT_SLOT}가 정확히 한 번 있어야 한다")
    return body
