"""원아 상세·개요에 싣는 알림장 집계 — 게시 여부와 달 경계 (#232 리뷰).

원아 이름·본문은 합성 값만 쓴다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from domains.documents import service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)

CHILD = uuid.uuid4()
TODAY = date(2026, 11, 3)


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [DraftDocument, DraftSentence, DocumentPublication]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _note(
    db: Session,
    record_date: date,
    *,
    status: DraftStatus = DraftStatus.APPROVED,
    published: bool = False,
    revoked: bool = False,
    sentences: tuple[str, ...] = ("첫 문장.",),
    doc_type: DocType = DocType.PARENT_NOTE,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=CHILD,
        author_teacher_id=uuid.uuid4(),
        doc_type=doc_type.value,
        record_date=record_date,
        status=status.value,
        ai_version=1,
        selected_media_ids=[],
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=f"s{n}", position=n, text=text)
        for n, text in enumerate(sentences)
    )
    if published:
        published_at = datetime.combine(record_date, datetime.min.time(), tzinfo=UTC)
        db.add(
            DocumentPublication(
                draft_id=draft.id,
                round_number=1,
                publish_request_id=str(uuid.uuid4()),
                published_version=1,
                published_at=published_at,
                revoke_deadline=published_at + timedelta(hours=24),
                revoked_at=published_at + timedelta(hours=1) if revoked else None,
                include_photos=False,
            )
        )
    db.commit()
    return draft


def test_회수한_알림장은_게시되지_않은_것으로_센다(db: Session) -> None:
    revoked = _note(db, TODAY, status=DraftStatus.REVOKED, published=True, revoked=True)
    sent = _note(db, TODAY - timedelta(days=1), published=True)

    summary = service.child_record_summary(db, CHILD, TODAY)

    published = {note.parent_note_id: note.published for note in summary.recent_notes}
    assert published == {revoked.id: False, sent.id: True}
    assert summary.today_note_sent is False


def test_승인했어도_활성_회차가_없으면_게시가_아니다(db: Session) -> None:
    approved = _note(db, TODAY, published=True, revoked=True)

    summary = service.child_record_summary(db, CHILD, TODAY)

    assert [note.published for note in summary.recent_notes] == [False]
    assert summary.recent_notes[0].parent_note_id == approved.id
    assert summary.today_note_sent is False


def test_이번_달_기록은_1일부터_오늘까지만_센다(db: Session) -> None:
    _note(db, date(2026, 10, 31))  # 지난달 마지막 날
    _note(db, date(2026, 11, 1))  # 이번 달 1일
    _note(db, TODAY, status=DraftStatus.DRAFT)  # 승인 전도 센다
    _note(db, date(2026, 11, 4))  # 내일
    _note(db, date(2026, 11, 2), doc_type=DocType.OBSERVATION_LOG)  # 관찰일지는 세지 않는다

    summary = service.child_record_summary(db, CHILD, TODAY)

    assert summary.month_record_count == 2


def test_미리보기는_다른_목록과_같은_규칙으로_자른다(db: Session) -> None:
    long_first = "가" * 70 + "."
    _note(db, TODAY, sentences=(long_first, "나" * 40 + "."))
    _note(db, TODAY - timedelta(days=1), sentences=())

    summary = service.child_record_summary(db, CHILD, TODAY)

    # 둘째 문장을 붙이면 100자를 넘으므로 첫 문장에서 멈춘다. 문장이 없으면 안내 문구다.
    assert [note.summary for note in summary.recent_notes] == [
        long_first,
        "작성 중인 알림장입니다.",
    ]
