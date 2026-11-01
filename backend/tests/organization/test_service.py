from datetime import UTC, date, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.base import Base
from core.exceptions import (
    CenterNotFound,
    ChildAccessDenied,
    ChildNotFound,
    ChildNotInClass,
    ClassAccessDenied,
    ClassNotFound,
)
from domains.organization.models import Center, Child, ConsentRecord, Klass
from domains.organization.service import (
    CenterSummary,
    ensure_child_access,
    ensure_children_in_class,
    ensure_class_access,
    find_center_by_code,
    get_class_child_names,
    get_consented_children,
    has_consent,
)

FACE = "face_feature"
NOW = datetime(2026, 10, 11, 9, 0, tzinfo=UTC)


def _session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[Center.__table__, Klass.__table__, Child.__table__, ConsentRecord.__table__],
    )
    return Session(engine)


def _center(db: Session) -> UUID:
    center = Center(center_code=uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _class(db: Session, center_id: UUID | None = None) -> UUID:
    klass = Klass(
        center_id=center_id or _center(db),
        teacher_id=uuid4(),
        name="해바라기반",
        age_group="만 4세",
    )
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: UUID, *, status: str = "enrolled", name: str = "김하늘") -> UUID:
    child = Child(
        class_id=class_id,
        name=name,
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


def test_같은_어린이집_교사는_반에_접근한다():
    db = _session()
    center_id = _center(db)
    class_id = _class(db, center_id)

    ensure_class_access(db, class_id, center_id)


def test_없는_반은_CLASS_NOT_FOUND():
    db = _session()

    with pytest.raises(ClassNotFound):
        ensure_class_access(db, uuid4(), _center(db))


def test_다른_어린이집의_반은_CLASS_ACCESS_DENIED():
    db = _session()
    class_id = _class(db)

    with pytest.raises(ClassAccessDenied):
        ensure_class_access(db, class_id, _center(db))


def test_같은_어린이집_원아에_접근한다():
    db = _session()
    center_id = _center(db)
    child_id = _child(db, _class(db, center_id))

    ensure_child_access(db, child_id, center_id)


def test_졸업한_원아도_같은_어린이집이면_접근한다():
    db = _session()
    center_id = _center(db)
    child_id = _child(db, _class(db, center_id), status="graduated")

    ensure_child_access(db, child_id, center_id)


def test_없는_원아는_CHILD_NOT_FOUND():
    db = _session()

    with pytest.raises(ChildNotFound):
        ensure_child_access(db, uuid4(), _center(db))


def test_다른_어린이집의_원아는_CHILD_ACCESS_DENIED():
    db = _session()
    child_id = _child(db, _class(db))

    with pytest.raises(ChildAccessDenied):
        ensure_child_access(db, child_id, _center(db))


def test_모두_그_반_원아면_통과한다():
    db = _session()
    class_id = _class(db)
    first, second = _child(db, class_id), _child(db, class_id)

    ensure_children_in_class(db, class_id, [first, second, first])


def test_빈_목록은_통과한다():
    db = _session()

    ensure_children_in_class(db, _class(db), [])


def test_다른_반_원아가_섞이면_CHILD_NOT_IN_CLASS():
    db = _session()
    class_id = _class(db)
    mine = _child(db, class_id)
    other = _child(db, _class(db))

    with pytest.raises(ChildNotInClass):
        ensure_children_in_class(db, class_id, [mine, other])


def test_없는_원아가_섞이면_CHILD_NOT_IN_CLASS():
    db = _session()
    class_id = _class(db)

    with pytest.raises(ChildNotInClass):
        ensure_children_in_class(db, class_id, [_child(db, class_id), uuid4()])


def test_졸업한_원아는_반에_연결하지_않는다():
    db = _session()
    class_id = _class(db)

    with pytest.raises(ChildNotInClass):
        ensure_children_in_class(db, class_id, [_child(db, class_id, status="graduated")])


def test_원아_한_명의_동의가_유효하면_True():
    db = _session()
    child_id = _child(db, _class(db))
    _consent(db, child_id)

    assert has_consent(db, child_id, FACE) is True


def test_원아_한_명이_철회했거나_동의가_없으면_False():
    db = _session()
    class_id = _class(db)
    revoked = _child(db, class_id)
    _consent(db, revoked, revoked=True)
    _consent(db, revoked, consent_type="personal_info")

    assert has_consent(db, revoked, FACE) is False
    assert has_consent(db, _child(db, class_id), FACE) is False


def test_원아_한_명이_철회_후_다시_동의하면_True():
    db = _session()
    child_id = _child(db, _class(db))
    _consent(db, child_id, revoked=True)
    _consent(db, child_id)

    assert has_consent(db, child_id, FACE) is True


def test_가입_코드로_어린이집을_찾는다():
    db = _session()
    center = Center(center_code="SUN1234", name="햇살어린이집", contract_status="active")
    db.add(center)
    db.add(Center(center_code="MOON5678", name="달님어린이집", contract_status="trial"))
    db.flush()

    assert find_center_by_code(db, "SUN1234") == CenterSummary(
        center_id=center.id, name="햇살어린이집"
    )


def test_없는_가입_코드는_CENTER_NOT_FOUND():
    db = _session()
    _center(db)

    with pytest.raises(CenterNotFound):
        find_center_by_code(db, "NOPE0000")


def test_가입_코드는_정확히_일치해야_찾는다():
    db = _session()
    db.add(Center(center_code="SUN1234", name="햇살어린이집", contract_status="active"))
    db.flush()

    with pytest.raises(CenterNotFound):
        find_center_by_code(db, "SUN123")


def test_반_원아_이름은_호칭이_먼저고_성명이_뒤에_온다():
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id, name="김민준")

    assert get_class_child_names(db, class_id) == {child_id: ["민준", "김민준"]}


@pytest.mark.parametrize("name", ["김솔", "남궁민준", "Kim Minjun"])
def test_세_글자가_아닌_이름은_성명만_돌려준다(name):
    db = _session()
    class_id = _class(db)
    child_id = _child(db, class_id, name=name)

    assert get_class_child_names(db, class_id) == {child_id: [name]}


def test_졸업_퇴소_원아의_이름도_넣고_다른_반은_뺀다():
    db = _session()
    class_id = _class(db)
    enrolled = _child(db, class_id, name="김민준")
    graduated = _child(db, class_id, status="graduated", name="이서아")
    withdrawn = _child(db, class_id, status="withdrawn", name="박도윤")
    _child(db, _class(db), name="최하준")

    assert set(get_class_child_names(db, class_id)) == {enrolled, graduated, withdrawn}


def test_원아가_없는_반은_빈_딕셔너리():
    db = _session()

    assert get_class_child_names(db, _class(db)) == {}
