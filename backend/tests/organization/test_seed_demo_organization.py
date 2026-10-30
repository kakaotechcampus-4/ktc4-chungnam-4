from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from core.base import Base
from domains.organization.models import Center, Child, ConsentRecord, Klass, ParentChildRelation
from domains.organization.service import get_consented_children, list_class_children
from scripts.seed_demo_organization import (
    CONSENT_TYPES,
    ensure_center,
    ensure_class_roster,
    link_parent,
)

NOW = datetime(2026, 10, 28, 9, 0, tzinfo=UTC)


def _session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ParentChildRelation.__table__,
            ConsentRecord.__table__,
        ],
    )
    return Session(engine)


def _seed(db: Session, teacher_id, parent_id):
    center_id = ensure_center(db, center_code="AIDAM-DEMO", name="아이담 시연 어린이집")
    class_id, child_ids = ensure_class_roster(
        db,
        center_id=center_id,
        teacher_id=teacher_id,
        class_name="햇살반",
        age_group="만 4세",
        child_names=["김하늘", "이바다"],
    )
    link_parent(db, parent_id=parent_id, child_ids=child_ids, agreed_at=NOW)
    return center_id, class_id, child_ids


def test_교사_반_명단과_동의_원아가_채워진다() -> None:
    db = _session()
    center_id, class_id, child_ids = _seed(db, uuid4(), uuid4())

    roster = list_class_children(db, class_id, center_id)
    assert sorted(item.child_id for item in roster.items) == sorted(child_ids)
    for consent_type in CONSENT_TYPES:
        assert sorted(get_consented_children(db, class_id, consent_type)) == sorted(child_ids)


def test_두_번_돌려도_행이_늘지_않는다() -> None:
    db = _session()
    teacher_id, parent_id = uuid4(), uuid4()
    first = _seed(db, teacher_id, parent_id)
    second = _seed(db, teacher_id, parent_id)

    assert first == second
    assert db.scalar(select(func.count()).select_from(Center)) == 1
    assert db.scalar(select(func.count()).select_from(Klass)) == 1
    assert db.scalar(select(func.count()).select_from(Child)) == 2
    assert db.scalar(select(func.count()).select_from(ParentChildRelation)) == 2
    assert db.scalar(select(func.count()).select_from(ConsentRecord)) == 2 * len(CONSENT_TYPES)
