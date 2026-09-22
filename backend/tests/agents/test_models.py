import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.base import Base
from domains.agents.models import SentenceEvidence

_TABLES = [SentenceEvidence.__table__]


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=_TABLES)
    return Session(engine)


def _row(**overrides: object) -> SentenceEvidence:
    base = {
        "draft_id": uuid.uuid4(),
        "sentence_index": 0,
        "evidence_id": "ev_001",
        "source_media_id": uuid.uuid4(),
        "source_timestamp": 12.0,
        "source_text": "CHILD_A가 블록 놀이를 했습니다.",
    }
    base.update(overrides)
    return SentenceEvidence(**base)


def test_같은_문장이_여러_근거를_참조하면_행이_여러개_생긴다() -> None:
    db = _session()
    draft_id = uuid.uuid4()
    db.add(_row(draft_id=draft_id, sentence_index=0, evidence_id="ev_001"))
    db.add(_row(draft_id=draft_id, sentence_index=0, evidence_id="ev_002"))

    db.flush()  # 예외 없이 통과해야 한다

    assert db.query(SentenceEvidence).count() == 2


def test_같은_문장_같은_근거_중복은_거부된다() -> None:
    db = _session()
    draft_id = uuid.uuid4()
    db.add(_row(draft_id=draft_id, sentence_index=0, evidence_id="ev_001"))
    db.flush()

    db.add(_row(draft_id=draft_id, sentence_index=0, evidence_id="ev_001"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_활동계획_근거는_source_media_id가_없어도_저장된다() -> None:
    db = _session()

    db.add(_row(source_media_id=None, source_timestamp=None))
    db.flush()  # 예외 없이 통과해야 한다

    row = db.query(SentenceEvidence).one()
    assert row.source_media_id is None
