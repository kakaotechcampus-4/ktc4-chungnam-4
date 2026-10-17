import json
import os
import uuid
from datetime import UTC, datetime
from typing import Self

import pytest

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

from core.exceptions import DraftVersionConflict
from domains.agents import service
from tests.agents.fixtures.evidence import (
    EVIDENCE_ACTIVITY_PLAN,
    EVIDENCE_BY_ID,
    EVIDENCE_CHILD_A,
    RECORD_DATE,
)
from tools import contracts
from tools.generation.draft import DraftResponseError


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False
        self.rolled_back = False

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


@pytest.fixture(autouse=True)
def _generation_inputs(monkeypatch) -> None:
    """orchestrate_drafts가 루프 전에 부르는 입력 적재를 막는다. 필요한 테스트가 다시 덮어쓴다."""
    monkeypatch.setattr(service, "_load_generation_inputs", lambda bundle: object())


def _document(evidence_ids: tuple[str, ...] = ("ev_001",)) -> contracts.DraftDocument:
    return contracts.DraftDocument(
        doc_type=contracts.DocType.OBSERVATION_LOG,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            contracts.DraftSentence(
                sentence_id="s1",
                text="블록 놀이를 했다",
                evidence_ids=list(evidence_ids),
            )
        ],
    )


def _generated(*, draft_id: str | None = None, version: int = 1) -> service.GeneratedDraft:
    document = _document()
    if draft_id is not None:
        document = contracts.DraftDocument.model_validate(
            {**document.model_dump(), "draft_id": draft_id, "version": version}
        )
    return service.GeneratedDraft(
        document=document,
        masked_evidence_by_id=EVIDENCE_BY_ID,
        source_evidence_by_id=EVIDENCE_BY_ID,
        request=_request(),
        name_by_token={},
    )


def _request(
    evidence_ids: tuple[str, ...] = ("ev_001",),
) -> contracts.GenerationRequest:
    return contracts.GenerationRequest(
        request_id="req-1",
        class_id="class_A",
        child_id="child_A",
        record_date=RECORD_DATE,
        evidence_ids=list(evidence_ids),
    )


def _critic_response(*, verdict: str = "pass") -> str:
    reason_code = "ok" if verdict == "pass" else "unsupported_claim"
    return json.dumps(
        [
            {
                "sentence_id": "s1",
                "verdict": verdict,
                "reason_code": reason_code,
                "detail": "검토 결과",
                "evidence_ids": ["E1"],
            }
        ]
    )


def test_verify_and_record_모든_검증을_통과하면_PASS를_반환하고_검증_기록만_커밋한다(
    monkeypatch,
) -> None:
    session = FakeSession()
    monkeypatch.setattr(service, "call_claude", lambda prompt: _critic_response())

    result = service._verify_and_record(session, _document(), EVIDENCE_BY_ID, _request(), 0)

    assert result.decision == contracts.Decision.PASS
    assert session.committed

    # 근거는 본문 저장과 같은 트랜잭션에서 남긴다 — _save_passed_draft 테스트 참고 (#75 3번).
    sentence_rows = [obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)]
    assert sentence_rows == []

    issue_rows = [obj for obj in session.added if isinstance(obj, service.VerificationResultRow)]
    assert issue_rows == []  # 통과했으니 남길 실패 사유가 없다


def test_verify_and_record_최종_판정을_draft_decision_log에_남긴다(monkeypatch) -> None:
    session = FakeSession()
    monkeypatch.setattr(service, "call_claude", lambda prompt: _critic_response())
    document = _document()

    service._verify_and_record(
        session,
        document,
        EVIDENCE_BY_ID,
        _request(),
        regeneration_count=1,
        critic_retry_count=1,
    )

    decision_rows = [obj for obj in session.added if isinstance(obj, service.DraftDecisionLog)]
    assert len(decision_rows) == 1
    assert decision_rows[0].draft_id == document.draft_id
    assert decision_rows[0].doc_version == document.version
    assert decision_rows[0].decision == contracts.Decision.PASS.value
    assert decision_rows[0].regeneration_count == 1
    assert decision_rows[0].critic_retry_count == 1


