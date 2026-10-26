"""근거 미디어 재생 URL 서명 (FR-07, 비공개 S3).

서명은 AWS를 부르지 않는 로컬 계산이라 가짜 키로 검증합니다. 개발자 PC의 SSO 프로필이나
EC2 롤을 집어 가지 않게 자격증명 탐색 경로를 막습니다 (test_s3_presign.py와 같은 방식).
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.config import get_settings
from core.exceptions import MediaAssetNotFound, StorageNotConfigured
from domains.media import service
from domains.media.models import MediaAsset

BUCKET = "test-bucket"


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
    Base.metadata.create_all(engine, tables=[MediaAsset.__table__])
    with Session(engine) as session:
        yield session


def _asset(db: Session, *, type: str = "photo", **values: object) -> MediaAsset:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=uuid.uuid4(),
        teacher_id=uuid.uuid4(),
        type=type,
        captured_at=datetime(2026, 10, 13, 1, 0, tzinfo=UTC),
        storage_url=f"media/{uuid.uuid4()}",
        size_bytes=2048,
        storage_tier="original",
        **values,
    )
    db.add(asset)
    db.commit()
    return asset


def _query(url: str) -> dict[str, str]:
    return {name: values[0] for name, values in parse_qs(urlparse(url).query).items()}


def test_요청_순서대로_서울_리전_호스트로_서명한다(db: Session) -> None:
    photo = _asset(db)
    voice = _asset(db, type="voice_memo")

    signed = service.get_signed_urls(db, [voice.id, photo.id])

    assert [(item.media_id, item.type) for item in signed] == [
        (voice.id, "voice_memo"),
        (photo.id, "photo"),
    ]
    url = urlparse(signed[0].url)
    assert url.netloc == f"{BUCKET}.s3.ap-northeast-2.amazonaws.com"
    assert url.path == f"/{voice.storage_url}"
    assert "X-Amz-Signature" in _query(signed[0].url)


def test_기본_유효기간은_15분이고_만료_시각을_함께_준다(db: Session) -> None:
    before = datetime.now(UTC)

    [item] = service.get_signed_urls(db, [_asset(db).id])

    assert _query(item.url)["X-Amz-Expires"] == "900"
    assert 899 <= (item.url_expires_at - before).total_seconds() <= 901


def test_자격증명이_먼저_끝나면_그_안으로_줄인다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(service, "_credential_seconds_left", lambda region: 1000)

    [item] = service.get_signed_urls(db, [_asset(db).id])

    assert _query(item.url)["X-Amz-Expires"] == "700"  # 1000초 - 여유 300초


def test_파생본이_있으면_그것에_서명한다(db: Session) -> None:
    asset = _asset(db, type="video", proxy_url="media/proxy/clip.mp4")

    [item] = service.get_signed_urls(db, [asset.id])

    assert urlparse(item.url).path == "/media/proxy/clip.mp4"


def test_같은_id는_한_번만_서명한다(db: Session) -> None:
    asset = _asset(db)

    assert len(service.get_signed_urls(db, [asset.id, asset.id])) == 1


def test_파기된_미디어는_결과에서_뺀다(db: Session) -> None:
    kept = _asset(db)
    deleted = _asset(db)
    deleted.storage_tier = "deleted"
    db.commit()

    assert [item.media_id for item in service.get_signed_urls(db, [kept.id, deleted.id])] == [
        kept.id
    ]


def test_모르는_id가_섞이면_MEDIA_ASSET_NOT_FOUND(db: Session) -> None:
    with pytest.raises(MediaAssetNotFound):
        service.get_signed_urls(db, [_asset(db).id, uuid.uuid4()])


def test_빈_목록이면_S3를_부르지_않고_빈_결과(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("S3_BUCKET")
    _clear_caches()

    assert service.get_signed_urls(db, []) == []


def test_자격증명이_없으면_서명하지_않는다(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    asset = _asset(db)
    monkeypatch.delenv("AWS_ACCESS_KEY_ID")
    monkeypatch.delenv("AWS_SECRET_ACCESS_KEY")
    _clear_caches()

    with pytest.raises(StorageNotConfigured):
        service.get_signed_urls(db, [asset.id])


def test_결과에_S3_경로를_싣지_않는다() -> None:
    """서명 없는 경로는 쓸 수 없고 내부 구조만 드러냅니다."""
    assert set(service.SignedMediaUrl.__dataclass_fields__) == {
        "media_id",
        "type",
        "url",
        "url_expires_at",
    }
