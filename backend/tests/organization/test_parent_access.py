from datetime import date
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import ChildAccessDenied, ChildAccessExpired
from domains.organization.models import Center, Child, Klass, ParentChildRelation
from domains.organization.service import ensure_parent_child_access, has_linked_parent

TODAY = date(2026, 10, 28)


def _session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            ParentChildRelation.__table__,
        ],
    )
    return Session(engine)


def _child(db: Session, *, graduated_at: date | None = None) -> UUID:
    center = Center(center_code=uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid4(), name="해바라기반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name="김하늘",
        birth_date=date(2021, 5, 1),
        status="enrolled" if graduated_at is None else "graduated",
        enrolled_at=date(2025, 3, 1),
        graduated_at=graduated_at,
    )
    db.add(child)
    db.flush()
    return child.id


def _link(db: Session, child_id: UUID, parent_id: UUID | None = None) -> UUID:
    parent_id = parent_id or uuid4()
    db.add(ParentChildRelation(parent_id=parent_id, child_id=child_id, is_legal_guardian=True))
    db.flush()
    return parent_id


def test_자녀로_연결된_재원_원아는_열람한다():
    db = _session()
    child_id = _child(db)
    parent_id = _link(db, child_id)

    ensure_parent_child_access(db, parent_id, child_id, today=TODAY)


def test_연결되지_않은_원아는_CHILD_ACCESS_DENIED():
    db = _session()
    child_id = _child(db)
    _link(db, child_id)

    with pytest.raises(ChildAccessDenied):
        ensure_parent_child_access(db, uuid4(), child_id, today=TODAY)


def test_없는_원아도_CHILD_ACCESS_DENIED():
    db = _session()

    with pytest.raises(ChildAccessDenied):
        ensure_parent_child_access(db, uuid4(), uuid4(), today=TODAY)


def test_졸업_후_1년이_되는_날까지는_열람한다():
    db = _session()
    child_id = _child(db, graduated_at=date(2025, 10, 28))
    parent_id = _link(db, child_id)

    ensure_parent_child_access(db, parent_id, child_id, today=TODAY)


def test_졸업_후_1년이_지나면_CHILD_ACCESS_EXPIRED():
    db = _session()
    child_id = _child(db, graduated_at=date(2025, 10, 27))
    parent_id = _link(db, child_id)

    with pytest.raises(ChildAccessExpired):
        ensure_parent_child_access(db, parent_id, child_id, today=TODAY)


def test_2월_29일_졸업은_다음_해_2월_28일까지_열람한다():
    db = _session()
    child_id = _child(db, graduated_at=date(2028, 2, 29))
    parent_id = _link(db, child_id)

    ensure_parent_child_access(db, parent_id, child_id, today=date(2029, 2, 28))
    with pytest.raises(ChildAccessExpired):
        ensure_parent_child_access(db, parent_id, child_id, today=date(2029, 3, 1))


def test_학부모가_여럿이어도_각자_열람한다():
    db = _session()
    child_id = _child(db)
    mother, father = _link(db, child_id), _link(db, child_id)

    ensure_parent_child_access(db, mother, child_id, today=TODAY)
    ensure_parent_child_access(db, father, child_id, today=TODAY)


def test_연결된_학부모가_있으면_True():
    db = _session()
    child_id = _child(db)
    _link(db, child_id)

    assert has_linked_parent(db, child_id) is True


def test_연결된_학부모가_없거나_없는_원아면_False():
    db = _session()
    linked = _child(db)
    _link(db, linked)

    assert has_linked_parent(db, _child(db)) is False
    assert has_linked_parent(db, uuid4()) is False