def test_verify_and_record_코드_검증이_실패하면_critic을_부르지_않고_재생성한다(
    monkeypatch,
) -> None:
    session = FakeSession()

    def _fail_if_called(prompt: str) -> str:
        raise AssertionError("코드 검증 실패 시 Critic을 호출하면 안 된다")

    monkeypatch.setattr(service, "call_claude", _fail_if_called)

    document = _document(evidence_ids=("ev_999",))  # 존재하지 않는 근거
    result = service._verify_and_record(session, document, EVIDENCE_BY_ID, _request(), 0)

    assert result.decision == contracts.Decision.REGENERATE

    issue_rows = [obj for obj in session.added if isinstance(obj, service.VerificationResultRow)]
    assert len(issue_rows) == 1
    assert issue_rows[0].check_type == contracts.VerificationCheckType.INVALID_EVIDENCE_REF.value
    # 순번이 아니라 sentence_id와 검증한 초안 버전으로 남긴다 (#75, #91).
    assert issue_rows[0].sentence_id == "s1"
    assert issue_rows[0].doc_version == document.version

    sentence_rows = [obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)]
    assert sentence_rows == []  # 실패한 시도는 근거를 남기지 않는다


def test_verify_and_record_재생성_상한에_도달하면_교사_확인으로_보낸다(
    monkeypatch,
) -> None:
    session = FakeSession()

    def _fail_if_called(prompt: str) -> str:
        raise AssertionError("코드 검증 실패 시 Critic을 호출하면 안 된다")

    monkeypatch.setattr(service, "call_claude", _fail_if_called)

    document = _document(evidence_ids=("ev_999",))
    result = service._verify_and_record(session, document, EVIDENCE_BY_ID, _request(), 2)

    assert result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW


def test_verify_and_record_critic_응답이_JSON이_아니면_RETRY_CRITIC을_반환한다(
    monkeypatch,
) -> None:
    session = FakeSession()
    monkeypatch.setattr(service, "call_claude", lambda prompt: "이건 JSON이 아닙니다")

    result = service._verify_and_record(session, _document(), EVIDENCE_BY_ID, _request(), 0)

    assert result.decision == contracts.Decision.RETRY_CRITIC


