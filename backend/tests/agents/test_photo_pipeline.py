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


def test_추가_사진으로_같은_초안을_재생성하고_이전_문장근거를_교체한다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    from domains.agents.models import SentenceEvidence

    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    first_media = photo(factory, klass, [children[0]])
    first = run(client, klass, first_media, pending)
    draft_id = first["children"][0]["drafts"][0]["draft_id"]
    before = client.get(f"/api/v1/drafts/{draft_id}").json()
    second_media = photo(factory, klass, [children[0]])
    with factory() as db:
        db.get(MediaAsset, second_media).captured_at = datetime(2026, 10, 30, 4, tzinfo=UTC)
        # 잠금 버전과 AI 회차는 다르다. 다음 호출은 AI 5회차를 이어가야 한다.
        db.get(DraftDocument, UUID(draft_id)).ai_version = 4
        db.commit()

    def vision(prompt: str, images: list[str]) -> str:
        text = "공을 굴리고 있다." if str(second_media) in images[0] else "블록을 쌓고 있다."
        return json.dumps(
            [
                {
                    "ref": "P1",
                    "observations": [{"text": text, "scope": "individual"}],
                    "no_observation_reason": None,
                }
            ]
        )

    def llm(prompt: str) -> str:
        if '"sentence_id"' in prompt:
            return json.dumps(
                [
                    {
                        "sentence_id": "s1",
                        "verdict": "pass",
                        "reason_code": "ok",
                        "detail": "근거와 일치",
                        "evidence_ids": ["E2"],
                    }
                ]
            )
        assert "공을 굴리고 있다" in prompt
        return json.dumps(
            {"sentences": [{"text": "CHILD_A는 공을 굴리며 놀이했어요.", "evidence_refs": ["E2"]}]}
        )

    monkeypatch.setattr(service, "call_vision", vision)
    monkeypatch.setattr(service, "call_claude", llm)
    result = run(client, klass, second_media, pending)
    assert result["status"] == "succeeded"
    assert result["children"][0]["drafts"][0]["draft_id"] == draft_id
    after = client.get(f"/api/v1/drafts/{draft_id}").json()
    assert after["version"] == before["version"] + 1
    assert "공을 굴리며" in after["sentences"][0]["text"]
    with factory() as db:
        assert db.get(DraftDocument, UUID(draft_id)).ai_version == 5
        evidence = db.scalars(
            select(SentenceEvidence).where(SentenceEvidence.draft_id == UUID(draft_id))
        ).all()
        assert len(evidence) == 1
        assert evidence[0].source_media_id == second_media
        assert "공을 굴리고" in evidence[0].source_text


@pytest.mark.parametrize("action", ["edit", "approve", "revoke"])
def test_교사가_수정_승인_회수한_초안은_AI_호출_없이_보호한다(flow: Flow, action: str) -> None:
    client, factory, klass, children, pending, calls = flow
    login(client, TEACHER_EMAIL)
    media = photo(factory, klass, [children[0]])
    first = run(client, klass, media, pending)
    draft_id = first["children"][0]["drafts"][0]["draft_id"]
    before = client.get(f"/api/v1/drafts/{draft_id}").json()
    if action == "edit":
        response = client.patch(
            f"/api/v1/drafts/{draft_id}",
            json={
                "expected_version": before["version"],
                "sentences": [{"sentence_id": "s1", "text": "교사가 확인한 내용입니다."}],
            },
        )
        assert response.status_code == 200, response.text
    else:
        with factory() as db:
            db.get(DraftDocument, UUID(draft_id)).status = (
                "revoked" if action == "revoke" else "approved"
            )
            db.commit()
    protected = client.get(f"/api/v1/drafts/{draft_id}").json()
    calls.clear()
    result = run(client, klass, media, pending)
    assert result["status"] == "failed"
    assert result["children"][0]["error_code"] == "DRAFT_VERSION_CONFLICT"
    assert calls == []
    after = client.get(f"/api/v1/drafts/{draft_id}").json()
    assert after["sentences"] == protected["sentences"]
    assert after["version"] == protected["version"]
    assert after["status"] == protected["status"]


