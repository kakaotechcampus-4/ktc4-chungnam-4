from uuid import uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.audit.models import AccessLog, DeletionLog
from domains.audit.service import record_access, record_deletion


def _session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[AccessLog.__table__, DeletionLog.__table__])
    return Session(engine)


def test_record_access는_ID만_저장한다():
    db = _session()
    actor_id, target_id = uuid4(), uuid4()

    log = record_access(
        db,
        actor_type="parent",
        actor_id=actor_id,
        target_type="document_publication",
        target_id=target_id,
        action="view_detail",
    )

    assert log.id is not None
    row = db.query(AccessLog).one()
    assert row.actor_id == actor_id
    assert row.target_id == target_id
    assert row.actor_type == "parent"
    assert row.action == "view_detail"


def test_record_deletion은_사유를_함께_저장한다():
    db = _session()
    target_id = uuid4()

    record_deletion(
        db,
        target_type="face_embedding",
        target_id=target_id,
        reason="원아 퇴소",
    )

    row = db.query(DeletionLog).one()
    assert row.reason == "원아 퇴소"


def test_record_deletion에는_행위자_필드가_없다():
    # docs/테크스펙.md DeletionLog ERD에는 actor가 없다 — 파기는 보관기한 배치처럼
    # 시스템 트리거가 많아 행위자가 항상 있지 않다.
    assert not hasattr(DeletionLog, "actor_type")
    assert not hasattr(DeletionLog, "actor_id")


def test_record_deletion_reason은_생략_가능하다():
    db = _session()

    record_deletion(
        db,
        target_type="media_asset",
        target_id=uuid4(),
    )

    row = db.query(DeletionLog).one()
    assert row.reason is None


def test_flush만_하고_커밋은_호출자_몫이다():
    db = _session()

    record_access(
        db,
        actor_type="teacher",
        actor_id=uuid4(),
        target_type="draft_document",
        target_id=uuid4(),
        action="view_detail",
    )
    db.rollback()

    assert db.query(AccessLog).count() == 0