def test_verify_with_critic_retry_한번_재시도_후_통과하면_그대로_반환한다(
    monkeypatch,
) -> None:
    decisions = iter([contracts.Decision.RETRY_CRITIC, contracts.Decision.PASS])

    def _fake_verify(session, document, evidence_by_id, request, regeneration_count, **kwargs):
        return contracts.DecisionResult(decision=next(decisions), reason="테스트")

    monkeypatch.setattr(service, "_verify_and_record", _fake_verify)

    result = service._verify_with_critic_retry(
        FakeSession(), _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.PASS


def test_verify_with_critic_retry_상한을_넘기면_교사_확인으로_넘긴다(
    monkeypatch,
) -> None:
    calls = 0

    def _always_retry_critic(
        session, document, evidence_by_id, request, regeneration_count, **kwargs
    ):
        nonlocal calls
        calls += 1
        return contracts.DecisionResult(decision=contracts.Decision.RETRY_CRITIC, reason="테스트")

    monkeypatch.setattr(service, "_verify_and_record", _always_retry_critic)

    result = service._verify_with_critic_retry(
        FakeSession(), _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW
    assert calls == service.MAX_CRITIC_RETRIES + 1


def _fake_job(**overrides: object) -> service.Job:
    job = service.Job(target_date=datetime(2026, 9, 16, tzinfo=UTC))
    for key, value in overrides.items():
        setattr(job, key, value)
    return job


def test_orchestrate_drafts_성공하면_초안을_저장하고_미분류함으로_보내지_않는다(
    monkeypatch,
) -> None:
    saved: list[contracts.DraftDocument] = []

    def _fail_if_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("성공했는데 미분류함으로 보내면 안 된다")

    monkeypatch.setattr(
        service,
        "_save_passed_draft",
        lambda session, job, bundle, document, evidence_by_id: saved.append(document),
    )
    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(
        service,
        "_generate_draft",
        lambda bundle, **kwargs: _generated(),
    )
    monkeypatch.setattr(
        service,
        "_verify_with_critic_retry",
        lambda session, document, evidence_by_id, request, regeneration_count: (
            contracts.DecisionResult(decision=contracts.Decision.PASS, reason="테스트")
        ),
    )
    monkeypatch.setattr(service, "_send_to_unclassified", _fail_if_called)

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert len(saved) == 1


def test_orchestrate_drafts_교사_확인이_필요하면_미분류함으로_보낸다(
    monkeypatch,
) -> None:
    unclassified_calls: list[tuple[str, str]] = []

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(
        service,
        "_generate_draft",
        lambda bundle, **kwargs: _generated(),
    )
    monkeypatch.setattr(
        service,
        "_verify_with_critic_retry",
        lambda session, document, evidence_by_id, request, regeneration_count: (
            contracts.DecisionResult(
                decision=contracts.Decision.NEEDS_TEACHER_REVIEW, reason="테스트"
            )
        ),
    )
    monkeypatch.setattr(
        service,
        "_send_to_unclassified",
        lambda session, job_id, child_id: unclassified_calls.append((job_id, child_id)),
    )

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert unclassified_calls == [("job-1", "child-1")]


def test_orchestrate_drafts_재생성은_같은_draft_id의_다음_버전이고_걸린_문제를_넘긴다(
    monkeypatch,
) -> None:
    generate_calls: list[tuple[str | None, list[contracts.VerificationIssue]]] = []
    verify_calls: list[int] = []
    documents: list[contracts.DraftDocument] = []
    issue = contracts.VerificationIssue(
        sentence_id="s1",
        check_type=contracts.VerificationCheckType.CRITIC_CONTENT,
        reason="unsupported_claim: 근거에 없는 내용",
    )
    decisions = iter(
        [
            contracts.DecisionResult(
                decision=contracts.Decision.REGENERATE, reason="테스트", issues=[issue]
            ),
            contracts.DecisionResult(decision=contracts.Decision.PASS, reason="테스트"),
        ]
    )

    def _fake_generate(bundle, *, draft_id, version, previous, issues):
        generate_calls.append((version, previous.draft_id if previous else None, list(issues)))
        generated = _generated(draft_id=draft_id, version=version)
        documents.append(generated.document)
        return generated

    def _fake_verify(session, document, evidence_by_id, request, regeneration_count):
        verify_calls.append(regeneration_count)
        return next(decisions)

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(service, "_generate_draft", _fake_generate)
    monkeypatch.setattr(service, "_save_passed_draft", lambda *args: None)
    monkeypatch.setattr(service, "_verify_with_critic_retry", _fake_verify)
    monkeypatch.setattr(
        service,
        "_send_to_unclassified",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("재생성 성공 후엔 안 불러야 함")
        ),
    )

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert generate_calls == [(1, None, []), (2, documents[0].draft_id, [issue])]
    assert documents[0].draft_id == documents[1].draft_id
    assert verify_calls == [0, 1]


CHILD_UUID = "c41d0000-0000-4000-8000-000000000001"
TEACHER_UUID = uuid.UUID("7ea00000-0000-4000-8000-000000000001")
BUNDLE_UUID = uuid.UUID("b0d10000-0000-4000-8000-000000000001")


def _saveable_document() -> contracts.DraftDocument:
    """DraftSaveInput은 child_id가 UUID여야 해서 따로 만든다."""
    return contracts.DraftDocument(
        doc_type=contracts.DocType.OBSERVATION_LOG,
        child_id=CHILD_UUID,
        record_date=RECORD_DATE,
        sentences=[
            contracts.DraftSentence(
                sentence_id="s1", text="블록 놀이를 했다", evidence_ids=["ev_001"]
            ),
            contracts.DraftSentence(sentence_id="s2", text="탑을 높이 쌓았다", evidence_ids=[]),
        ],
    )


def _stub_save_dependencies(monkeypatch, save_draft) -> None:
    monkeypatch.setattr(service, "_author_teacher_id", lambda session, job: TEACHER_UUID)
    monkeypatch.setattr(service.documents, "save_draft", save_draft)


def test_save_passed_draft_agents의_draft_id로_저장하고_근거와_함께_커밋한다(
    monkeypatch,
) -> None:
    session = FakeSession()
    calls: list[tuple[object, int | None]] = []
    _stub_save_dependencies(
        monkeypatch,
        lambda db, data, *, expected_version: calls.append((data, expected_version)),
    )
    document = _saveable_document()

    service._save_passed_draft(
        session, _fake_job(), service.EvidenceBundle(id=BUNDLE_UUID), document, EVIDENCE_BY_ID
    )

    [(data, expected_version)] = calls
    assert expected_version is None
    # 검증 기록이 문서를 찾으려면 agents가 만든 ID 그대로여야 한다 (#75 2번).
    assert str(data.draft_id) == document.draft_id
    assert data.author_teacher_id == TEACHER_UUID
    assert data.ai_version == document.version
    assert data.evidence_bundle_id == BUNDLE_UUID
    assert data.content == "블록 놀이를 했다\n탑을 높이 쌓았다"

    sentence_rows = [obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)]
    assert len(sentence_rows) == 1
    assert sentence_rows[0].draft_id == document.draft_id
    assert sentence_rows[0].sentence_id == "s1"
    assert sentence_rows[0].evidence_id == "ev_001"
    assert sentence_rows[0].source_media_id == EVIDENCE_CHILD_A.media_id
    assert sentence_rows[0].source_timestamp == EVIDENCE_CHILD_A.start_ms / 1000
    assert sentence_rows[0].source_text == EVIDENCE_CHILD_A.text
    assert session.committed
    assert not session.rolled_back


