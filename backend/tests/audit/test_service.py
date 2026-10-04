from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.base import Base
from domains.audit.models import AccessLog, DeletionLog, DeletionReason, DeletionTargetType
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
        reason="consent_revoked",
    )

    row = db.query(DeletionLog).one()
    assert row.target_id == target_id
    assert row.reason == "consent_revoked"


def test_record_deletion에는_행위자_필드가_없다():
    # docs/테크스펙.md DeletionLog ERD에는 actor가 없다 — 파기는 보관기한 배치처럼
    # 시스템 트리거가 많아 행위자가 항상 있지 않다.
    assert not hasattr(DeletionLog, "actor_type")
    assert not hasattr(DeletionLog, "actor_id")


@pytest.mark.parametrize("reason", list(DeletionReason))
@pytest.mark.parametrize("target_type", list(DeletionTargetType))
def test_record_deletion은_허용된_사유와_대상_타입을_저장한다(target_type, reason):
    db = _session()

    record_deletion(db, target_type=target_type, target_id=uuid4(), reason=reason)

    row = db.query(DeletionLog).one()
    assert row.target_type == target_type.value
    assert row.reason == reason.value


def test_허용_코드_목록은_74_합의와_같다():
    # 값을 바꾸면 face·media 호출부와 다시 맞춰야 한다 (#74)
    assert {reason.value for reason in DeletionReason} == {
        "consent_revoked",
        "teacher_removed",
        "retention_expired",
        "unapproved",
    }
    assert {target.value for target in DeletionTargetType} == {"media_asset", "face_embedding"}


@pytest.mark.parametrize("reason", ["원아 퇴소", "", None, "CONSENT_REVOKED"])
def test_허용되지_않은_사유는_거부하고_로그를_추가하지_않는다(reason):
    db = _session()

    with pytest.raises(ValueError) as exc_info:
        record_deletion(db, target_type="media_asset", target_id=uuid4(), reason=reason)

    assert not db.new
    assert db.query(DeletionLog).count() == 0
    # 잘못 넘어온 값을 메시지에 그대로 싣지 않는다 (H-4)
    if reason:
        assert reason not in str(exc_info.value)


@pytest.mark.parametrize("target_type", ["draft_document", "", None])
def test_허용되지_않은_대상_타입은_거부하고_로그를_추가하지_않는다(target_type):
    db = _session()

    with pytest.raises(ValueError):
        record_deletion(db, target_type=target_type, target_id=uuid4(), reason="retention_expired")

    assert not db.new
    assert db.query(DeletionLog).count() == 0


def test_record_deletion은_사유를_생략할_수_없다():
    db = _session()

    with pytest.raises(TypeError):
        record_deletion(db, target_type="media_asset", target_id=uuid4())

    assert db.query(DeletionLog).count() == 0


def test_record_deletion도_커밋하지_않아_호출자_롤백에_함께_취소된다():
    db = _session()

    record_deletion(db, target_type="face_embedding", target_id=uuid4(), reason="teacher_removed")
    db.rollback()

    assert db.query(DeletionLog).count() == 0


def test_record_deletion_기록_실패는_호출자에게_전달된다():
    db = _session()

    # target_id가 빠져 flush에서 실패한다 — 삼키지 않고 그대로 올린다
    with pytest.raises(IntegrityError):
        record_deletion(db, target_type="media_asset", target_id=None, reason="unapproved")


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
