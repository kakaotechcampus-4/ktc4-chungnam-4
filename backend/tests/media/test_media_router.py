"""media 라우터 — upload-urls, POST /media, GET /media/{media_id} (FR-15, FR-04, FR-07).

로그인 교사만 바꿔 끼우고, 반 접근·원아 소속은 organization 판정 함수가 실제 행으로
판단하게 둡니다. S3 업로드 서명·실측은 바꿔 끼우고, 재생 URL 서명은 가짜 키로 로컬에서
계산합니다(네트워크에 나가지 않음). 에러는 FE가 받는 HTTP 상태와 `error.code`로 확인합니다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.config import get_settings
from core.database import get_db
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_teacher
from domains.auth.service import TeacherProfile
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink, MediaUpload
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
CENTER_ID = uuid.uuid4()
CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
OTHER_CLASS_CHILD = uuid.uuid4()
JPEG_HEAD = b"\xff\xd8\xff\xe0" + bytes(60)
M4A_HEAD = b"\x00\x00\x00\x18ftypM4A " + bytes(52)


@pytest.fixture(autouse=True)
def 가짜_S3(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[None]:
    """업로드 서명·실측은 바꿔 끼우고, 재생 URL은 가짜 키로 서명합니다."""
    for name in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_DEFAULT_PROFILE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATESTONLY")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-only-secret")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    _clear_caches()

    stored: dict[str, service.StoredObject] = {}

    def presign(key: str, content_type: str, size_bytes: int) -> service.PresignedUpload:
        stored[key] = service.StoredObject(size_bytes=size_bytes, content_type=content_type)
        return service.PresignedUpload(
            url=f"https://signed/{key}",
            headers={"Content-Type": content_type, "If-None-Match": "*"},
            expires_at=datetime(2026, 10, 7, 7, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(service, "presign_upload", presign)
    monkeypatch.setattr(service, "head_uploaded_object", lambda key: stored.get(key))
    monkeypatch.setattr(
        service,
        "_read_object_head",
        lambda key: M4A_HEAD if stored[key].content_type == "audio/mp4" else JPEG_HEAD,
    )
    yield
    _clear_caches()


def _clear_caches() -> None:
    get_settings.cache_clear()
    service._s3_session.cache_clear()
    service._s3_client.cache_clear()


@pytest.fixture
def session_factory() -> sessionmaker[Session]:
    # TestClient는 동기 라우트를 다른 스레드에서 돌리므로 연결 하나를 같이 씁니다.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            MediaAsset.__table__,
            MediaUpload.__table__,
            MediaChildLink.__table__,
            AccessLog.__table__,
            Center.__table__,
            Klass.__table__,
            Child.__table__,
        ],
    )
    factory = sessionmaker(bind=engine)
    with factory() as db:
        # 로그인 교사의 어린이집에 반 둘. 도윤은 CLASS_ID 원아입니다.
        _add_class(db, CENTER_ID, CLASS_ID)
        other_class = uuid.uuid4()
        _add_class(db, CENTER_ID, other_class)
        _add_child(db, CLASS_ID, DOYUN)
        _add_child(db, other_class, OTHER_CLASS_CHILD)
        db.commit()
    return factory


def _add_class(db: Session, center_id: uuid.UUID, class_id: uuid.UUID) -> None:
    if db.get(Center, center_id) is None:
        db.add(
            Center(
                id=center_id,
                center_code=center_id.hex[:8],
                name="햇살어린이집",
                contract_status="trial",
            )
        )
    db.add(
        Klass(
            id=class_id, center_id=center_id, teacher_id=TEACHER_ID, name="반", age_group="만 4세"
        )
    )
    db.flush()


def _add_child(db: Session, class_id: uuid.UUID, child_id: uuid.UUID) -> None:
    db.add(
        Child(
            id=child_id,
            class_id=class_id,
            name="합성원아",
            birth_date=date(2021, 5, 1),
            status="enrolled",
            enrolled_at=date(2025, 3, 1),
        )
    )


def _login_as(center_id: uuid.UUID | None) -> None:
    app.dependency_overrides[get_current_teacher] = lambda: TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )


@pytest.fixture
def anonymous_client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    """로그인하지 않은 요청. 도메인 예외를 500으로 터뜨리지 않고 응답으로 받습니다."""

    def override_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


@pytest.fixture
def client(anonymous_client: TestClient) -> TestClient:
    _login_as(CENTER_ID)
    return anonymous_client


def _error_code(response) -> str:
    return response.json()["error"]["code"]


def _item(media_type: str = "photo", content_type: str = "image/jpeg", **extra: object) -> dict:
    return {
        "client_photo_id": str(uuid.uuid4()),
        "type": media_type,
        "content_type": content_type,
        "size_bytes": 2048,
        **extra,
    }


def _upload_urls(client: TestClient, *items: dict) -> list[dict]:
    response = client.post(
        "/api/v1/media/upload-urls", json={"class_id": str(CLASS_ID), "items": list(items)}
    )
    assert response.status_code == 200
    return response.json()["items"]


def _photo_complete(client_photo_id: str, *child_ids: uuid.UUID, llm_allowed: bool = True) -> dict:
    return {
        "client_photo_id": client_photo_id,
        "class_id": str(CLASS_ID),
        "type": "photo",
        "captured_at": "2026-10-07T01:10:00Z",
        "model_version": "mock-1",
        "llm_allowed": llm_allowed,
        "child_links": [
            {"child_id": str(child_id), "method": "face_recognition", "confidence_score": 0.9}
            for child_id in child_ids
        ],
    }


def _uploaded_photo(client: TestClient) -> str:
    [issued] = _upload_urls(client, _item())
    response = client.post("/api/v1/media", json=_photo_complete(issued["client_photo_id"], DOYUN))
    assert response.status_code == 201
    return response.json()["media_id"]


def test_media_라우터가_api_v1_아래에_등록된다() -> None:
    registered = {
        (path, method) for path, methods in app.openapi()["paths"].items() for method in methods
    }
    assert {
        ("/api/v1/media/upload-urls", "post"),
        ("/api/v1/media", "post"),
        ("/api/v1/media/{media_id}", "get"),
    } <= registered
    # 영상·음성 귀속 방식이 정해질 때까지(#142) 귀속 저장 엔드포인트는 열지 않습니다
    assert not any(path.endswith("/child-links") for path, _ in registered)


# ---- POST /media/upload-urls ----


def test_upload_urls는_파일마다_결과를_돌려준다(client: TestClient) -> None:
    ok, bad = _item(), _item(content_type="text/html")

    issued, failed = _upload_urls(client, ok, bad)

    assert issued["status"] == "issued"
    assert issued["upload_url"].startswith("https://signed/media/")
    assert issued["upload_headers"] == {"Content-Type": "image/jpeg", "If-None-Match": "*"}
    assert issued["error"] is None
    assert failed["status"] == "error"
    assert failed["error"]["code"] == "MEDIA_TYPE_NOT_ALLOWED"
    assert failed["error"]["message"]  # 화면이 그대로 보여 줄 문장
    assert failed["upload_url"] is None


def test_upload_urls는_발급_기록을_커밋한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """기록이 남아야 고아 객체를 추적할 수 있습니다."""
    _upload_urls(client, _item())

    with session_factory() as other:
        assert other.query(MediaUpload).count() == 1


def test_upload_urls는_별칭_MIME을_대표값으로_돌려준다(client: TestClient) -> None:
    [item] = _upload_urls(client, _item("voice_memo", "audio/x-m4a"))

    assert item["upload_headers"]["Content-Type"] == "audio/mp4"


def test_upload_urls는_10개를_넘으면_400_UPLOAD_BATCH_TOO_LARGE(client: TestClient) -> None:
    response = client.post(
        "/api/v1/media/upload-urls",
        json={"class_id": str(CLASS_ID), "items": [_item() for _ in range(11)]},
    )

    assert (response.status_code, _error_code(response)) == (400, "UPLOAD_BATCH_TOO_LARGE")


def test_다른_어린이집_반에는_발급하지_않는다(
    anonymous_client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """반 id만 바꿔 남의 어린이집 반에 올리지 못합니다 (FR-25)."""
    _login_as(uuid.uuid4())

    response = anonymous_client.post(
        "/api/v1/media/upload-urls", json={"class_id": str(CLASS_ID), "items": [_item()]}
    )

    assert (response.status_code, _error_code(response)) == (403, "CLASS_ACCESS_DENIED")
    with session_factory() as other:
        assert other.query(MediaUpload).count() == 0


def test_로그인하지_않으면_401_UNAUTHENTICATED(anonymous_client: TestClient) -> None:
    response = anonymous_client.post(
        "/api/v1/media/upload-urls", json={"class_id": str(CLASS_ID), "items": [_item()]}
    )

    assert (response.status_code, _error_code(response)) == (401, "UNAUTHENTICATED")


# ---- POST /media ----


def test_사진_완료_통지는_201로_확정과_귀속을_돌려준다(client: TestClient) -> None:
    [issued] = _upload_urls(client, _item())

    response = client.post("/api/v1/media", json=_photo_complete(issued["client_photo_id"], DOYUN))

    assert response.status_code == 201
    body = response.json()
    assert body["llm_allowed"] is True
    assert body["attributed_at"] is not None
    assert [link["child_id"] for link in body["child_links"]] == [str(DOYUN)]
    assert "storage_url" not in body  # 내부 S3 경로는 내보내지 않습니다


def test_같은_사진을_다시_보내면_200으로_같은_media_id를_준다(client: TestClient) -> None:
    [issued] = _upload_urls(client, _item())
    first = client.post(
        "/api/v1/media", json=_photo_complete(issued["client_photo_id"], DOYUN)
    ).json()

    again = client.post(
        "/api/v1/media", json=_photo_complete(issued["client_photo_id"], DOYUN, llm_allowed=False)
    )

    assert again.status_code == 200
    assert again.json()["media_id"] == first["media_id"]
    assert again.json()["llm_allowed"] is False  # 다시 보낸 귀속으로 전체 교체


def test_음성은_귀속_없이_확정되고_LLM에서_빠진_채로_남는다(client: TestClient) -> None:
    [issued] = _upload_urls(client, _item("voice_memo", "audio/mp4"))

    completed = client.post(
        "/api/v1/media",
        json={
            "client_photo_id": issued["client_photo_id"],
            "class_id": str(CLASS_ID),
            "type": "voice_memo",
            "captured_at": "2026-10-07T01:24:00Z",
        },
    )

    assert completed.status_code == 201
    assert (completed.json()["llm_allowed"], completed.json()["attributed_at"]) == (False, None)


def test_다른_반_원아를_귀속하면_400_CHILD_NOT_IN_CLASS(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    [issued] = _upload_urls(client, _item())

    response = client.post(
        "/api/v1/media", json=_photo_complete(issued["client_photo_id"], DOYUN, OTHER_CLASS_CHILD)
    )

    assert (response.status_code, _error_code(response)) == (400, "CHILD_NOT_IN_CLASS")
    with session_factory() as other:
        assert other.query(MediaAsset).count() == 0


@pytest.mark.parametrize(
    "body",
    [
        # 사진인데 귀속이 없음
        {"type": "photo", "captured_at": "2026-10-07T01:10:00Z"},
        # 사진인데 llm_allowed만 있음 — 한쪽만 오면 #13 버그가 됩니다
        {"type": "photo", "captured_at": "2026-10-07T01:10:00Z", "llm_allowed": True},
        # 음성인데 귀속을 실음
        {
            "type": "voice_memo",
            "captured_at": "2026-10-07T01:10:00Z",
            "llm_allowed": True,
            "child_links": [],
        },
        # 시간대 없는 촬영 시각
        {
            "type": "photo",
            "captured_at": "2026-10-07T10:10:00",
            "llm_allowed": True,
            "child_links": [],
        },
    ],
)
def test_완료_통지_모양이_틀리면_422(client: TestClient, body: dict) -> None:
    response = client.post(
        "/api/v1/media",
        json={"client_photo_id": str(uuid.uuid4()), "class_id": str(CLASS_ID), **body},
    )

    assert response.status_code == 422


# ---- GET /media/{media_id} ----


def test_재발급은_서명_URL과_만료를_주고_캐시하지_않는다(client: TestClient) -> None:
    media_id = _uploaded_photo(client)

    response = client.get(f"/api/v1/media/{media_id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"media_id", "type", "captured_at", "url", "url_expires_at"}
    assert (body["media_id"], body["type"]) == (media_id, "photo")
    assert "X-Amz-Signature" in body["url"]
    assert response.headers["cache-control"] == "no-store"


def test_재발급은_응답_전에_열람_기록을_커밋한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """모든 열람 API 호출이 AccessLog를 남긴다 (NFR-05, backend 필수 테스트 4)."""
    media_id = _uploaded_photo(client)

    response = client.get(f"/api/v1/media/{media_id}")

    assert response.status_code == 200
    with session_factory() as other:  # 요청이 쓴 세션과 다른 세션에서 보여야 커밋된 것입니다
        [log] = other.query(AccessLog).all()
        assert (log.actor_id, log.target_type, str(log.target_id)) == (
            TEACHER_ID,
            "media_asset",
            media_id,
        )


@pytest.mark.parametrize("center_id", [uuid.uuid4(), None], ids=["다른_어린이집", "소속_없음"])
def test_다른_어린이집_교사는_재발급받지_못하고_기록도_없다(
    client: TestClient, session_factory: sessionmaker[Session], center_id: uuid.UUID | None
) -> None:
    media_id = _uploaded_photo(client)
    _login_as(center_id)

    response = client.get(f"/api/v1/media/{media_id}")

    assert (response.status_code, _error_code(response)) == (403, "CLASS_ACCESS_DENIED")
    with session_factory() as other:
        assert other.query(AccessLog).count() == 0


def test_없는_미디어는_404_MEDIA_ASSET_NOT_FOUND(client: TestClient) -> None:
    response = client.get(f"/api/v1/media/{uuid.uuid4()}")

    assert (response.status_code, _error_code(response)) == (404, "MEDIA_ASSET_NOT_FOUND")


def test_파기된_미디어는_409_MEDIA_DELETED(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    media_id = _uploaded_photo(client)
    with session_factory() as db:
        db.get(MediaAsset, uuid.UUID(media_id)).storage_tier = "deleted"
        db.commit()

    response = client.get(f"/api/v1/media/{media_id}")

    assert (response.status_code, _error_code(response)) == (409, "MEDIA_DELETED")