def test_save_passed_draft_저장이_충돌하면_근거를_남기지_않고_되돌린다(monkeypatch) -> None:
    """교사 문서를 그대로 두고, 반영되지 못한 AI 초안의 근거도 남기지 않는다 (#75 3번·6번)."""
    session = FakeSession()

    def _conflict(db, data, *, expected_version):
        raise DraftVersionConflict("이미 있습니다")

    _stub_save_dependencies(monkeypatch, _conflict)

    service._save_passed_draft(
        session,
        _fake_job(),
        service.EvidenceBundle(id=BUNDLE_UUID),
        _saveable_document(),
        EVIDENCE_BY_ID,
    )

    sentence_rows = [obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)]
    assert sentence_rows == []
    assert session.rolled_back
    assert not session.committed


def test_save_passed_draft_충돌하면_id와_코드만_로그로_남긴다(monkeypatch, caplog) -> None:
    """PASS 기록은 있는데 문서가 없는 이유를 추적할 단서를 남긴다 (#90). 본문은 남기지 않는다(H-4)."""
    job = _fake_job(id=uuid.uuid4())
    document = _saveable_document()

    def _conflict(db, data, *, expected_version):
        raise DraftVersionConflict("이미 있습니다")

    _stub_save_dependencies(monkeypatch, _conflict)

    with caplog.at_level("WARNING", logger=service.__name__):
        service._save_passed_draft(
            FakeSession(), job, service.EvidenceBundle(id=BUNDLE_UUID), document, EVIDENCE_BY_ID
        )

    [record] = caplog.records
    message = record.getMessage()
    assert service.DRAFT_SAVE_CONFLICT in message
    assert str(job.id) in message
    assert document.draft_id in message
    assert all(sentence.text not in message for sentence in document.sentences)


class _GetSession(FakeSession):
    def __init__(self, rows: dict[object, object]) -> None:
        super().__init__()
        self.rows = rows

    def get(self, model: type, key: object) -> object | None:
        return self.rows.get((model, key))


