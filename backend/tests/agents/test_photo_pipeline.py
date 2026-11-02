"""실제 DB·로그인·동의·생성·검증·게시·학부모 조회 연결 검증(H-1~H-4).

외부 AI·S3 응답만 고정합니다. 프롬프트, 파서, 저장, 권한 게이트는 실제 구현입니다.
"""

import json
import os
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, DropSchema

from core.base import Base
from core.database import get_db
from domains.agents import router, service
from domains.agents.models import Job
from domains.documents.models import DraftDocument, UnclassifiedItem
from domains.media.models import MediaAsset, MediaChildLink
from domains.media.service import PresignedUpload, SignedMediaUrl, StoredObject
from domains.organization.models import Klass
from main import app
from scripts.seed_photo_demo import PARENT_EMAILS, TEACHER_EMAIL, seed

DAY = date(2026, 10, 30)
PASSWORD = "photo-test-password-only"
Flow = tuple[
    TestClient,
    sessionmaker[Session],
    UUID,
    list[UUID],
    list[tuple[UUID, UUID]],
    list[tuple[str, str]],
]


@pytest.fixture
def flow(monkeypatch: pytest.MonkeyPatch) -> Iterator[Flow]:
    database_url = os.environ.get("PHOTO_PIPELINE_TEST_DATABASE_URL")
    schema = f"photo_test_{uuid4().hex}"
    if database_url:
        url = make_url(database_url)
        if url.host not in {"localhost", "127.0.0.1"} or url.database != "photo_integration":
            raise ValueError("Use only the local photo_integration test database")
        engine = create_engine(url, hide_parameters=True)
        with engine.begin() as conn:
            conn.execute(CreateSchema(schema))
        engine = engine.execution_options(schema_translate_map={None: schema})
    else:
        # Python 3.12 SQLite의 legacy transaction은 SAVEPOINT 해제를 커밋할 수 있다.
        # 운영 PostgreSQL처럼 바깥 트랜잭션의 rollback이 중첩 저장에도 적용되게 한다.
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False, "autocommit": False},
            poolclass=StaticPool,
        )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    with factory() as db:
        klass, children = seed(db, teacher_password=PASSWORD, parent_password=PASSWORD)
        db.commit()

    def database() -> Iterator[Session]:
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(service, "SessionLocal", factory)
    pending: list[tuple[UUID, UUID]] = []
    monkeypatch.setattr(router, "enqueue_generate_drafts", pending.extend)
    # 외부 S3만 고정하고 URL 발급 기록·완료 통지·귀속 저장은 실제 API를 거친다.
    monkeypatch.setattr(
        service.media_service,
        "presign_upload",
        lambda key, content_type, size_bytes: PresignedUpload(
            url=f"https://example.invalid/{key}",
            headers={"Content-Type": content_type},
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        ),
    )
    monkeypatch.setattr(
        service.media_service,
        "head_uploaded_object",
        lambda key: StoredObject(size_bytes=500, content_type="image/jpeg"),
    )
    monkeypatch.setattr(
        service.media_service, "_read_object_head", lambda key: b"\xff\xd8\xff\xe0" + bytes(60)
    )
    monkeypatch.setattr(
        service.media_service,
        "get_signed_urls",
        lambda db, ids: [
            SignedMediaUrl(
                media_id=i,
                type="photo",
                url=f"https://example.invalid/{i}.png",
                url_expires_at=datetime.now(UTC) + timedelta(minutes=5),
            )
            for i in ids
        ],
    )
    calls: list[tuple[str, str]] = []

    def vision(prompt: str, images: list[str]) -> str:
        calls.append(("vision", prompt))
        return json.dumps(
            [
                {
                    "ref": "P1",
                    "observations": [{"text": "블록을 쌓고 있다.", "scope": "individual"}],
                    "no_observation_reason": None,
                }
            ]
        )

    def llm(prompt: str) -> str:
        calls.append(("llm", prompt))
        if '"sentence_id"' in prompt:
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
        return json.dumps(
            {
                "sentences": [
                    {"text": "CHILD_A는 블록을 쌓으며 놀이했어요.", "evidence_refs": ["E1"]}
                ]
            }
        )

    monkeypatch.setattr(service, "call_vision", vision)
    monkeypatch.setattr(service, "call_claude", llm)
    try:
        with TestClient(app, base_url="https://testserver") as client:
            yield client, factory, klass, children, pending, calls
    finally:
        app.dependency_overrides.clear()
        if database_url:
            Base.metadata.drop_all(engine)
            with engine.begin() as conn:
                conn.execute(DropSchema(schema))
        engine.dispose()


