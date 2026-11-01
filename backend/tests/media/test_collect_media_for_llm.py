"""LLM 근거용 미디어 조회 (#34, H-2).

③ 동의는 organization 판정 함수(`get_consented_children`, #105)가 실제 행으로 판단합니다.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.media import service
from domains.media.models import MediaAsset, MediaChildLink, TranscriptSegment
from domains.organization.models import Center, Child, ConsentRecord, Klass

CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
YERIN = uuid.uuid4()  # ③ 미동의
DAY = date(2026, 9, 15)
# 한국 10:10 = UTC 01:10. 같은 날짜입니다.
MORNING = datetime(2026, 9, 15, 1, 10, tzinfo=UTC)


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            MediaAsset.__table__,
            MediaChildLink.__table__,
            TranscriptSegment.__table__,
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ConsentRecord.__table__,
        ],
    )
    with Session(engine) as session:
        # 같은 반 원아 둘. 도윤은 ③ 동의, 예린은 동의 행이 없습니다(미동의).
        center = Center(center_code="sunshine", name="햇살어린이집", contract_status="trial")
        session.add(center)
        session.flush()
        session.add(
            Klass(
                id=CLASS_ID,
                center_id=center.id,
                teacher_id=uuid.uuid4(),
                name="해바라기반",
                age_group="만 4세",
            )
        )
        for child_id in (DOYUN, YERIN):
            session.add(
                Child(
                    id=child_id,
                    class_id=CLASS_ID,
                    name="합성원아",
                    birth_date=date(2021, 5, 1),
                    status="enrolled",
                    enrolled_at=date(2025, 3, 1),
                )
            )
        add_consent(session, DOYUN)
        session.commit()
        yield session


def add_consent(db: Session, child_id: uuid.UUID, *, revoked: bool = False) -> None:
    db.add(
        ConsentRecord(
            child_id=child_id,
            parent_id=uuid.uuid4(),
            consent_type="face_feature",
            status="revoked" if revoked else "agreed",
            agreed_at=MORNING,
            revoked_at=MORNING if revoked else None,
        )
    )


def add_media(
    db: Session,
    children: list[uuid.UUID],
    *,
    type: str = "photo",
    captured_at: datetime = MORNING,
    llm_allowed: bool = True,
    storage_tier: str = "original",
) -> MediaAsset:
    asset = MediaAsset(
        client_photo_id=uuid.uuid4(),
        class_id=CLASS_ID,
        teacher_id=uuid.uuid4(),
        type=type,
        captured_at=captured_at,
        storage_url=f"s3://bucket/{uuid.uuid4()}",
        size_bytes=1,
        storage_tier=storage_tier,
        llm_allowed=llm_allowed,
    )
    db.add(asset)
    db.flush()
    for child_id in children:
        db.add(MediaChildLink(media_id=asset.id, child_id=child_id, method="manual"))
    db.flush()
    return asset


def ids(evidence: list[service.MediaEvidence]) -> list[uuid.UUID]:
    return [item.media_id for item in evidence]


def test_그_원아의_그날_llm_허용_미디어만_돌려준다(db: Session) -> None:
    kept = add_media(db, [DOYUN])
    add_media(db, [DOYUN], llm_allowed=False)
    add_media(db, [DOYUN], storage_tier="deleted")
    add_media(db, [uuid.uuid4()])  # 다른 원아
    add_media(db, [DOYUN], captured_at=datetime(2026, 9, 16, 1, 0, tzinfo=UTC))  # 다음 날

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [kept.id]


def test_날짜는_한국_시간_하루로_본다(db: Session) -> None:
    # UTC 14일 15:30 = 한국 15일 00:30 → 15일. UTC 15일 15:30 = 한국 16일 00:30 → 16일.
    early = add_media(db, [DOYUN], captured_at=datetime(2026, 9, 14, 15, 30, tzinfo=UTC))
    add_media(db, [DOYUN], captured_at=datetime(2026, 9, 15, 15, 30, tzinfo=UTC))

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [early.id]


def test_미동의_원아가_함께_귀속된_사진과_영상은_뺀다(db: Session) -> None:
    alone = add_media(db, [DOYUN])
    add_media(db, [DOYUN, YERIN])
    add_media(db, [DOYUN, YERIN], type="video")
    # 음성메모는 얼굴이 없어 ③을 보지 않습니다.
    voice = add_media(db, [DOYUN, YERIN], type="voice_memo")

    assert ids(service.collect_media_for_llm(db, DOYUN, DAY)) == [alone.id, voice.id]


def test_동의를_철회하면_저장된_llm_allowed와_상관없이_뺀다(db: Session) -> None:
    """철회 처리가 중간에 실패해 llm_allowed가 남아 있어도 수집 때 다시 막습니다 (H-2)."""
    add_media(db, [DOYUN])
    db.query(ConsentRecord).filter_by(child_id=DOYUN).delete()
    add_consent(db, DOYUN, revoked=True)

    assert service.collect_media_for_llm(db, DOYUN, DAY) == []


def test_영상_음성은_STT_구간을_시간순으로_함께_싣는다(db: Session) -> None:
    voice = add_media(db, [DOYUN], type="voice_memo")
    db.add_all(
        [
            TranscriptSegment(
                media_id=voice.id, start_time=5.0, end_time=7.5, raw_text="둘", source="voice_memo"
            ),
            TranscriptSegment(
                media_id=voice.id,
                start_time=0.0,
                end_time=2.0,
                raw_text="하나",
                source="voice_memo",
            ),
        ]
    )
    db.flush()

    [item] = service.collect_media_for_llm(db, DOYUN, DAY)

    assert [part.raw_text for part in item.transcript] == ["하나", "둘"]
    assert item.type == "voice_memo"


def test_구간_시작_시각이_없으면_맨_뒤로_보낸다(db: Session) -> None:
    """NULL 위치가 DB마다 달라(PostgreSQL은 뒤, SQLite는 앞) 명시적으로 고정합니다."""
    voice = add_media(db, [DOYUN], type="voice_memo")
    db.add_all(
        [
            TranscriptSegment(
                media_id=voice.id, start_time=5.0, end_time=7.5, raw_text="둘", source="voice_memo"
            ),
            TranscriptSegment(
                media_id=voice.id,
                start_time=None,
                end_time=None,
                raw_text="멘트 없음",
                source="voice_memo",
            ),
            TranscriptSegment(
                media_id=voice.id,
                start_time=0.0,
                end_time=2.0,
                raw_text="하나",
                source="voice_memo",
            ),
        ]
    )
    db.flush()

    [item] = service.collect_media_for_llm(db, DOYUN, DAY)

    assert [part.raw_text for part in item.transcript] == ["하나", "둘", "멘트 없음"]


def test_없으면_빈_리스트이고_동의_판정도_부르지_않는다(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    def 불리면_안_됨(db: Session, class_id: uuid.UUID, consent_type: str) -> list[uuid.UUID]:
        raise AssertionError("대상이 없으면 동의 판정을 부르지 않습니다")

    monkeypatch.setattr(service, "get_consented_children", 불리면_안_됨)

    assert service.collect_media_for_llm(db, DOYUN, DAY) == []


def test_datetime을_받아도_한국_날짜로_읽는다(db: Session) -> None:
    kept = add_media(db, [DOYUN])
    # agents의 Job.target_date는 지금 DateTime입니다. 한국 15일 자정 = UTC 14일 15:00.
    target = datetime(2026, 9, 14, 15, 0, tzinfo=UTC)

    assert ids(service.collect_media_for_llm(db, DOYUN, target)) == [kept.id]


def test_귀속된_원아_전원과_귀속_방법을_함께_싣는다(db: Session) -> None:
    # 사진 분석이 사진별 아이 수를 알아야 해서 대상 원아 말고 함께 찍힌 원아도 싣습니다.
    # 예린을 ③ 동의로 바꿔 함께 찍힌 사진이 근거에 남게 합니다.
    friend = YERIN
    add_consent(db, friend)
    asset = add_media(db, [DOYUN])
    db.add(MediaChildLink(media_id=asset.id, child_id=friend, method="face_recognition"))
    db.flush()

    [item] = service.collect_media_for_llm(db, DOYUN, DAY)

    assert item.child_links == tuple(
        sorted(
            [
                service.AttributedChild(DOYUN, "manual"),
                service.AttributedChild(friend, "face_recognition"),
            ],
            key=lambda link: link.child_id,
        )
    )
