"""API→worker→관찰일지→교사 승인까지. 모델 응답만 고정하는 통합 검증."""

import json
import os
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from domains.agents import service
from domains.agents.models import EvidenceBundle, Job, SentenceEvidence
from domains.documents.models import DraftDocument
from scripts.seed_photo_demo import PARENT_EMAILS, TEACHER_EMAIL
from tests.agents.fixtures.native_agent import native_fixture
from tests.agents.test_photo_pipeline import (
    Flow,
    login,
    photo,
    run,
)
from tests.agents.test_photo_pipeline import (
    flow as flow,  # noqa: PLC0414 -- pytest fixture export
)


def published_note(flow: Flow) -> str:
    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    status = run(client, klass, photo(factory, klass, [children[0]]), pending)
    draft = status["children"][0]["drafts"][0]["draft_id"]
    approved = client.post(
        f"/api/v1/drafts/{draft}/approve", json={"expected_version": 1, "reviewed": True}
    )
    assert approved.status_code == 200, approved.text
    published = client.post(
        "/api/v1/publications",
        json={
            "request_id": str(uuid4()),
            "include_photos": False,
            "items": [{"draft_id": draft, "expected_version": approved.json()["version"]}],
        },
    )
    assert published.status_code == 200, published.text
    pending.clear()
    return draft


def test_월별_관찰일지는_게시본을_조회하고_원본근거와_영역을_저장한다(flow, monkeypatch):
    note = published_note(flow)
    client, factory, _, children, pending, _calls = flow
    captured = []

    def writer(prompt):
        captured.append(prompt)
        return json.dumps(
            {
                "sentences": [
                    {
                        "section": "자연탐구",
                        "text": "CHILD_A가 블록을 쌓았다.",
                        "evidence_refs": ["E1"],
                    }
                ]
            }
        )

    monkeypatch.setattr(service, "call_agent", native_fixture(writer))
    request_id = str(uuid4())
    url = f"/api/v1/children/{children[0]}/observation-jobs"
    started = client.post(url, json={"request_id": request_id, "month": "2026-10"})
    assert started.status_code == 202, started.text
    duplicate = client.post(url, json={"request_id": request_id, "month": "2026-10"})
    assert duplicate.json()["job_id"] == started.json()["job_id"]
    assert len(pending) == 1
    job_id, child_id = pending[0]
    service.orchestrate_drafts(str(job_id), str(child_id))
    status = client.get(started.headers["Location"]).json()
    assert status["status"] == "succeeded", status
    ref = status["children"][0]["drafts"][0]
    assert ref["doc_type"] == "observation_log"
    detail = client.get(f"/api/v1/drafts/{ref['draft_id']}").json()
    assert detail["record_date"] == "2026-10-01"
    assert detail["status"] == "verified"
    assert detail["sentences"][0]["section"] == "자연탐구"
    assert detail["sentences"][0]["evidences"][0]["source_type"] == "parent_note"
    assert detail["sentences"][0]["evidences"][0]["source_document_id"] == note
    assert "김도윤" not in captured[0] and note not in captured[0]
    trace = client.get(started.headers["Location"] + "/trace")
    assert trace.status_code == 200
    events = trace.json()["children"][0]["events"]
    assert {e["tool"] for e in events if e["tool"]} == {"domain_style", "developmental_guideline"}
    assert {e["agent"] for e in events} == {"collector", "observation", "critic"}
    with factory() as db:
        assert db.get(Job, job_id).stage == "verifying"
        draft = db.get(DraftDocument, UUID(ref["draft_id"]))
        assert db.get(EvidenceBundle, draft.evidence_bundle_id).daily_routine
        assert db.scalar(
            select(SentenceEvidence).where(SentenceEvidence.draft_id == draft.id)
        ).source_document_id == UUID(note)
    approved = client.post(
        f"/api/v1/drafts/{ref['draft_id']}/approve",
        json={"expected_version": detail["version"], "reviewed": True},
    )
    assert approved.status_code == 200
    login(client, PARENT_EMAILS[0])
    assert client.get(f"/api/v1/drafts/{ref['draft_id']}").status_code == 403
    assert client.get(started.headers["Location"] + "/trace").status_code == 403
    assert (
        client.post(url, json={"request_id": str(uuid4()), "month": "2026-10"}).status_code == 403
    )