@pytest.mark.parametrize("action", ["edit", "approve"])
def test_재생성_도중_교사_변경은_보존하고_저장충돌을_실패로_안내한다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch, action: str
) -> None:
    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    media = photo(factory, klass, [children[0]])
    first = run(client, klass, media, pending)
    draft_id = first["children"][0]["drafts"][0]["draft_id"]
    before = client.get(f"/api/v1/drafts/{draft_id}").json()
    generate = service._generate_draft
    protected = []

    def generate_and_edit(*args, **kwargs):
        result = generate(*args, **kwargs)
        if action == "edit":
            response = client.patch(
                f"/api/v1/drafts/{draft_id}",
                json={
                    "expected_version": before["version"],
                    "sentences": [{"sentence_id": "s1", "text": "생성 도중 교사가 수정했습니다."}],
                },
            )
        else:
            response = client.post(
                f"/api/v1/drafts/{draft_id}/approve",
                json={"expected_version": before["version"], "reviewed": True},
            )
        assert response.status_code == 200, response.text
        protected.append(response.json())
        return result

    monkeypatch.setattr(service, "_generate_draft", generate_and_edit)
    result = run(client, klass, media, pending)
    assert result["status"] == "failed"
    assert result["children"][0]["error_code"] == "DRAFT_VERSION_CONFLICT"
    assert result["children"][0]["drafts"] == []
    after = client.get(f"/api/v1/drafts/{draft_id}").json()
    assert after["sentences"] == protected[0]["sentences"]
    assert after["version"] == protected[0]["version"]
    assert after["status"] == protected[0]["status"]


def test_재생성_분석실패를_기존_초안의_생성성공으로_안내하지_않는다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    media = photo(factory, klass, [children[0]])
    first = run(client, klass, media, pending)
    draft_id = first["children"][0]["drafts"][0]["draft_id"]
    before = client.get(f"/api/v1/drafts/{draft_id}").json()
    monkeypatch.setattr(service, "call_vision", lambda *_: "invalid-json")
    result = run(client, klass, media, pending)
    assert result["children"][0]["outcome"] == "unclassified"
    assert result["children"][0]["unclassified_reason"] == "photo_analysis_failed"
    assert result["children"][0]["drafts"] == []
    assert client.get(f"/api/v1/drafts/{draft_id}").json()["sentences"] == before["sentences"]


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


def upload_clip(flow: Flow, monkeypatch: pytest.MonkeyPatch, kind: str) -> UUID:
    from domains.media import router as media_router

    client, _factory, klass, _children, _pending, _calls = flow
    login(client, TEACHER_EMAIL)
    content_type = "video/mp4" if kind == "video" else "audio/mp4"
    monkeypatch.setattr(
        service.media_service,
        "head_uploaded_object",
        lambda key: StoredObject(size_bytes=500, content_type=content_type),
    )
    monkeypatch.setattr(
        service.media_service,
        "_read_object_head",
        lambda key: b"\x00\x00\x00\x18ftypisom" + bytes(52),
    )
    queued = []
    monkeypatch.setattr(media_router, "enqueue_transcription", queued.append)
    photo_id = str(uuid4())
    issued = client.post(
        "/api/v1/media/upload-urls",
        json={
            "class_id": str(klass),
            "items": [
                {
                    "client_photo_id": photo_id,
                    "type": kind,
                    "content_type": content_type,
                    "size_bytes": 500,
                }
            ],
        },
    )
    assert issued.status_code == 200, issued.text
    response = client.post(
        "/api/v1/media",
        json={
            "client_photo_id": photo_id,
            "class_id": str(klass),
            "type": kind,
            "captured_at": "2026-10-30T03:00:00Z",
        },
    )
    assert response.status_code == 201, response.text
    media_id = UUID(response.json()["media_id"])
    assert queued == [media_id]
    return media_id


