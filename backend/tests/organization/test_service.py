from datetime import UTC, date, datetime
from uuid import UUID, uuid4

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from domains.organization.models import Center, Child, ConsentRecord, Klass
from domains.organization.service import get_consented_children

FACE = "face_feature"
NOW = datetime(2026, 10, 11, 9, 0, tzinfo=UTC)


def _session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[Center.__table__, Klass.__table__, Child.__table__, ConsentRecord.__table__],
    )
    return Session(engine)


def _class(db: Session) -> UUID:
    center = Center(center_code=uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid4(), name="해바라기반", age_group="만 4세")
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: UUID, *, status: str = "enrolled") -> UUID:
    child = Child(
        class_id=class_id,
        name="김하늘",
        birth_date=date(2021, 5, 1),
        status=status,
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    return child.id


def _consent(
    db: Session,
    child_id: UUID,
    *,
    consent_type: str = FACE,
    revoked: bool = False,
) -> None:
    db.add(
        ConsentRecord(
            child_id=child_id,
            parent_id=uuid4(),
            consent_type=consent_type,
            status="revoked" if revoked else "agreed",
            agreed_at=NOW,
            revoked_at=NOW if revoked else None,
        )
    )
    db.flush()


def test_동의한_재원_원아는_들어간다():
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id)
    _consent(db, child_id)

    assert get_consented_children(db, class_id, FACE) == [child_id]


def test_동의_행이_없는_원아는_빠진다():
    db = _session()
    class_id = _class(db)
    _child(db, class_id)

    assert get_consented_children(db, class_id, FACE) == []


def test_철회한_원아는_빠진다():
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id)
    _consent(db, child_id, revoked=True)

    assert get_consented_children(db, class_id, FACE) == []


def test_철회_후_다시_동의한_원아는_들어간다():
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id)
    _consent(db, child_id, revoked=True)
    _consent(db, child_id)

    assert get_consented_children(db, class_id, FACE) == [child_id]


def test_졸업_퇴소_원아는_동의가_있어도_빠진다():
    db = _session()
    class_id = _class(db)
    for status in ("graduated", "withdrawn"):
        _consent(db, _child(db, class_id, status=status))

    assert get_consented_children(db, class_id, FACE) == []


def test_다른_종류의_동의만_있으면_빠진다():
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id)
    _consent(db, child_id, consent_type="personal_info")
    _consent(db, child_id, consent_type="activity_media")

    assert get_consented_children(db, class_id, FACE) == []


def test_다른_반_원아는_빠진다():
    db = _session()
    class_id = _class(db)
    _consent(db, _child(db, _class(db)))

    assert get_consented_children(db, class_id, FACE) == []


def test_여러_원아_중_유효한_원아만_한_번씩_돌려준다():
    db = _session()
    class_id = _class(db)
    agreed = _child(db, class_id)
    _consent(db, agreed)
    _consent(db, agreed)  # 유효한 행이 둘이어도 한 번만
    revoked = _child(db, class_id)
    _consent(db, revoked, revoked=True)
    _child(db, class_id)

    assert get_consented_children(db, class_id, FACE) == [agreed]
