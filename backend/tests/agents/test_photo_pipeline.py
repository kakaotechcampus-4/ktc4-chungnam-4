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
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
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
    assert all(
        "김도윤" not in prompt
        and "제외할 문장" not in prompt
        and "검수하지 않은 문장" not in prompt
        for _, prompt in calls
    )
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