@pytest.mark.parametrize("kind", ["video", "voice_memo"])
def test_영상음성_업로드_STT_검수_파일귀속_생성_게시_열람(
    flow: Flow, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    from domains.media import audio, stt

    client, factory, klass, children, pending, calls = flow
    media_id = upload_clip(flow, monkeypatch, kind)
    monkeypatch.setattr(service.media_service, "SessionLocal", factory)
    monkeypatch.setattr(
        service.media_service, "_speech_chunks", lambda key: [audio.AudioChunk(0, 10, b"RIFF")]
    )
    monkeypatch.setattr(
        service.media_service.stt,
        "transcribe_chunks",
        lambda chunks: [
            stt.SpeechSegment(0, 2, "김도윤은 블록으로 탑을 만들었어요."),
            stt.SpeechSegment(3, 5, "제외할 문장"),
            stt.SpeechSegment(6, 9, "검수하지 않은 문장"),
        ],
    )
    service.media_service.transcribe_media(str(media_id))
    result = client.get(f"/api/v1/media/{media_id}/transcript-segments")
    assert result.status_code == 200, result.text
    assert result.json()["transcript_status"] == "done"
    first, excluded, _unreviewed = result.json()["items"]
    for segment, body in [
        (first, {"text": "김도윤은 블록으로 탑을 만들었어요.", "speaker": "teacher_observation"}),
        (excluded, {"excluded": True}),
    ]:
        response = client.patch(f"/api/v1/transcript-segments/{segment['segment_id']}", json=body)
        assert response.status_code == 200, response.text
    # 음성메모는 얼굴 동의가 없어도 사용 가능하다. 영상은 동의한 원아로 확인한다.
    child = children[0] if kind == "video" else children[2]
    linked = client.put(
        f"/api/v1/media/{media_id}/child-links",
        json={
            "llm_allowed": True,
            "child_links": [{"child_id": str(child), "method": "manual", "confidence_score": None}],
        },
    )
    assert linked.status_code == 200, linked.text
    assert linked.json()["llm_allowed"] is True
    checked = client.get(f"/api/v1/media/{media_id}/transcript-segments").json()
    assert checked["child_links"][0]["child_id"] == str(child)
    status = run(client, klass, media_id, pending)
    assert status["status"] == "succeeded", status
    assert [kind for kind, _ in calls] == ["llm", "llm"]  # 영상 프레임은 vision에 보내지 않는다.
    assert all("김도윤" not in prompt and "제외할 문장" not in prompt for _, prompt in calls)
    # 교사가 손대지 않은 발화도 뺀 것이 아니라 넘깁니다(#232 리뷰). 음성메모는 교사 음성메모로
    # 근거가 되고, 화자를 정하지 않은 영상 발화는 아이 말로 단정하지 않고 perception이 뺍니다.
    generation_prompt = calls[0][1]
    assert ("검수하지 않은 문장" in generation_prompt) is (kind == "voice_memo")
    draft = status["children"][0]["drafts"][0]["draft_id"]
    detail = client.get(f"/api/v1/drafts/{draft}").json()
    assert detail["sentences"][0]["evidences"]
    approved = client.post(
        f"/api/v1/drafts/{draft}/approve",
        json={"expected_version": detail["version"], "reviewed": True},
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
    overview = client.get(f"/api/v1/children/{child}/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json()["recent_notes"][0]["published"] is True
    login(client, PARENT_EMAILS[0 if kind == "video" else 2])
    assert client.get(f"/api/v1/parent-notes/{draft}").status_code == 200
    login(client, PARENT_EMAILS[1])
    assert client.get(f"/api/v1/parent-notes/{draft}").status_code == 404


def test_STT_worker가_멈추면_폴링이_failed로_끝내고_늦은_완료는_거절한다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    from domains.media import audio, stt
    from domains.media.models import MediaUpload, TranscriptSegment

    client, factory, _klass, _children, _pending, _calls = flow
    media_id = upload_clip(flow, monkeypatch, "voice_memo")
    monkeypatch.setattr(service.media_service, "SessionLocal", factory)
    monkeypatch.setattr(
        service.media_service, "_speech_chunks", lambda key: [audio.AudioChunk(0, 5, b"RIFF")]
    )

    def late_stt(chunks):
        with factory() as db:
            row = db.scalar(select(MediaUpload).where(MediaUpload.media_id == media_id))
            row.verified_at = datetime.now(UTC) - timedelta(hours=2)
            db.commit()
        assert (
            client.get(f"/api/v1/media/{media_id}/transcript-segments").json()["transcript_status"]
            == "failed"
        )
        return [stt.SpeechSegment(0, 2, "늦게 도착한 결과")]

    monkeypatch.setattr(service.media_service.stt, "transcribe_chunks", late_stt)
    service.media_service.transcribe_media(str(media_id))
    with factory() as db:
        assert db.get(MediaAsset, media_id).transcript_status == "failed"
        assert (
            db.scalar(select(TranscriptSegment).where(TranscriptSegment.media_id == media_id))
            is None
        )


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
        expected_resolver = db.get(Klass, klass).teacher_id if completion == "manual" else None
        assert target.resolved_by == expected_resolver
        assert all(row.status == "open" for row in rows if row.id != target.id)
        # 알림장이 완성된 뒤 재실패해도 해소 이력과 기존 문서를 보존한다.
        documents.record_unclassified(
            db, child_id=children[0], record_date=DAY, reason="verification_failed", job_id=uuid4()
        )
        db.commit()
        assert len(db.scalars(select(UnclassifiedItem)).all()) == 3


@pytest.mark.parametrize("approved", [False, True])
def test_기존_알림장_이후_생성_실패가_확인_필요를_다시_만들지_않는다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch, approved: bool
) -> None:
    client, factory, klass, children, pending, _calls = flow
    login(client, TEACHER_EMAIL)
    created = client.post(
        f"/api/v1/children/{children[0]}/drafts",
        json={
            "record_date": str(DAY),
            "doc_type": "parent_note",
            "sentences": [{"text": "교사가 직접 작성한 기록입니다."}],
        },
    )
    assert created.status_code == 201, created.text
    draft = created.json()
    if approved:
        response = client.post(
            f"/api/v1/drafts/{draft['draft_id']}/approve",
            json={"expected_version": draft["version"], "reviewed": True},
        )
        assert response.status_code == 200, response.text
        draft = response.json()
    monkeypatch.setattr(service, "call_vision", lambda *_: "invalid-json")
    run(client, klass, photo(factory, klass, [children[0]]), pending)
    listed = client.get(f"/api/v1/classes/{klass}/drafts", params={"record_date": str(DAY)})
    assert listed.status_code == 200, listed.text
    row = next(item for item in listed.json()["items"] if item["child_id"] == str(children[0]))
    assert row["unclassified"] is None
    assert row["parent_note"]["draft_id"] == draft["draft_id"]
    assert row["parent_note"]["status"] == draft["status"]
    detail = client.get(f"/api/v1/drafts/{draft['draft_id']}").json()
    assert detail["sentences"] == draft["sentences"]
    with factory() as db:
        assert db.scalar(select(Job)).error_code == "DRAFT_VERSION_CONFLICT"
        assert db.scalar(select(Job)).unclassified_reason is None
        assert db.scalar(select(UnclassifiedItem)) is None


def test_관찰일지를_직접_써도_알림장_실패는_남는다(flow: Flow) -> None:
    client, factory, klass, children, _pending, _calls = flow
    with factory() as db:
        service.documents.record_unclassified(
            db,
            child_id=children[0],
            record_date=DAY,
            reason="verification_failed",
            job_id=uuid4(),
        )
        db.commit()
    login(client, TEACHER_EMAIL)
    response = client.post(
        f"/api/v1/children/{children[0]}/drafts",
        json={
            "record_date": str(DAY),
            "doc_type": "observation_log",
            "sentences": [{"text": "관찰일지만 작성합니다."}],
        },
    )
    assert response.status_code == 201, response.text
    listed = client.get(f"/api/v1/classes/{klass}/drafts", params={"record_date": str(DAY)})
    assert listed.status_code == 200, listed.text
    row = listed.json()["items"][0]
    assert row["parent_note"] is None
    assert row["observation_log"] is not None
    assert row["unclassified"]["reason"] == "verification_failed"
    with factory() as db:
        failure = db.scalar(select(UnclassifiedItem))
        assert failure.status == "open"
        assert failure.resolved_at is None
        assert failure.resolved_by is None


def test_알림장과_함께_남은_과거_실패는_목록에서_제외하고_재기록하면_해소한다(flow: Flow) -> None:
    client, factory, klass, children, _pending, _calls = flow
    login(client, TEACHER_EMAIL)
    created = client.post(
        f"/api/v1/children/{children[0]}/drafts",
        json={
            "record_date": str(DAY),
            "doc_type": "parent_note",
            "sentences": [{"text": "완성한 기록입니다."}],
        },
    )
    assert created.status_code == 201
    with factory() as db:
        db.add(
            UnclassifiedItem(
                child_id=children[0],
                record_date=DAY,
                reason="verification_failed",
                ref_type="job",
                ref_id=uuid4(),
            )
        )
        db.commit()
    listed = client.get(f"/api/v1/classes/{klass}/drafts", params={"record_date": str(DAY)})
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["unclassified"] is None
    with factory() as db:
        service.documents.record_unclassified(
            db,
            child_id=children[0],
            record_date=DAY,
            reason="photo_analysis_failed",
            job_id=uuid4(),
        )
        db.commit()
        rows = db.scalars(select(UnclassifiedItem)).all()
        assert len(rows) == 1
        assert rows[0].status == "resolved"
        assert rows[0].reason == "verification_failed"


@pytest.mark.parametrize(
    "instant,expected_activity",
    [
        (datetime(2026, 10, 29, 16, tzinfo=UTC), "금요일 활동"),
        (datetime(2026, 10, 28, 3, tzinfo=UTC), None),
        (datetime(2026, 10, 31, 3, tzinfo=UTC), None),
    ],
)
def test_계획_근거는_KST_해당_요일만_사용하고_비어도_다른_요일을_섞지_않는다(
    flow: Flow, instant: datetime, expected_activity: str | None
) -> None:
    from domains.agents.models import EvidenceBundle
    from domains.organization.models import EducationPlan

    _client, factory, klass, children, _pending, _calls = flow
    with factory() as db:
        for kind, activities in [
            ("weekly", {"mon": "월요일 활동", "fri": "금요일 활동"}),
            ("monthly", {}),
        ]:
            db.add(
                EducationPlan(
                    class_id=klass,
                    teacher_id=db.get(Klass, klass).teacher_id,
                    plan_type=kind,
                    start_date=date(2026, 10, 1),
                    end_date=date(2026, 10, 31),
                    title=f"{kind} 제목",
                    content="놀이 목표",
                    daily_activities=activities,
                    domains=[],
                )
            )
        bundle = EvidenceBundle(
            child_id=children[0], date=instant, media_refs=[], transcript_refs=[], context_lookup={}
        )
        db.add(bundle)
        db.flush()
        inputs = service._load_generation_inputs(bundle)
        texts = [item.text for item in inputs.evidence]
        assert len(texts) == 2
        assert all("월요일 활동" not in text for text in texts)
        assert "monthly 제목 / 놀이 목표" in texts
        assert (
            f"weekly 제목 / 놀이 목표{(' / ' + expected_activity) if expected_activity else ''}"
            in texts
        )


def test_추가_근거는_비식별화되어_생성에_들어가고_교사_근거_패널에_원문으로_남는다(
    flow: Flow, monkeypatch: pytest.MonkeyPatch
) -> None:
    from domains.agents.models import SentenceEvidence
    from domains.organization import service as organization_service

    client, factory, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    with factory() as db:
        names = organization_service.get_class_child_names(db, klass)[children[0]]
    secret = "우산을 직접 챙겼어요"
    saved = client.put(
        f"/api/v1/children/{children[0]}/evidence/{DAY}",
        json={"activity_time": "10:30", "text": f"{names[0]}가 비 오는 날 {secret}."},
    )
    assert saved.status_code == 201
    prompts: list[str] = []

    def llm(prompt: str) -> str:
        prompts.append(prompt)
        if '"sentence_id"' in prompt:
            return json.dumps(
                [
                    {
                        "sentence_id": "s1",
                        "verdict": "pass",
                        "reason_code": "ok",
                        "detail": "근거와 일치",
                        "evidence_ids": ["E1"],
                    },
                    {
                        "sentence_id": "s2",
                        "verdict": "pass",
                        "reason_code": "ok",
                        "detail": "근거와 일치",
                        "evidence_ids": ["E2"],
                    },
                ]
            )
        return json.dumps(
            {
                "sentences": [
                    {"text": "CHILD_A는 블록을 쌓으며 놀이했어요.", "evidence_refs": ["E1"]},
                    {"text": "CHILD_A는 비 오는 날 우산을 직접 챙겼어요.", "evidence_refs": ["E2"]},
                ]
            }
        )

    monkeypatch.setattr(service, "call_claude", llm)
    result = run(client, klass, photo(factory, klass, [children[0]]), pending)

    assert result["status"] == "succeeded"
    assert result["children"][0]["outcome"] == "drafted"
    # H-2: 메모 내용은 LLM에 가지만 이름은 가지 않는다(생성·검증 호출 모두)
    assert prompts
    assert all(not any(name in prompt for name in names) for prompt in prompts)
    draft_prompt = next(prompt for prompt in prompts if '"sentence_id"' not in prompt)
    assert secret in draft_prompt
    assert "teacher_note" in draft_prompt
    # FR-07: 교사 근거 패널에는 비식별화 전 원문이 교사 메모 출처로 보인다
    draft_id = result["children"][0]["drafts"][0]["draft_id"]
    with factory() as db:
        rows = db.scalars(
            select(SentenceEvidence).where(SentenceEvidence.draft_id == UUID(draft_id))
        ).all()
    note_rows = [row for row in rows if row.evidence_id.startswith("note:")]
    assert len(note_rows) == 1
    assert note_rows[0].source_media_id is None
    assert names[0] in note_rows[0].source_text
    detail = client.get(f"/api/v1/drafts/{draft_id}").json()
    evidences = [e for sentence in detail["sentences"] for e in sentence.get("evidences", [])]
    assert "teacher_note" in {evidence["source_type"] for evidence in evidences}


def test_추가_근거만_있는_원아도_초안을_만든다(flow: Flow, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _, klass, children, pending, _ = flow
    login(client, TEACHER_EMAIL)
    saved = client.put(
        f"/api/v1/children/{children[1]}/evidence/{DAY}",
        json={"activity_time": "10:30", "text": "비 오는 날 우산을 직접 챙겼어요."},
    )
    assert saved.status_code == 201

    def llm(prompt: str) -> str:
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
                    {"text": "CHILD_A는 비 오는 날 우산을 직접 챙겼어요.", "evidence_refs": ["E1"]}
                ]
            }
        )

    monkeypatch.setattr(service, "call_claude", llm)
    response = client.post(
        f"/api/v1/classes/{klass}/jobs",
        json={"record_date": str(DAY), "request_id": str(uuid4()), "media_ids": []},
    )
    assert response.status_code == 202, response.text
    for job, child in pending:
        service.orchestrate_drafts(str(job), str(child))
    result = client.get(f"/api/v1/jobs/{response.json()['job_id']}").json()

    assert [child["child_id"] for child in result["children"]] == [str(children[1])]
    assert result["children"][0]["outcome"] != "unclassified"
    assert result["children"][0]["drafts"]


