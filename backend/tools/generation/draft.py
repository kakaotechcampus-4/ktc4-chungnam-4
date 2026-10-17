"""초안 생성 LLM 응답을 DraftDocument로 정규화한다 (파이프라인 6단계, FR-05·FR-06·FR-07).

호출 자체의 실패(타임아웃·API 오류)는 여기 범위가 아니다. "호출은 성공했지만 응답을
믿을 수 있는 형식인가"만 본다. 형식이 깨진 응답은 고쳐 쓰지 않고 DraftResponseError로
올린다 — 파싱 실패는 재시도 대상이다 (domains/agents/CLAUDE.md).

근거 참조가 빠진 문장은 여기서 거르지 않는다. 그건 7-A 코드 검증(references.py)의 몫이고,
거기서 걸려야 재생성 판정과 기록이 남는다. 다만 주지 않은 참조(E99 등)는 서버 ID로 되돌릴
수 없어 여기서 거부한다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from datetime import date

from pydantic import Field, ValidationError

from tools.contracts import ContractModel, DocType, DraftDocument, DraftSentence, NonEmpty

MAX_SENTENCES = 10

_CODE_FENCE = re.compile(r"\A```(?:json)?\s*(.*?)\s*```\Z", re.DOTALL)


class DraftResponseError(ValueError):
    """초안 생성 응답을 DraftDocument로 만들 수 없다. 메시지에 응답 원문을 넣지 않는다."""


class _AnswerSentence(ContractModel):
    text: NonEmpty
    evidence_refs: list[NonEmpty] = Field(default_factory=list)


class _Answer(ContractModel):
    sentences: list[_AnswerSentence] = Field(min_length=1, max_length=MAX_SENTENCES)


def parse_draft_response(
    raw_response: str | None,
    *,
    evidence_id_by_ref: Mapping[str, str],
    doc_type: DocType,
    child_id: str,
    record_date: date,
    draft_id: str,
    version: int,
) -> DraftDocument:
    """응답을 검증하고 E1… 참조를 서버 evidence_id로 되돌린다.

    sentence_id는 LLM에게 받지 않고 순서대로 s1, s2…를 붙인다 — 재생성마다 같은 규칙이라
    문장 ID가 응답 내용에 흔들리지 않는다.
    """
    if not raw_response:
        raise DraftResponseError("초안 생성 응답이 비어 있습니다.")
    text = raw_response.strip()
    fenced = _CODE_FENCE.match(text)
    if fenced:
        text = fenced.group(1)

    try:
        answer = _Answer.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError):
        raise DraftResponseError("초안 생성 응답이 약속한 JSON 형식이 아닙니다.") from None

    sentences: list[DraftSentence] = []
    for index, sentence in enumerate(answer.sentences, start=1):
        if any(ref not in evidence_id_by_ref for ref in sentence.evidence_refs):
            raise DraftResponseError("초안 생성 응답이 주지 않은 근거 참조를 썼습니다.")
        if len(sentence.evidence_refs) != len(set(sentence.evidence_refs)):
            raise DraftResponseError("한 문장에 같은 근거 참조가 중복됐습니다.")
        sentences.append(
            DraftSentence(
                sentence_id=f"s{index}",
                text=sentence.text,
                evidence_ids=[evidence_id_by_ref[ref] for ref in sentence.evidence_refs],
            )
        )

    return DraftDocument(
        doc_type=doc_type,
        child_id=child_id,
        record_date=record_date,
        draft_id=draft_id,
        version=version,
        sentences=sentences,
    )
