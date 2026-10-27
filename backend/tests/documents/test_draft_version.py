from datetime import date
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.documents.models import (
    DocType,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionAction,
    RevisionLog,
)
from domains.documents.service import get_draft_version

RECORD_DATE = date(2026, 9, 29)


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[DraftDocument.__table__, DraftSentence.__table__, RevisionLog.__table__],
    )
    return Session(engine)


def _draft(db: Session, **overrides) -> DraftDocument:
    values = {
        "child_id": uuid4(),
        "author_teacher_id": uuid4(),
        "doc_type": DocType.PARENT_NOTE.value,
        "record_date": RECORD_DATE,
        "status": DraftStatus.DRAFT.value,
    }
    values.update(overrides)
    draft = DraftDocument(**values)
    db.add(draft)
    db.commit()
    return draft


def _version(db: Session, draft: DraftDocument):
    return get_draft_version(
        db,
        child_id=draft.child_id,
        doc_type=DocType(draft.doc_type),
        record_date=draft.record_date,
    )


def test_초안이_없으면_None이라_최초_저장으로_보낸다():
    db = _session()

    info = get_draft_version(
        db, child_id=uuid4(), doc_type=DocType.PARENT_NOTE, record_date=RECORD_DATE
    )

    assert info is None


def test_초안의_ID와_잠금용_버전과_상태를_돌려준다():
    db = _session()
    draft = _draft(db, version=3, ai_version=2, status=DraftStatus.APPROVED.value)

    info = _version(db, draft)

    assert info.draft_id == draft.id
    # save_draft(expected_version=...)에 넘길 값은 AI 회차가 아니라 잠금용 버전이다.
    assert info.version == 3
    assert info.status == DraftStatus.APPROVED
    assert info.has_teacher_edits is False


@pytest.mark.parametrize("action", list(RevisionAction))
def test_교사_이력이_하나라도_있으면_손댄_문서다(action):
    # 수정·승인·회수·재게시 모두 교사가 확인한 문서라 AI 결과로 덮지 않는다 (#75 6-1).
    db = _session()
    draft = _draft(db)
    db.add(RevisionLog(draft_id=draft.id, editor_id=uuid4(), action=action.value))
    db.commit()

    assert _version(db, draft).has_teacher_edits is True


def test_다른_초안의_교사_이력은_섞이지_않는다():
    db = _session()
    draft = _draft(db)
    other = _draft(db, child_id=draft.child_id, doc_type=DocType.OBSERVATION_LOG.value)
    db.add(RevisionLog(draft_id=other.id, editor_id=uuid4(), action=RevisionAction.EDIT.value))
    db.commit()

    assert _version(db, draft).has_teacher_edits is False
    assert _version(db, other).has_teacher_edits is True


@pytest.mark.parametrize(
    "field, value",
    [
        ("child_id", uuid4()),
        ("doc_type", DocType.OBSERVATION_LOG),
        ("record_date", date(2026, 9, 30)),
    ],
)
def test_원아_문서종류_날짜가_모두_같은_초안만_고른다(field, value):
    db = _session()
    draft = _draft(db)
    query = {
        "child_id": draft.child_id,
        "doc_type": DocType(draft.doc_type),
        "record_date": draft.record_date,
    }

    info = get_draft_version(db, **{**query, field: value})

    assert info is None