def test_생성에는_그_아이_그날의_추가_근거만_들어간다(flow: Flow) -> None:
    from domains.agents.models import EvidenceBundle, TeacherEvidence

    _client, factory, klass, children, _pending, _calls = flow
    with factory() as db:
        teacher_id = db.get(Klass, klass).teacher_id
        for child_id, day, text in (
            (children[0], DAY, "이 아이의 오늘 메모"),
            (children[1], DAY, "같은 반 다른 아이의 메모"),
            (children[0], DAY - timedelta(days=1), "이 아이의 어제 메모"),
        ):
            db.add(
                TeacherEvidence(
                    child_id=child_id,
                    record_date=day,
                    activity_time="10:30",
                    text=text,
                    author_teacher_id=teacher_id,
                )
            )
        bundle = EvidenceBundle(
            child_id=children[0],
            date=datetime(2026, 10, 30, 3, tzinfo=UTC),
            media_refs=[],
            transcript_refs=[],
            context_lookup={},
        )
        db.add(bundle)
        db.flush()
        inputs = service._load_generation_inputs(bundle)

    notes = [item for item in inputs.evidence if item.source_type.value == "teacher_note"]
    assert [item.text for item in notes] == ["이 아이의 오늘 메모"]
    assert notes[0].evidence_id.startswith("note:")
    assert notes[0].child_ids == [str(children[0])]
    assert notes[0].media_id is None
    assert notes[0].evidence_id in inputs.request.evidence_ids