def test_author_teacher_id_요청한_교사를_GenerationJob에서_읽는다() -> None:
    """비동기 task에는 세션 교사가 없어서, 요청 시점에 저장한 교사를 쓴다 (FR-26)."""
    generation_job_id = uuid.uuid4()
    session = _GetSession(
        {
            (service.GenerationJob, generation_job_id): service.GenerationJob(
                id=generation_job_id, requested_by_teacher_id=TEACHER_UUID
            )
        }
    )

    teacher_id = service._author_teacher_id(session, _fake_job(generation_job_id=generation_job_id))

    assert teacher_id == TEACHER_UUID


def test_author_teacher_id_GenerationJob이_없으면_임의_값으로_채우지_않는다() -> None:
    with pytest.raises(ValueError):
        service._author_teacher_id(_GetSession({}), _fake_job(generation_job_id=uuid.uuid4()))


def test_get_job_raises_when_missing(monkeypatch) -> None:
    session = FakeSession()
    session.get = lambda model, job_id: None  # type: ignore[method-assign]

    try:
        service._get_job(session, "missing-job")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for missing job")


# ---- 초안 생성 (_generate_draft) ----

# 합성 이름이다 (실제 원아 정보 금지). child_C는 근거에 귀속되지 않은 같은 반 원아다.
_SYNTHETIC_NAMES = {
    "child_A": ["나다", "가나다"],
    "child_B": ["라마바"],
    "child_C": ["마바", "사마바"],
}


def _speech_with_names() -> contracts.EvidenceItem:
    return EVIDENCE_CHILD_A.model_copy(update={"text": "마바야 나다랑 같이 탑 쌓자"})


def _inputs(evidence: list[contracts.EvidenceItem]) -> service.GenerationInputs:
    return service.GenerationInputs(
        request=_request(tuple(item.evidence_id for item in evidence)),
        evidence=evidence,
        names_by_child_id=_SYNTHETIC_NAMES,
    )


def _draft_answer(refs: list[str]) -> str:
    return json.dumps(
        {"sentences": [{"text": "CHILD_A는 친구와 높은 탑을 쌓았어요.", "evidence_refs": refs}]},
        ensure_ascii=False,
    )


def _generate(previous=None, issues=(), *, version: int = 1) -> service.GeneratedDraft:
    return service._generate_draft(
        service._load_generation_inputs(object()),
        draft_id="draft-1",
        version=version,
        previous=previous,
        issues=list(issues),
    )


def test_generate_draft_근거에_없는_같은_반_원아_이름도_LLM에_가지_않는다(monkeypatch) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(
        service, "_load_generation_inputs", lambda bundle: _inputs([_speech_with_names()])
    )
    monkeypatch.setattr(
        service, "call_claude", lambda prompt: prompts.append(prompt) or _draft_answer(["E1"])
    )

    generated = _generate()

    for forbidden in ("나다", "마바", "child_A", "ev_001"):
        assert forbidden not in prompts[0]
    assert "CHILD_C야 CHILD_A랑 같이 탑 쌓자" in prompts[0]
    assert generated.masked_evidence_by_id["ev_001"].text == "CHILD_C야 CHILD_A랑 같이 탑 쌓자"
    assert generated.document.doc_type == contracts.DocType.PARENT_NOTE
    assert generated.document.sentences[0].evidence_ids == ["ev_001"]


def test_generate_draft_저장용_근거는_원본이고_본문은_저장_직전에_호칭으로_되돌린다(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        service, "_load_generation_inputs", lambda bundle: _inputs([_speech_with_names()])
    )
    monkeypatch.setattr(service, "call_claude", lambda prompt: _draft_answer(["E1"]))

    generated = _generate()
    restored = service._restore_names(generated)

    assert generated.source_evidence_by_id["ev_001"].text == "마바야 나다랑 같이 탑 쌓자"
    assert generated.document.sentences[0].text.startswith("CHILD_A는")
    assert restored.sentences[0].text == "나다는 친구와 높은 탑을 쌓았어요."
    assert restored.draft_id == generated.document.draft_id


