"""학부모에게 보낼 미디어 조회와 원본 내려받기 URL (FR-10).

누구에게 보여 줄지는 documents가 정합니다. 여기서는 귀속·종류·날짜·파기 조건과
내려받기 서명(Content-Disposition)만 봅니다. 서명은 가짜 키로 검증합니다(test_signed_urls.py와 같은 방식).
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.config import get_settings
from core.exceptions import MediaAssetNotFound, MediaDeleted
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink, MediaUpload

BUCKET = "test-bucket"
CHILD = uuid.uuid4()
OTHER_CHILD = uuid.uuid4()
PHOTO_AND_VIDEO = frozenset({"photo", "video"})


def _clear_caches() -> None:
    get_settings.cache_clear()
    service._s3_session.cache_clear()
    service._s3_client.cache_clear()


@pytest.fixture(autouse=True)
def 격리된_AWS(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[None]:
    for name in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_DEFAULT_PROFILE"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIATESTONLY")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test-only-secret")
    monkeypatch.setenv("S3_BUCKET", BUCKET)
    monkeypatch.delenv("S3_REGION", raising=False)
    monkeypatch.delenv("S3_PLAYBACK_URL_EXPIRES_SECONDS", raising=False)
    _clear_caches()
    yield
    _clear_caches()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    tables = [MediaAsset, MediaChildLink, MediaUpload]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    with Session(engine) as session:
        yield session


def _asset(
    db: Session,
    *,
    type: str = "photo",
    children: tuple[uuid.UUID, ...] = (CHILD,),
    captured_at: datetime = datetime(2026, 10, 20, 1, 0, tzinfo=UTC),
    content_type: str = "image/jpeg",
    has_upload_record: bool = True,
    **values: object,
) -> MediaAsset:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        teacher_id=uuid.uuid4(),
        type=type,
        captured_at=captured_at,
        storage_url=f"media/{uuid.uuid4()}",
        size_bytes=2048,
        **{"storage_tier": "original", **values},
    )
    db.add(asset)
    db.flush()
    db.add_all(MediaChildLink(media_id=asset.id, child_id=c, method="manual") for c in children)
    # 기록 날짜는 업로드한 날입니다(C-0, 11/11 팀 결정). 촬영한 때 올린 것으로 둡니다.
    if has_upload_record:
        db.add(
            MediaUpload(
                client_photo_id=asset.client_photo_id,
                class_id=asset.class_id,
                teacher_id=asset.teacher_id,
                type=type,
                content_type=content_type,
                declared_size_bytes=2048,
                storage_key=asset.storage_url,
                state="confirmed",
                issued_at=captured_at,
                url_expires_at=captured_at,
                verified_at=captured_at,
                media_id=asset.id,
            )
        )
    db.commit()
    return asset


def _query(url: str) -> dict[str, str]:
    return {name: values[0] for name, values in parse_qs(urlparse(url).query).items()}


def test_그_원아에게_귀속된_그날_사진_영상만_촬영순으로_준다(db: Session) -> None:
    late = _asset(db, captured_at=datetime(2026, 10, 20, 5, 0, tzinfo=UTC))
    video = _asset(db, type="video")
    _asset(db, type="voice_memo")
    _asset(db, children=(OTHER_CHILD,))
    _asset(db, captured_at=datetime(2026, 10, 20, 16, 0, tzinfo=UTC))  # KST 10/21 01시
    _asset(db, storage_tier="deleted")

    found = service.list_child_media(db, CHILD, date(2026, 10, 20), types=PHOTO_AND_VIDEO)

    assert [(item.media_id, item.type) for item in found] == [
        (video.id, "video"),
        (late.id, "photo"),
    ]


def test_다른_아이가_함께_찍히고_LLM_제외된_단체사진도_준다(db: Session) -> None:
    group = _asset(db, children=(CHILD, OTHER_CHILD), llm_allowed=False)

    found = service.list_child_media(db, CHILD, date(2026, 10, 20), types=PHOTO_AND_VIDEO)

    assert [item.media_id for item in found] == [group.id]


def test_내려받기_URL은_원본에_attachment로_서명한다(db: Session) -> None:
    asset = _asset(db, content_type="image/heic", proxy_url="proxy/x")

    download = service.get_download_url(db, asset.id)

    assert urlparse(download.url).path == f"/{asset.storage_url}"
    assert download.filename == f"aidam_20261020_100000_{asset.id.hex[:6]}.heic"
    disposition = _query(download.url)["response-content-disposition"]
    assert disposition == f'attachment; filename="{download.filename}"'
    assert _query(download.url)["X-Amz-Expires"] == "900"


def test_업로드_기록이_없으면_종류로_확장자를_정한다(db: Session) -> None:
    video = _asset(db, type="video", has_upload_record=False)

    assert service.get_download_url(db, video.id).filename.endswith(".mp4")


def test_파기된_미디어는_내려받을_수_없다(db: Session) -> None:
    asset = _asset(db, storage_tier="deleted")

    with pytest.raises(MediaDeleted):
        service.get_download_url(db, asset.id)


def test_없는_미디어는_MEDIA_ASSET_NOT_FOUND(db: Session) -> None:
    with pytest.raises(MediaAssetNotFound):
        service.get_download_url(db, uuid.uuid4())