def test_게시본이_없는_월은_실행하지_않는다(flow):
    client, _, _, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    response = client.post(
        f"/api/v1/children/{children[0]}/observation-jobs",
        json={"request_id": str(uuid4()), "month": "2026-09"},
    )
    assert response.status_code == 409, response.text
    assert not pending


def test_생성중_회수되거나_변경된_알림장은_저장전에_거절한다(flow, monkeypatch):
    published_note(flow)
    _client, factory, _, children, _, _ = flow
    with factory() as db:
        from datetime import datetime

        bundle = EvidenceBundle(
            child_id=children[0],
            date=datetime(2026, 10, 1, tzinfo=UTC),
            media_refs=[],
            transcript_refs=[],
            context_lookup={},
        )
        db.add(bundle)
        db.commit()
        inputs = service._load_monthly_inputs(db, bundle)
        monkeypatch.setattr(
            service.documents, "published_records_for_agents", lambda *args, **kwargs: []
        )
        with pytest.raises(service.AgentExecutionError, match="AGENT_SOURCE_CHANGED"):
            service._ensure_monthly_sources_current(db, inputs)


def test_월별_조회는_회수본과_미게시본을_포함하지_않는다(flow):
    note = published_note(flow)
    _client, factory, _, children, _, _ = flow
    # 조회 서비스의 게시 상태 필터를 직접 검증한다.
    with factory() as db:
        records = service.documents.published_records_for_agents(
            db, child_id=children[0], start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)
        )
        assert [str(r.document_id) for r in records] == [note]
        assert (
            service.documents.published_records_for_agents(
                db, child_id=children[1], start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)
            )
            == []
        )
        draft = db.get(DraftDocument, UUID(note))
        draft.status = "revoked"
        db.commit()
        assert (
            service.documents.published_records_for_agents(
                db, child_id=children[0], start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)
            )
            == []
        )


def test_요약형식_실패는_상한후_확인필요로_끝난다(flow, monkeypatch):
    from openai.types.chat import ChatCompletionMessage

    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    calls = []

    def invalid(*args):
        calls.append(1)
        return ChatCompletionMessage(role="assistant", content="not-json")

    monkeypatch.setattr(service, "call_agent", invalid)
    result = run(client, klass, photo(factory, klass, [children[0]]), pending)
    assert len(calls) == 3
    assert result["status"] == "succeeded"
    assert result["children"][0]["outcome"] == "unclassified"
    assert result["children"][0]["unclassified_reason"] == "verification_failed"
    assert result["children"][0]["drafts"] == []


def test_하루일과는_반이_바뀌어도_다른원아_이름으로_복원하지_않는다(flow, monkeypatch):
    from datetime import datetime

    _, factory, _, children, _, _ = flow
    with factory() as db:
        bundle = EvidenceBundle(
            child_id=children[0],
            date=datetime(2026, 10, 30, tzinfo=UTC),
            media_refs=[],
            transcript_refs=[],
            context_lookup={},
            daily_routine={
                "facts": [{"text": "CHILD_A는 CHILD_B와 블록을 쌓았다.", "evidence_refs": ["E1"]}]
            },
        )
        db.add(bundle)
        db.commit()
        monkeypatch.setattr(
            service.organization_service,
            "get_class_child_names",
            lambda *args: {children[0]: ["가나"], children[1]: ["새친구"]},
        )
        routine = service.get_daily_routine(db, bundle.id)
        assert routine == ["가나는 친구와 블록을 쌓았다."]


def test_수집에이전트의_DB도구는_원아_ID나_실명을_모델에_보내지_않는다(flow, monkeypatch):
    from openai.types.chat import ChatCompletionMessage

    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    original = native_fixture(lambda prompt: service.call_claude(prompt))
    tool_results = []

    def respond(messages, tools):
        names = [tool["function"]["name"] for tool in tools]
        if "child_roster" in names:
            results = [message["content"] for message in messages if message["role"] == "tool"]
            if not results:
                return ChatCompletionMessage.model_validate(
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "id": name,
                                "type": "function",
                                "function": {"name": name, "arguments": "{}"},
                            }
                            for name in names
                        ],
                    }
                )
            tool_results.extend(results)
        return original(messages, tools)

    monkeypatch.setattr(service, "call_agent", respond)
    status = run(client, klass, photo(factory, klass, [children[0]]), pending)
    assert status["children"][0]["outcome"] == "drafted"
    assert len(tool_results) == 3
    serialized = " ".join(tool_results)
    assert "CHILD_A" in serialized
    assert all(str(child) not in serialized for child in children)
    assert "김도윤" not in serialized