def test_generate_draft_재생성은_받은_draft_id와_버전으로_만들고_문제를_피드백한다(
    monkeypatch,
) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(
        service, "_load_generation_inputs", lambda bundle: _inputs([_speech_with_names()])
    )
    monkeypatch.setattr(
        service, "call_claude", lambda prompt: prompts.append(prompt) or _draft_answer(["E1"])
    )
    issue = contracts.VerificationIssue(
        sentence_id="s1",
        check_type=contracts.VerificationCheckType.INVALID_EVIDENCE_REF,
        reason="제공되지 않은 근거 ev_999를 참조했습니다.",
    )

    generated = _generate(_document(), [issue], version=2)

    assert generated.document.draft_id == "draft-1"
    assert generated.document.version == 2
    assert "invalid_evidence_ref" in prompts[0]
    assert "블록 놀이를 했다" in prompts[0]
    # 코드 검증 사유에는 서버 근거 ID가 섞여 있어 넘기지 않는다.
    assert "ev_999" not in prompts[0]


@pytest.mark.parametrize(
    "evidence",
    [
        [EVIDENCE_CHILD_A.model_copy(update={"child_ids": ["child_B"]})],
        [EVIDENCE_ACTIVITY_PLAN],
    ],
    ids=["대상_원아_근거_없음", "활동계획만_남음"],
)
def test_generate_draft_관찰_근거가_없으면_LLM을_부르지_않는다(monkeypatch, evidence) -> None:
    monkeypatch.setattr(service, "_load_generation_inputs", lambda bundle: _inputs(evidence))
    monkeypatch.setattr(
        service,
        "call_claude",
        lambda prompt: (_ for _ in ()).throw(AssertionError("LLM을 부르면 안 된다")),
    )

    with pytest.raises(service.InsufficientEvidence):
        _generate()


def _patch_orchestrate(monkeypatch, generate, unclassified_calls: list) -> None:
    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(service, "_generate_draft", generate)
    monkeypatch.setattr(
        service,
        "_send_to_unclassified",
        lambda session, job_id, child_id: unclassified_calls.append((job_id, child_id)),
    )


def test_orchestrate_drafts_근거가_없으면_미분류함으로_보낸다(monkeypatch) -> None:
    unclassified_calls: list[tuple[str, str]] = []

    def _no_evidence(bundle, **kwargs):
        raise service.InsufficientEvidence

    _patch_orchestrate(monkeypatch, _no_evidence, unclassified_calls)

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert unclassified_calls == [("job-1", "child-1")]


def test_orchestrate_drafts_생성_응답_형식_오류는_기록하고_재생성한다(monkeypatch) -> None:
    unclassified_calls: list[tuple[str, str]] = []
    calls: list[tuple[int, list[contracts.VerificationIssue]]] = []
    session = FakeSession()

    def _broken_then_ok(bundle, *, draft_id, version, previous, issues):
        calls.append((version, list(issues)))
        if len(calls) == 1:
            raise DraftResponseError("초안 생성 응답이 약속한 JSON 형식이 아닙니다.")
        return _generated(draft_id=draft_id, version=version)

    _patch_orchestrate(monkeypatch, _broken_then_ok, unclassified_calls)
    monkeypatch.setattr(service, "SessionLocal", lambda: session)
    monkeypatch.setattr(
        service,
        "_verify_with_critic_retry",
        lambda *args: contracts.DecisionResult(decision=contracts.Decision.PASS, reason="t"),
    )
    saved: list[contracts.DraftDocument] = []
    monkeypatch.setattr(
        service, "_save_passed_draft", lambda session, job, bundle, doc, ev: saved.append(doc)
    )

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert [version for version, _ in calls] == [1, 2]
    assert calls[1][1][0].check_type == contracts.VerificationCheckType.DRAFT_RESPONSE_ERROR
    rows = [row for row in session.added if isinstance(row, service.VerificationResultRow)]
    assert [(row.check_type, row.sentence_id, row.doc_version) for row in rows] == [
        ("draft_response_error", None, 1)
    ]
    logs = [row for row in session.added if isinstance(row, service.DraftDecisionLog)]
    assert [(log.decision, log.doc_version) for log in logs] == [("regenerate", 1)]
    assert len(saved) == 1
    assert unclassified_calls == []


