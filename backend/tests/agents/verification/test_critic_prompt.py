import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import get_args

import pytest

from prompts.verification import critic
from prompts.verification.critic import PROMPT_VERSION, build_critic_prompt
from tests.agents.fixtures.evidence import EVIDENCE_BY_ID, RECORD_DATE
from tools.contracts import CriticSentenceResult, DocType, DraftDocument, DraftSentence


def test_프롬프트에_문장과_근거_텍스트가_포함된다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[DraftSentence(sentence_id="s1", text="탑을 만들었다", evidence_ids=["ev_001"])],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)

    assert "탑을 만들었다" in prompt
    assert EVIDENCE_BY_ID["ev_001"].text in prompt


def test_존재하지_않는_근거_참조는_프롬프트에서_제외한다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[DraftSentence(sentence_id="s1", text="지어낸 근거", evidence_ids=["ev_999"])],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)
    payload = json.loads(prompt.split("검증 대상:\n", 1)[1])

    assert payload["sentences"][0]["evidences"] == []


def test_공동_근거는_shared_with_others로_표시된다():
    document = DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[DraftSentence(sentence_id="s1", text="함께 정리했다", evidence_ids=["ev_003"])],
    )

    prompt = build_critic_prompt(document, EVIDENCE_BY_ID)
    payload = json.loads(prompt.split("검증 대상:\n", 1)[1])

    assert payload["sentences"][0]["evidences"][0]["shared_with_others"] is True


def _document() -> DraftDocument:
    return DraftDocument(
        doc_type=DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[DraftSentence(sentence_id="s1", text="관찰 문장", evidence_ids=["ev_001"])],
    )


def test_메타_주석과_자리표시자가_남지_않고_버전이_있다():
    prompt = build_critic_prompt(_document(), EVIDENCE_BY_ID)

    assert "<!--" not in prompt
    assert "-->" not in prompt
    assert "{{DOCUMENT}}" not in prompt
    assert "PROMPT_VERSION" not in prompt
    assert PROMPT_VERSION == "critic.v1"


def test_본문의_응답_형식은_파서_계약과_같은_필드를_쓴다():
    # 이름이 어긋나면 모든 응답이 형식 오류가 된다. 한쪽만 고치면 여기서 실패한다.
    prompt = build_critic_prompt(_document(), EVIDENCE_BY_ID)
    format_line = next(line for line in prompt.splitlines() if line.startswith('{"sentence_id"'))

    assert re.findall(r'"(\w+)": ', format_line) == list(CriticSentenceResult.model_fields)
    reason_codes = get_args(CriticSentenceResult.model_fields["reason_code"].annotation)
    assert all(f'"{code}"' in format_line for code in reason_codes)


def test_근거_본문에_자리표시자_문자열이_있어도_다시_치환하지_않는다():
    evidence = EVIDENCE_BY_ID["ev_001"].model_copy(update={"text": "{{DOCUMENT}} 블록"})

    prompt = build_critic_prompt(_document(), {"ev_001": evidence})
    payload = json.loads(prompt.split("검증 대상:\n", 1)[1])

    assert payload["sentences"][0]["evidences"][0]["text"] == "{{DOCUMENT}} 블록"


@pytest.fixture
def template(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    path = tmp_path / "critic.md"
    monkeypatch.setattr(critic, "_TEMPLATE_PATH", path)
    critic._load_template.cache_clear()
    yield path
    critic._load_template.cache_clear()


@pytest.mark.parametrize(
    "content, message",
    [
        ("본문\n{{DOCUMENT}}", "주석이 없다"),
        ("<!-- 닫히지 않은 메타\n{{DOCUMENT}}", "주석이 없다"),
        ("<!-- 메타 -->\n   \n", "본문이 비어"),
        ("<!-- 메타 --> 남은 메타 -->\n본문\n{{DOCUMENT}}", "주석 표시"),
        ("<!-- 메타 -->\n본문만 있고 자리표시자가 없다", "정확히 한 번"),
        ("<!-- 메타 -->\n{{DOCUMENT}}\n{{DOCUMENT}}", "정확히 한 번"),
    ],
    ids=[
        "주석_없음",
        "주석_안_닫힘",
        "본문_빔",
        "주석_닫는_표시_중복",
        "자리표시자_없음",
        "자리표시자_두_번",
    ],
)
def test_템플릿이_깨졌으면_RuntimeError(template, content, message):
    template.write_text(content, encoding="utf-8")

    with pytest.raises(RuntimeError, match=message):
        build_critic_prompt(_document(), EVIDENCE_BY_ID)


def test_BOM으로_저장된_템플릿도_읽는다(template):
    template.write_text("\ufeff<!-- 메타 -->\n검증 대상:\n{{DOCUMENT}}", encoding="utf-8")

    prompt = build_critic_prompt(_document(), EVIDENCE_BY_ID)

    assert prompt.startswith("검증 대상:\n{")
