import os

import anthropic

from domains.agents.evidence import PreparedEvidenceSet
from domains.agents.schemas import (
    DocType,
    DraftDocument,
    DraftSentence,
    VerificationIssue,
    VerificationResult,
)

# TODO(eun): core/config.py의 Settings가 생기면 os.getenv 대신 core.config.settings로 교체
_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# TODO(eun): 테크스펙엔 "Claude Sonnet 계열"이라고만 되어 있고 정확한 모델 스냅샷은 미정 — 팀 확정 필요
_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")

_DOC_TYPE_SUFFIX = {
    DocType.OBSERVATION_LOG: "활동을 하였다.",
    DocType.PARENT_NOTE: "활동을 했어요.",
}


def call_claude(prompt: str) -> str:
    client = anthropic.Anthropic(api_key=_ANTHROPIC_API_KEY)
    message = client.messages.create(
        model=_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


# TODO(B): 아래 generate_draft()/verify_draft()는 상균이 전체 흐름을 연결하기 위해 만든
#   임시 구현이다. 실제 LLM 호출·프롬프트(prompts/agent2_observation_log.md 등)로 교체한다.
#   입력·출력 형식(DraftDocument, VerificationResult)은 계획서 §7 기준이므로 유지한다.
def generate_draft(
    doc_type: DocType,
    prepared: PreparedEvidenceSet,
    previous_draft: DraftDocument | None = None,
    feedback: list[VerificationIssue] | None = None,
) -> DraftDocument:
    """근거를 문서로 바꾼다. 재생성 시 이전 초안·피드백에서 문제가 지적된 근거 참조는 뺀다."""
    rejected_refs = {
        ref
        for issue in (feedback or [])
        if issue.check_type in ("wrong_child_evidence", "invalid_evidence_ref")
        for ref in _refs_of_sentence(previous_draft, issue.sentence_id)
    }

    suffix = _DOC_TYPE_SUFFIX[doc_type]
    sentences = [
        DraftSentence(
            sentence_id=f"s_{index:02d}", text=f"{ref.text} {suffix}", evidence_ids=[ref.ref]
        )
        for index, ref in enumerate(prepared.refs, start=1)
        if ref.ref not in rejected_refs
    ]
    return DraftDocument(doc_type=doc_type, sentences=sentences)


def verify_draft(draft: DraftDocument, prepared: PreparedEvidenceSet) -> VerificationResult:
    """초안 문장이 근거로 뒷받침되는지 검토한다 (임시: 텍스트 포함 여부만 확인).

    실제 Critic은 별도 세션의 LLM 호출로 대체한다 (CLAUDE.md §7.2 — 앞 단계 히스토리 미전달).
    """
    evidence_text_by_ref = {ref.ref: ref.text for ref in prepared.refs}
    issues: list[VerificationIssue] = []

    for sentence in draft.sentences:
        refs = [ref for ref in sentence.evidence_ids if ref in evidence_text_by_ref]
        supporting_texts = [evidence_text_by_ref[ref] for ref in refs]
        if supporting_texts and not any(text in sentence.text for text in supporting_texts):
            issues.append(
                VerificationIssue(
                    sentence_id=sentence.sentence_id,
                    check_type="unsupported_claim",
                    reason="제공된 근거에 없는 내용입니다.",
                )
            )

    return VerificationResult(doc_type=draft.doc_type, passed=len(issues) == 0, issues=issues)


def _refs_of_sentence(draft: DraftDocument | None, sentence_id: str | None) -> list[str]:
    if draft is None or sentence_id is None:
        return []
    for sentence in draft.sentences:
        if sentence.sentence_id == sentence_id:
            return sentence.evidence_ids
    return []


if __name__ == "__main__":
    # 연결 확인용 1회성 스크립트 — pytest에 포함하지 않음 (CLAUDE.md §11: LLM 실제 호출 금지)
    # H-2: 실제 아동 정보 대신 더미 텍스트만 사용
    print(call_claude("CHILD_A가 오늘 블록 놀이를 했다는 내용으로 한 문장만 만들어줘."))
