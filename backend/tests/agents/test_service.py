import os
import uuid
from datetime import datetime, timezone

# Test collection must not depend on a developer's .env or running PostgreSQL.
os.environ.setdefault("POSTGRES_PASSWORD", "test-only-password")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-only-key")

from domains.agents import service  # noqa: E402


class FakeSession:
    def __init__(self) -> None:
        self.added: list[object] = []
        self.committed = False

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True

    def __enter__(self) -> "FakeSession":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


def _sentence(**overrides: object) -> service.GeneratedSentence:
    base: service.GeneratedSentence = {
        "draft_id": str(uuid.uuid4()),
        "sentence_index": 0,
        "source_media_id": str(uuid.uuid4()),
        "source_timestamp": 1.5,
        "source_text": "CHILD_A가 블록 놀이를 했습니다.",
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def test_verify_and_record_passes_when_all_sentences_have_evidence() -> None:
    session = FakeSession()
    sentences = [_sentence(sentence_index=0), _sentence(sentence_index=1)]

    assert service._verify_and_record(session, sentences) is True
    assert session.committed
    results = [obj for obj in session.added if isinstance(obj, service.VerificationResult)]
    assert len(results) == 2
    assert all(result.result is True for result in results)


def test_verify_and_record_fails_when_a_sentence_has_no_evidence_ref() -> None:
    session = FakeSession()
    sentences = [_sentence(source_media_id="")]

    assert service._verify_and_record(session, sentences) is False
    results = [obj for obj in session.added if isinstance(obj, service.VerificationResult)]
    assert results[0].result is False
    assert results[0].check_type == "missing_evidence_ref"


def test_verify_and_record_fails_on_empty_draft() -> None:
    assert service._verify_and_record(FakeSession(), []) is False


def _fake_job(**overrides: object) -> service.Job:
    job = service.Job(target_date=datetime(2026, 9, 16, tzinfo=timezone.utc))
    for key, value in overrides.items():
        setattr(job, key, value)
    return job


def test_orchestrate_drafts_falls_back_to_unclassified_after_max_attempts(monkeypatch) -> None:
    unclassified_calls: list[tuple[str, str]] = []

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(service, "_collect_evidence", lambda session, child_id, target_date: object())
    monkeypatch.setattr(service, "_generate_draft", lambda bundle: [_sentence(source_media_id="")])
    monkeypatch.setattr(
        service,
        "_send_to_unclassified",
        lambda session, job_id, child_id: unclassified_calls.append((job_id, child_id)),
    )

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")

    assert unclassified_calls == [("job-1", "child-1")]


def test_orchestrate_drafts_returns_early_on_success(monkeypatch) -> None:
    def _fail_if_called(*args: object, **kwargs: object) -> None:
        raise AssertionError("should not fall back to unclassified on success")

    monkeypatch.setattr(service, "SessionLocal", FakeSession)
    monkeypatch.setattr(service, "_get_job", lambda session, job_id: _fake_job())
    monkeypatch.setattr(service, "_collect_evidence", lambda session, child_id, target_date: object())
    monkeypatch.setattr(service, "_generate_draft", lambda bundle: [_sentence()])
    monkeypatch.setattr(service, "_send_to_unclassified", _fail_if_called)

    service.orchestrate_drafts(job_id="job-1", child_id="child-1")


def test_get_job_raises_when_missing(monkeypatch) -> None:
    session = FakeSession()
    session.get = lambda model, job_id: None  # type: ignore[method-assign]

    try:
        service._get_job(session, "missing-job")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for missing job")