@pytest.mark.parametrize("role", ["collector", "parent_note"])
@pytest.mark.parametrize("always", [False, True])
def test_출력한도_초과는_짧게_재시도하고_계속_실패하면_상한에서_끝난다(
    flow, monkeypatch, role, always
):
    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    original = native_fixture(lambda prompt: service.call_claude(prompt))
    attempts = []

    def respond(messages, tools):
        is_collector = tools[0]["function"]["name"] == "activity_plan"
        target = is_collector if role == "collector" else not is_collector
        if target and (is_collector or any(m["role"] == "tool" for m in messages)):
            attempts.append(messages[0]["content"])
            if always or len(attempts) == 1:
                raise service.AgentResponseTruncated("AGENT_OUTPUT_TRUNCATED")
        return original(messages, tools)

    monkeypatch.setattr(service, "call_agent", respond)
    status = run(client, klass, photo(factory, klass, [children[0]]), pending)
    assert len(attempts) == (3 if always else 2)
    assert "줄이" in attempts[1] or "줄여" in attempts[1]
    assert status["status"] == "succeeded"
    assert status["children"][0]["outcome"] == ("unclassified" if always else "drafted")


def test_새_request_id로_같은_월을_요청해도_진행중인_작업을_이어받는다(flow):
    published_note(flow)
    client, factory, _, children, pending, _ = flow
    url = f"/api/v1/children/{children[0]}/observation-jobs"
    first = client.post(url, json={"request_id": str(uuid4()), "month": "2026-10"})
    second = client.post(url, json={"request_id": str(uuid4()), "month": "2026-10"})
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"]
    assert len(pending) == 1
    with factory() as db:
        job = db.get(Job, pending[0][0])
        job.status = "failed"
        db.commit()
    third = client.post(url, json={"request_id": str(uuid4()), "month": "2026-10"})
    assert third.status_code == 202
    assert third.json()["job_id"] != first.json()["job_id"]
    assert len(pending) == 2


def test_게시본_문장을_두번의_조회로_날짜와_문장순서대로_가져온다(flow):
    from sqlalchemy import event

    from domains.documents.models import DocumentPublication, DraftSentence

    first = published_note(flow)
    _, factory, _, children, _, _ = flow
    with factory() as db:
        source = db.get(DraftDocument, UUID(first))
        source.record_date = date(2026, 10, 1)
        for day in range(2, 5):
            draft = DraftDocument(
                child_id=children[0],
                doc_type="parent_note",
                record_date=date(2026, 10, day),
                version=1,
                status="approved",
                author_teacher_id=source.author_teacher_id,
            )
            db.add(draft)
            db.flush()
            db.add(
                DocumentPublication(
                    draft_id=draft.id,
                    include_photos=False,
                    round_number=1,
                    publish_request_id=str(uuid4()),
                    published_version=1,
                    revoke_deadline=datetime.now(UTC) + timedelta(days=1),
                )
            )
            for position in [2, 1]:
                db.add(
                    DraftSentence(
                        draft_id=draft.id,
                        sentence_id=f"s{position}",
                        position=position,
                        text=f"문장{position}",
                    )
                )
        db.commit()
        queries = []
        engine = db.get_bind()

        def count(conn, cursor, statement, parameters, context, executemany):
            queries.append(statement)

        event.listen(engine, "before_cursor_execute", count)
        try:
            records = service.documents.published_records_for_agents(
                db, child_id=children[0], start_date=date(2026, 10, 1), end_date=date(2026, 10, 31)
            )
        finally:
            event.remove(engine, "before_cursor_execute", count)
        assert len(queries) == 2
        assert [r.record_date.day for r in records] == [1, 2, 3, 4]
        assert records[1].text == "문장1\n문장2"