def login(client: TestClient, email: str) -> None:
    response = client.post("/api/v1/sessions", json={"email": email, "password": PASSWORD})
    assert response.status_code == 201


def photo(
    factory: sessionmaker[Session], klass: UUID, children: list[UUID], *, allowed: bool = True
) -> UUID:
    with factory() as db:
        row = MediaAsset(
            id=uuid4(),
            client_photo_id=uuid4(),
            class_id=klass,
            teacher_id=db.get(Klass, klass).teacher_id,
            type="photo",
            captured_at=datetime(2026, 10, 30, 3, tzinfo=UTC),
            storage_url="s3://synthetic/test.png",
            size_bytes=500,
            llm_allowed=allowed,
            attributed_at=datetime.now(UTC),
        )
        db.add(row)
        db.flush()
        for child in children:
            db.add(MediaChildLink(media_id=row.id, child_id=child, method="manual"))
        db.commit()
        return row.id


def run(
    client: TestClient, klass: UUID, media: UUID, pending: list[tuple[UUID, UUID]]
) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/classes/{klass}/jobs",
        json={"record_date": str(DAY), "request_id": str(uuid4()), "media_ids": [str(media)]},
    )
    assert response.status_code == 202, response.text
    for job, child in pending:
        service.orchestrate_drafts(str(job), str(child))
    status = client.get(f"/api/v1/jobs/{response.json()['job_id']}")
    assert status.status_code == 200
    return status.json()