def test_orchestrate_drafts_생성_응답_형식_오류가_상한을_넘으면_미분류함으로_보낸다(
    monkeypatch,
) -> None:
    unclassified_calls: list[tuple[str, str]] = []
    session = FakeSession()

    def _always_broken(bundle, **kwargs):
        raise DraftResponseError("초안 생성 응답이 비어 있습니다.")

    _patch_orchestrate(monkeypatch, _always_broken, unclassified_calls)
    monkeypatch.setattr(service, "SessionLocal", lambda: session)

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    logs = [row for row in session.added if isinstance(row, service.DraftDecisionLog)]
    assert [log.decision for log in logs] == ["regenerate", "regenerate", "needs_teacher_review"]
    assert unclassified_calls == [("job-1", "child-1")]


def test_생성부터_Critic까지_실명이_LLM에_가지_않는다(monkeypatch) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(
        service, "_load_generation_inputs", lambda bundle: _inputs([_speech_with_names()])
    )

    def _fake_claude(prompt: str) -> str:
        prompts.append(prompt)
        if len(prompts) == 1:
            return _draft_answer(["E1"])
        return json.dumps(
            [
                {
                    "sentence_id": "s1",
                    "verdict": "pass",
                    "reason_code": "ok",
                    "detail": "근거와 일치",
                    "evidence_ids": ["E1"],
                }
            ]
        )

    monkeypatch.setattr(service, "call_claude", _fake_claude)

    generated = _generate()
    result = service._verify_and_record(
        FakeSession(),
        generated.document,
        generated.masked_evidence_by_id,
        generated.request,
        0,
    )

    assert result.decision == contracts.Decision.PASS
    assert len(prompts) == 2
    assert all("나다" not in prompt and "마바" not in prompt for prompt in prompts)
    assert all("ev_001" not in prompt for prompt in prompts)


def test_Critic에는_서버_근거_ID_대신_임시_참조를_보내고_결과는_서버_ID로_되돌린다(
    monkeypatch,
) -> None:
    prompts: list[str] = []
    media_scoped = EVIDENCE_CHILD_A.model_copy(
        update={"evidence_id": "photo:3ed1a000-0000-4000-8000-000000000046:1"}
    )
    document = contracts.DraftDocument(
        doc_type=contracts.DocType.PARENT_NOTE,
        child_id="child_A",
        record_date=RECORD_DATE,
        sentences=[
            contracts.DraftSentence(
                sentence_id="s1", text="탑을 쌓았어요.", evidence_ids=[media_scoped.evidence_id]
            )
        ],
    )

    def _fake_claude(prompt: str) -> str:
        prompts.append(prompt)
        return json.dumps(
            [
                {
                    "sentence_id": "s1",
                    "verdict": "fail",
                    "reason_code": "unsupported_claim",
                    "detail": "E1에 없는 내용",
                    "evidence_ids": ["E1"],
                }
            ],
            ensure_ascii=False,
        )

    monkeypatch.setattr(service, "call_claude", _fake_claude)

    result = service._run_critic(document, {media_scoped.evidence_id: media_scoped})

    assert "3ed1a000" not in prompts[0]
    assert '"evidence_id": "E1"' in prompts[0]
    assert result.issues[0].evidence_ids == [media_scoped.evidence_id]
    assert result.draft_id == document.draft_id


def test_orchestrate_drafts_인식_결과는_재생성해도_한_번만_만든다(monkeypatch) -> None:
    loads: list[object] = []
    decisions = iter([contracts.Decision.REGENERATE, contracts.Decision.PASS])

    def _load(bundle):
        loads.append(bundle)
        return object()

    _patch_orchestrate(monkeypatch, lambda inputs, **kwargs: _generated(), [])
    monkeypatch.setattr(service, "_load_generation_inputs", _load)
    monkeypatch.setattr(
        service,
        "_verify_with_critic_retry",
        lambda *args: contracts.DecisionResult(decision=next(decisions), reason="t"),
    )
    monkeypatch.setattr(service, "_save_passed_draft", lambda *args: None)

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert len(loads) == 1
