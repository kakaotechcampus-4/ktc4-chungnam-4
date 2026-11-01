"""문장별 근거 조회 — list_sentence_evidences (FR-07).

documents의 교사용 초안 상세가 부르는 함수입니다. 근거 행과 미디어 행만 실제로 넣고,
출처 종류·촬영 시각이 docs/api/documents.md의 evidences[] 모양으로 나오는지 봅니다.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.base import Base
from core.exceptions import MediaAssetNotFound
from domains.agents.models import SentenceEvidence
from domains.agents.service import list_sentence_evidences
from domains.media.models import MediaAsset

DRAFT_ID = uuid.uuid4()
CLASS_ID = uuid.uuid4()
TEACHER_ID = uuid.uuid4()
MORNING = datetime(2026, 9, 15, 1, 10, tzinfo=UTC)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[SentenceEvidence.__table__, MediaAsset.__table__])
    with sessionmaker(bind=engine)() as session:
        yield session


def _media(db: Session, media_type: str, captured_at: datetime = MORNING) -> uuid.UUID:
    media_id = uuid.uuid4()
    db.add(
        MediaAsset(
            id=media_id,
            client_photo_id=uuid.uuid4(),
            class_id=CLASS_ID,
            teacher_id=TEACHER_ID,
            type=media_type,
            captured_at=captured_at,
            storage_url=f"s3://bucket/{media_id}",
            size_bytes=2048,
            llm_allowed=True,
        )
    )
    db.flush()
    return media_id


def _evidence(
    db: Session,
    sentence_id: str,
    evidence_id: str,
    media_id: uuid.UUID | None,
    timestamp: float | None = None,
) -> None:
    db.add(
        SentenceEvidence(
            draft_id=DRAFT_ID,
            sentence_id=sentence_id,
            evidence_id=evidence_id,
            source_media_id=media_id,
            source_timestamp=timestamp,
            source_text="합성 근거 원문",
        )
    )
    db.flush()


def test_근거를_문장별로_묶고_미디어_종류로_출처를_정한다(db: Session) -> None:
    photo = _media(db, "photo")
    memo = _media(db, "voice_memo")
    video = _media(db, "video")
    _evidence(db, "s1", "photo:a:1", photo)
    _evidence(db, "s1", "seg:1", memo, timestamp=18.0)
    _evidence(db, "s2", "seg:2", video, timestamp=3.25)
    _evidence(db, "s2", "plan:1", None)

    result = list_sentence_evidences(db, DRAFT_ID)

    assert set(result) == {"s1", "s2"}
    by_id = {item.evidence_id: item for items in result.values() for item in items}
    assert by_id["photo:a:1"].source_type == "photo_observation"
    assert by_id["photo:a:1"].start_ms is None
    # SQLite는 시간대를 저장하지 않아 시각만 비교합니다.
    assert by_id["photo:a:1"].captured_at.replace(tzinfo=None) == MORNING.replace(tzinfo=None)
    assert by_id["seg:1"].source_type == "teacher_voice_memo"
    assert by_id["seg:1"].start_ms == 18000
    # 영상은 발화만 근거로 쓰므로 video_speech입니다 (테크스펙 §요청사항 2).
    assert by_id["seg:2"].source_type == "video_speech"
    assert by_id["seg:2"].start_ms == 3250
    # 미디어가 없는 근거는 활동계획이고, 시각 값이 없습니다.
    assert by_id["plan:1"].source_type == "activity_plan"
    assert by_id["plan:1"].media_id is None
    assert by_id["plan:1"].captured_at is None
    assert all(item.end_ms is None for item in by_id.values())


def test_근거가_없는_초안은_빈_결과다(db: Session) -> None:
    assert list_sentence_evidences(db, uuid.uuid4()) == {}


def test_다른_초안의_근거는_섞이지_않는다(db: Session) -> None:
    photo = _media(db, "photo")
    _evidence(db, "s1", "photo:a:1", photo)
    db.add(
        SentenceEvidence(
            draft_id=uuid.uuid4(),
            sentence_id="s1",
            evidence_id="photo:b:1",
            source_media_id=photo,
            source_text="다른 초안 근거",
        )
    )
    db.flush()

    result = list_sentence_evidences(db, DRAFT_ID)

    assert [item.evidence_id for item in result["s1"]] == ["photo:a:1"]


def test_근거가_가리키는_미디어가_없으면_숨기지_않고_오류다(db: Session) -> None:
    _evidence(db, "s1", "photo:a:1", uuid.uuid4())

    with pytest.raises(MediaAssetNotFound):
        list_sentence_evidences(db, DRAFT_ID)


def test_한_문장의_근거는_촬영_시각_시작_시각_순이고_값이_없는_근거는_뒤다(db: Session) -> None:
    late = _media(db, "photo", captured_at=datetime(2026, 9, 15, 5, 0, tzinfo=UTC))
    early = _media(db, "voice_memo", captured_at=datetime(2026, 9, 15, 1, 0, tzinfo=UTC))
    video = _media(db, "video", captured_at=datetime(2026, 9, 15, 1, 0, tzinfo=UTC))
    # evidence_id 문자열 순(photo < plan < seg)과 다르게 들어가도 시간 순으로 나와야 합니다.
    _evidence(db, "s1", "photo:a:1", late)
    _evidence(db, "s1", "plan:1", None)
    _evidence(db, "s1", "seg:2", video, timestamp=9.0)
    _evidence(db, "s1", "seg:1", early, timestamp=2.0)

    result = list_sentence_evidences(db, DRAFT_ID)

    assert [item.evidence_id for item in result["s1"]] == [
        "seg:1",
        "seg:2",
        "photo:a:1",
        "plan:1",
    ]