@pytest.mark.skipif(
    not os.environ.get("PHOTO_PIPELINE_TEST_DATABASE_URL"), reason="PostgreSQL row locks required"
)
def test_서로다른_요청_ID로_동시에_생성해도_월별_작업은_하나다(flow):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event

    from domains.agents.models import GenerationJob
    from domains.organization.models import Klass

    published_note(flow)
    _, factory, class_id, children, _, _ = flow
    with factory() as db:
        klass = db.get(Klass, class_id)
        teacher_id, center_id = klass.teacher_id, klass.center_id
    barrier = Barrier(2)

    def start(index):
        with factory() as db:
            barrier.wait(timeout=10)
            result = service.start_observation_job(
                db,
                child_id=children[0],
                month=date(2026, 10, 1),
                request_id=uuid4(),
                teacher_id=teacher_id,
                center_id=center_id,
            )
            # 아직 커밋 안 된 새 작업을 다른 요청이 볼 수 없는 구간을 겹친다.
            Event().wait(0.05)
            db.commit()
            return result.status.generation_job.id, len(result.to_enqueue)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(start, [0, 1]))
    assert results[0][0] == results[1][0]
    assert sum(count for _, count in results) == 1
    with factory() as db:
        assert (
            len(
                db.scalars(
                    select(GenerationJob).where(GenerationJob.doc_type == "observation_log")
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize("protection", [None, "edit", "approve", "concurrent_edit"])
def test_월별_재생성도_257의_버전보호를_따른다(flow, monkeypatch, protection):
    note = published_note(flow)
    client, factory, _, children, pending, _ = flow
    # 월 1일의 게시 알림장이 있어도 관찰일지와 혼동하지 않는다.
    with factory() as db:
        db.get(DraftDocument, UUID(note)).record_date = date(2026, 10, 1)
        db.commit()
    monkeypatch.setattr(
        service,
        "call_agent",
        native_fixture(
            lambda prompt: json.dumps(
                {
                    "sentences": [
                        {
                            "section": "자연탐구",
                            "text": "CHILD_A가 블록을 쌓았다.",
                            "evidence_refs": ["E1"],
                        }
                    ]
                }
            )
        ),
    )

    def generate():
        response = client.post(
            f"/api/v1/children/{children[0]}/observation-jobs",
            json={"request_id": str(uuid4()), "month": "2026-10"},
        )
        assert response.status_code == 202, response.text
        job_id, child_id = pending[-1]
        service.orchestrate_drafts(str(job_id), str(child_id))
        return client.get(response.headers["Location"]).json()

    first = generate()
    assert first["status"] == "succeeded", first
    draft_id = first["children"][0]["drafts"][0]["draft_id"]
    before = client.get(f"/api/v1/drafts/{draft_id}").json()

    def edit():
        response = client.patch(
            f"/api/v1/drafts/{draft_id}",
            json={
                "expected_version": before["version"],
                "sentences": [{"sentence_id": "s1", "text": "교사가 수정한 관찰 내용입니다."}],
            },
        )
        assert response.status_code == 200, response.text

    if protection == "edit":
        edit()
    elif protection == "approve":
        response = client.post(
            f"/api/v1/drafts/{draft_id}/approve",
            json={
                "expected_version": before["version"],
                "reviewed": True,
            },
        )
        assert response.status_code == 200, response.text
    elif protection == "concurrent_edit":
        original = service._generate_draft

        def generate_and_edit(*args, **kwargs):
            result = original(*args, **kwargs)
            edit()
            return result

        monkeypatch.setattr(service, "_generate_draft", generate_and_edit)
    if protection in {"edit", "approve"}:
        monkeypatch.setattr(
            service, "call_agent", lambda *a: pytest.fail("보호 문서는 AI 호출 금지")
        )

    result = generate()
    after = client.get(f"/api/v1/drafts/{draft_id}").json()
    if protection:
        assert result["status"] == "failed", result
        assert result["children"][0]["error_code"] == "DRAFT_VERSION_CONFLICT"
        assert result["children"][0]["drafts"] == []
        if protection != "approve":
            assert after["sentences"][0]["text"] == "교사가 수정한 관찰 내용입니다."
        else:
            assert after["status"] == "approved"
    else:
        assert result["status"] == "succeeded", result
        assert result["children"][0]["drafts"][0]["draft_id"] == draft_id
        assert after["version"] == before["version"] + 1
        with factory() as db:
            evidence = db.scalars(
                select(SentenceEvidence).where(SentenceEvidence.draft_id == UUID(draft_id))
            ).all()
            assert len(evidence) == 1
            assert evidence[0].source_document_id == UUID(note)
