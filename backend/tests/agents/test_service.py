import json
import os
from datetime import UTC, datetime
from typing import Self

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

from domains.agents import service
from tests.agents.fixtures.evidence import EVIDENCE_BY_ID, EVIDENCE_CHILD_A, RECORD_DATE
from tools import contracts


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


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
                "evidence_ids": ["ev_001"],
            }
        ]
    )


def test_verify_and_record_모든_검증을_통과하면_PASS를_반환하고_근거를_남긴다(
    monkeypatch,
) -> None:
    session = FakeSession()
    monkeypatch.setattr(service, "call_claude", lambda prompt: _critic_response())

    result = service._verify_and_record(
        session, _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.PASS
    assert session.committed

    sentence_rows = [
        obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)
    ]
    assert len(sentence_rows) == 1
    assert sentence_rows[0].evidence_id == "ev_001"
    assert sentence_rows[0].source_media_id == EVIDENCE_CHILD_A.media_id
    assert sentence_rows[0].source_timestamp == EVIDENCE_CHILD_A.start_ms / 1000
    assert sentence_rows[0].source_text == EVIDENCE_CHILD_A.text

    issue_rows = [
        obj for obj in session.added if isinstance(obj, service.VerificationResultRow)
    ]
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

    decision_rows = [
        obj for obj in session.added if isinstance(obj, service.DraftDecisionLog)
    ]
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
    result = service._verify_and_record(
        session, document, EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.REGENERATE

    issue_rows = [
        obj for obj in session.added if isinstance(obj, service.VerificationResultRow)
    ]
    assert len(issue_rows) == 1
    assert (
        issue_rows[0].check_type
        == contracts.VerificationCheckType.INVALID_EVIDENCE_REF.value
    )
    assert issue_rows[0].sentence_index == 0

    sentence_rows = [
        obj for obj in session.added if isinstance(obj, service.SentenceEvidenceRow)
    ]
    assert sentence_rows == []  # 실패한 시도는 근거를 남기지 않는다


def test_verify_and_record_재생성_상한에_도달하면_교사_확인으로_보낸다(
    monkeypatch,
) -> None:
    session = FakeSession()

    def _fail_if_called(prompt: str) -> str:
        raise AssertionError("코드 검증 실패 시 Critic을 호출하면 안 된다")

    monkeypatch.setattr(service, "call_claude", _fail_if_called)

    document = _document(evidence_ids=("ev_999",))
    result = service._verify_and_record(
        session, document, EVIDENCE_BY_ID, _request(), 2
    )

    assert result.decision == contracts.Decision.NEEDS_TEACHER_REVIEW


def test_verify_and_record_critic_응답이_JSON이_아니면_RETRY_CRITIC을_반환한다(
    monkeypatch,
) -> None:
    session = FakeSession()
    monkeypatch.setattr(service, "call_claude", lambda prompt: "이건 JSON이 아닙니다")

    result = service._verify_and_record(
        session, _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.RETRY_CRITIC


def test_verify_with_critic_retry_한번_재시도_후_통과하면_그대로_반환한다(
    monkeypatch,
) -> None:
    decisions = iter([contracts.Decision.RETRY_CRITIC, contracts.Decision.PASS])

    def _fake_verify(
        session, document, evidence_by_id, request, regeneration_count, **kwargs
    ):
        return contracts.DecisionResult(decision=next(decisions), reason="테스트")

    monkeypatch.setattr(service, "_verify_and_record", _fake_verify)

    result = service._verify_with_critic_retry(
        FakeSession(), _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.PASS


def test_verify_with_critic_retry_상한을_넘기면_재생성으로_넘긴다(monkeypatch) -> None:
    calls = 0

    def _always_retry_critic(
        session, document, evidence_by_id, request, regeneration_count, **kwargs
    ):
        nonlocal calls
        calls += 1
        return contracts.DecisionResult(
            decision=contracts.Decision.RETRY_CRITIC, reason="테스트"
        )

    monkeypatch.setattr(service, "_verify_and_record", _always_retry_critic)

    result = service._verify_with_critic_retry(
        FakeSession(), _document(), EVIDENCE_BY_ID, _request(), 0
    )

    assert result.decision == contracts.Decision.REGENERATE
    assert calls == service.MAX_CRITIC_RETRIES + 1


def _fake_job(**overrides: object) -> service.Job:
    job = service.Job(target_date=datetime(2026, 9, 16, tzinfo=UTC))
    for key, value in overrides.items():
        setattr(job, key, value)
    return job


def test_orchestrate_drafts_성공하면_미분류함으로_보내지_않는다(monkeypatch) -> None:
    def _fail_if_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("성공했는데 미분류함으로 보내면 안 된다")

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(
        service,
        "_generate_draft",
        lambda bundle, *, previous_draft_id: (_document(), EVIDENCE_BY_ID, _request()),
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
        lambda bundle, *, previous_draft_id: (_document(), EVIDENCE_BY_ID, _request()),
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


def test_orchestrate_drafts_재생성하면_이전_draft_id를_다시_넘기고_횟수를_늘린다(
    monkeypatch,
) -> None:
    generate_calls: list[str | None] = []
    verify_calls: list[int] = []
    documents: list[contracts.DraftDocument] = []
    decisions = iter([contracts.Decision.REGENERATE, contracts.Decision.PASS])

    def _fake_generate(bundle, *, previous_draft_id):
        generate_calls.append(previous_draft_id)
        document = _document()
        documents.append(document)
        return document, EVIDENCE_BY_ID, _request()

    def _fake_verify(session, document, evidence_by_id, request, regeneration_count):
        verify_calls.append(regeneration_count)
        return contracts.DecisionResult(decision=next(decisions), reason="테스트")

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(
        service, "_collect_evidence", lambda session, child_id, target_date: object()
    )
    monkeypatch.setattr(service, "_generate_draft", _fake_generate)
    monkeypatch.setattr(service, "_verify_with_critic_retry", _fake_verify)
    monkeypatch.setattr(
        service,
        "_send_to_unclassified",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("재생성 성공 후엔 안 불러야 함")
        ),
    )

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert generate_calls == [None, documents[0].draft_id]
    assert verify_calls == [0, 1]


def test_get_job_raises_when_missing(monkeypatch) -> None:
    session = FakeSession()
    session.get = lambda model, job_id: None  # type: ignore[method-assign]

    try:
        service._get_job(session, "missing-job")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for missing job")