def test_사진부터_교사_검토_게시_자녀_열람까지(flow: Flow) -> None:
    client, _factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    client_photo = str(uuid4())
    issued = client.post(
        "/api/v1/media/upload-urls",
        json={
            "class_id": str(klass),
            "items": [
                {
                    "client_photo_id": client_photo,
                    "type": "photo",
                    "content_type": "image/jpeg",
                    "size_bytes": 500,
                }
            ],
        },
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["items"][0]["status"] == "issued"
    completed = client.post(
        "/api/v1/media",
        json={
            "client_photo_id": client_photo,
            "class_id": str(klass),
            "type": "photo",
            "captured_at": "2026-10-30T03:00:00Z",
            "model_version": "human-test",
            "llm_allowed": True,
            "child_links": [
                {"child_id": str(children[0]), "method": "manual", "confidence_score": None}
            ],
        },
    )
    assert completed.status_code == 201, completed.text
    media = UUID(completed.json()["media_id"])
    status = run(client, klass, media, pending)
    assert status["status"] == "succeeded"
    draft = status["children"][0]["drafts"][0]["draft_id"]
    detail = client.get(f"/api/v1/drafts/{draft}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["sentences"][0]["evidences"]
    assert detail.json()["author_name"] == "시연 교사"
    assert [kind for kind, _ in calls] == ["vision", "llm", "llm"]
    assert all("김도윤" not in prompt for _, prompt in calls)
    login(client, PARENT_EMAILS[0])
    assert client.get(f"/api/v1/parent-notes/{draft}").status_code == 404
    login(client, TEACHER_EMAIL)
    edited = client.patch(
        f"/api/v1/drafts/{draft}",
        json={
            "expected_version": detail.json()["version"],
            "sentences": [{"sentence_id": "s1", "text": "블록으로 탑을 만들었어요."}],
        },
    )
    assert edited.status_code == 200, edited.text
    approved = client.post(
        f"/api/v1/drafts/{draft}/approve",
        json={"expected_version": edited.json()["version"], "reviewed": True},
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
    login(client, PARENT_EMAILS[0])
    note = client.get(f"/api/v1/parent-notes/{draft}")
    assert note.status_code == 200, note.text
    assert note.json()["content"] == "블록으로 탑을 만들었어요."
    login(client, PARENT_EMAILS[1])
    assert client.get(f"/api/v1/parent-notes/{draft}").status_code == 404


@pytest.mark.parametrize("denied_child,allowed", [(True, True), (False, False)])
def test_미동의_또는_미식별_사진은_AI를_한번도_부르지_않는다(
    flow: Flow, denied_child: bool, allowed: bool
) -> None:
    client, factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    assigned = [children[0], children[3]] if denied_child else [children[0]]
    media = photo(factory, klass, assigned, allowed=allowed)
    status = run(client, klass, media, pending)
    assert status["status"] == "succeeded"
    assert all(c["outcome"] == "unclassified" for c in status["children"])
    assert calls == []
    with factory() as db:
        assert db.scalar(select(DraftDocument)) is None
        assert len(db.scalars(select(UnclassifiedItem)).all()) == len(assigned)


def test_멈춘_worker는_폴링에서_실패로_끝나고_늦은_성공이_복원하지_못한다(flow: Flow) -> None:
    client, factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    media = photo(factory, klass, [children[0]])
    response = client.post(
        f"/api/v1/classes/{klass}/jobs",
        json={"record_date": str(DAY), "request_id": str(uuid4()), "media_ids": [str(media)]},
    )
    with factory() as db:
        job = db.get(Job, pending[0][0])
        job.status = "running"
        job.updated_at = datetime.now(UTC) - timedelta(minutes=11)
        db.commit()
    status = client.get(f"/api/v1/jobs/{response.json()['job_id']}").json()
    assert status["status"] == "failed"
    assert status["children"][0]["error_code"] == "LLM_TIMEOUT"
    service.orchestrate_drafts(str(pending[0][0]), str(children[0]))
    assert calls == []
    with factory() as db:
        assert db.get(Job, pending[0][0]).status == "failed"


def test_미동의_사유가_작업과_미분류에_남는다(flow: Flow) -> None:
    client, factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    status = run(client, klass, photo(factory, klass, [children[3]]), pending)
    assert status["children"][0]["unclassified_reason"] == "no_consent"
    assert calls == []
    with factory() as db:
        assert db.scalar(select(UnclassifiedItem)).reason == "no_consent"


def test_모든_사진의_응답형식_실패는_사진분석실패로_끝난다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory, klass, children, pending, calls = flow
    monkeypatch.setattr(service, "call_vision", lambda *_: "invalid json")
    login(client, TEACHER_EMAIL)
    media = photo(factory, klass, [children[0]])
    status = run(client, klass, media, pending)
    assert status["status"] == "succeeded"
    assert status["children"][0]["unclassified_reason"] == "photo_analysis_failed"
    assert calls == []  # 문장 생성·Critic은 호출하지 않는다.
    with factory() as db:
        assert db.scalar(select(UnclassifiedItem)).reason == "photo_analysis_failed"
        assert db.scalar(select(DraftDocument)) is None
        assert db.scalar(select(service.EvidenceBundle)).failed_photo_ids == [str(media)]


def test_일부_사진_실패는_교사_초안에_보이고_문장근거에는_들어가지_않는다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory, klass, children, pending, _calls = flow
    good = photo(factory, klass, [children[0]])
    bad = photo(factory, klass, [children[0]])
    vision = service.call_vision

    def sometimes_invalid(prompt: str, images: list[str]) -> str:
        return "invalid json" if str(bad) in images[0] else vision(prompt, images)

    monkeypatch.setattr(service, "call_vision", sometimes_invalid)
    login(client, TEACHER_EMAIL)
    status = run(client, klass, good, pending)
    draft = status["children"][0]["drafts"][0]["draft_id"]
    detail = client.get(f"/api/v1/drafts/{draft}").json()
    assert detail["failed_media_ids"] == [str(bad)]
    assert str(bad) in [m["media_id"] for m in detail["media"]]
    assert str(bad) not in detail["selected_media_ids"]
    assert all(e["media_id"] != str(bad) for s in detail["sentences"] for e in s["evidences"])
    # 제외 안내를 추가한 뒤에도 부모에게 교사용 초안은 노출되지 않는다.
    login(client, PARENT_EMAILS[0])
    assert client.get(f"/api/v1/drafts/{draft}").status_code == 403


def test_실행_중_실패한_worker의_늦은_초안과_문장근거를_롤백한다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    from domains.agents.models import DraftDecisionLog, EvidenceBundle, SentenceEvidence
    from domains.documents.models import DraftSentence

    client, factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    collect = service._collect_evidence

    def fail_after_worker_started(session: Session, child_id: str, target_date: datetime):
        # worker가 running을 커밋하고 job 객체를 읽은 이후, 다른 세션에서 실패를 확정한다.
        # worker 메모리의 running 값은 그대로여서 뒤의 저장·조건부 커밋을 실제로 실행한다.
        service.mark_job_failed(str(pending[0][0]), error_code="LLM_TIMEOUT")
        return collect(session, child_id, target_date)

    monkeypatch.setattr(service, "_collect_evidence", fail_after_worker_started)
    status = run(client, klass, photo(factory, klass, [children[0]]), pending)
    assert status["status"] == "failed"
    assert status["children"][0]["error_code"] == "LLM_TIMEOUT"
    assert [kind for kind, _ in calls] == ["vision", "llm", "llm"]
    with factory() as db:
        assert db.get(Job, pending[0][0]).status == "failed"
        for model in (
            DraftDocument,
            DraftSentence,
            SentenceEvidence,
            UnclassifiedItem,
        ):
            assert db.scalar(select(model)) is None, model.__name__
        # 수집·검증 이력은 기존 계약대로 보존한다. 교사에게 보이는 초안과 문장 근거만 롤백한다.
        assert db.scalar(select(EvidenceBundle)) is not None
        assert db.scalar(select(DraftDecisionLog)) is not None


@pytest.mark.parametrize("completion", ["ai", "manual"])
def test_미분류_재기록은_중복없이_갱신하고_완성하면_같은_원아_날짜만_해소한다(
    flow: Flow, completion: str
) -> None:
    client, factory, klass, children, pending, _calls = flow
    documents = service.documents
    first_job, last_job = uuid4(), uuid4()
    with factory() as db:
        for job, reason in [(first_job, "no_consent"), (last_job, "photo_analysis_failed")]:
            documents.record_unclassified(
                db, child_id=children[0], record_date=DAY, reason=reason, job_id=job
            )
        documents.record_unclassified(
            db, child_id=children[1], record_date=DAY, reason="no_consent", job_id=first_job
        )
        documents.record_unclassified(
            db,
            child_id=children[0],
            record_date=DAY - timedelta(days=1),
            reason="no_consent",
            job_id=first_job,
        )
        db.commit()
        rows = db.scalars(select(UnclassifiedItem)).all()
        assert len(rows) == 3
        target = next(row for row in rows if row.child_id == children[0] and row.record_date == DAY)
        assert target.reason == "photo_analysis_failed"
        assert target.ref_id == last_job
    login(client, TEACHER_EMAIL)
    if completion == "ai":
        run(client, klass, photo(factory, klass, [children[0]]), pending)
    else:
        response = client.post(
            f"/api/v1/children/{children[0]}/drafts",
            json={
                "record_date": str(DAY),
                "doc_type": "parent_note",
                "title": None,
                "sentences": [{"text": "블록으로 놀이했어요."}],
            },
        )
        assert response.status_code == 201, response.text
    with factory() as db:
        rows = db.scalars(select(UnclassifiedItem)).all()
        target = next(row for row in rows if row.child_id == children[0] and row.record_date == DAY)
        assert target.status == "resolved"
        assert target.resolved_at is not None
        assert all(row.status == "open" for row in rows if row.id != target.id)
        # 해소된 과거 이력을 보존하고 새로운 실패는 새 열린 항목으로 남긴다.
        documents.record_unclassified(
            db, child_id=children[0], record_date=DAY, reason="verification_failed", job_id=uuid4()
        )
        db.commit()
        assert len(db.scalars(select(UnclassifiedItem)).all()) == 4
