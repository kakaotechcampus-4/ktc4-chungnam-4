"""Critic LLM 응답 파싱·정규화.

Critic 호출 자체의 실패(타임아웃·API 오류)는 이 함수의 범위가 아니다 — 그건 예외로
올라가서 domains/agents/service.py가 API 재시도 정책으로 따로 다룬다. 여기서는 "호출은
성공했지만 응답 내용이 신뢰할 수 있는 형식인가"만 검사한다. 형식 오류를 통과로
취급하지 않는 것이 이 파일의 핵심 책임이다.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from tools.contracts import (
    CriticSentenceResult,
    DraftDocument,
    VerificationCheckType,
    VerificationIssue,
    VerificationResult,
    VerificationStage,
)


def parse_critic_response(raw_response: str, document: DraftDocument) -> VerificationResult:
    """Critic 응답 문자열을 VerificationResult로 정규화한다.

    - JSON이 아니거나 배열이 아니면 문서 전체 실패(CRITIC_RESPONSE_ERROR).
    - 문서의 모든 sentence_id가 응답에 등장하지 않으면 실패 — 누락은 통과가 아니다.
    - 존재하지 않는 sentence_id를 가리키거나 verdict가 pass/fail이 아니면 그 항목만 오류.
    - 모든 문장이 유효하게 판정되고 전부 pass여야 문서 전체 pass.
    """
    try:
        parsed = json.loads(raw_response)
    except (json.JSONDecodeError, TypeError):
        return _error_result(document, "Critic 응답이 JSON 형식이 아닙니다.")

    if not isinstance(parsed, list):
        return _error_result(document, "Critic 응답이 배열 형식이 아닙니다.")

    known_sentence_ids = {sentence.sentence_id for sentence in document.sentences}
    seen_sentence_ids: set[str] = set()
    issues: list[VerificationIssue] = []

    for entry in parsed:
        if not isinstance(entry, dict):
            return _error_result(document, "Critic 응답 항목이 객체 형식이 아닙니다.")

        try:
            item = CriticSentenceResult.model_validate(entry)
        except ValidationError:
            return _error_result(document, "Critic 응답 항목의 필드가 올바르지 않습니다.")
        sentence_id, verdict = item.sentence_id, item.verdict
        if sentence_id not in known_sentence_ids or sentence_id in seen_sentence_ids:
            return _error_result(document, "존재하지 않거나 중복된 문장 판정입니다.")
        sentence = next(s for s in document.sentences if s.sentence_id == sentence_id)
        if not set(item.evidence_ids).issubset(sentence.evidence_ids):
            return _error_result(document, "문장에 연결되지 않은 근거를 참조했습니다.")
        if verdict == "pass" and not item.evidence_ids:
            return _error_result(document, "통과 판정에 검토한 근거가 없습니다.")

        seen_sentence_ids.add(sentence_id)

        if verdict == "fail":
            issues.append(
                VerificationIssue(
                    sentence_id=sentence_id,
                    check_type=VerificationCheckType.CRITIC_CONTENT,
                    reason=f"{item.reason_code}: {item.detail}",
                    evidence_ids=item.evidence_ids,
                )
            )

    missing = known_sentence_ids - seen_sentence_ids
    if missing:
        return _error_result(
            document, f"Critic이 일부 문장을 판정하지 않았습니다: {sorted(missing)}"
        )

    return VerificationResult(
        draft_id=document.draft_id,
        stage=VerificationStage.CRITIC,
        doc_type=document.doc_type,
        doc_version=document.version,
        passed=len(issues) == 0,
        issues=issues,
    )


def _error_result(document: DraftDocument, reason: str) -> VerificationResult:
    return VerificationResult(
        draft_id=document.draft_id,
        stage=VerificationStage.CRITIC,
        doc_type=document.doc_type,
        doc_version=document.version,
        passed=False,
        issues=[
            VerificationIssue(
                sentence_id=None,
                check_type=VerificationCheckType.CRITIC_RESPONSE_ERROR,
                reason=reason,
            )
        ],
    )
