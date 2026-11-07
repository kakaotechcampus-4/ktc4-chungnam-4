"""공지 게시판 — 교사 CRUD, 학부모 열람 범위, 열람 기록 (FR-11, FR-12, NFR-05).

organization·audit는 진짜 테이블과 함수로 맞물려 본다. 이름·본문은 합성 값만 쓴다.
"""

import uuid
from collections.abc import Iterator
from datetime import date
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.notice.models import Notice
from domains.organization.models import Center, Child, Klass, ParentChildRelation
from main import app

PARENT_ID = uuid.uuid4()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, ParentChildRelation, Notice, AccessLog]
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _center(db: Session) -> UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _class(db: Session, center_id: UUID, name: str = "해바라기반") -> UUID:
    klass = Klass(center_id=center_id, teacher_id=uuid.uuid4(), name=name, age_group="만 4세")
    db.add(klass)
    db.flush()
    return klass.id


def _child(db: Session, class_id: UUID, *, graduated_at: date | None = None) -> UUID:
    child = Child(
        class_id=class_id,
        name="김하늘",
        birth_date=date(2021, 5, 1),
        status="enrolled" if graduated_at is None else "graduated",
        enrolled_at=date(2025, 3, 1),
        graduated_at=graduated_at,
    )
    db.add(child)
    db.flush()
    db.add(ParentChildRelation(parent_id=PARENT_ID, child_id=child.id, is_legal_guardian=True))
    db.flush()
    return child.id


def _notice(db: Session, class_id: UUID, title: str = "공지", content: str = "본문") -> Notice:
    notice = Notice(class_id=class_id, teacher_id=uuid.uuid4(), title=title, content=content)
    db.add(notice)
    db.commit()
    return notice


def _teacher(center_id: UUID | None) -> UUID:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile
    return profile.teacher_id


def _parent() -> None:
    profile = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=PARENT_ID
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _logs(db: Session) -> list[tuple[str, str, UUID]]:
    rows = db.scalars(select(AccessLog).order_by(AccessLog.created_at))
    return [(row.target_type, row.action, row.target_id) for row in rows]


def test_교사는_공지를_등록하고_목록과_상세로_본다(client, db):
    center_id = _center(db)
    class_id = _class(db, center_id)
    teacher_id = _teacher(center_id)

    created = client.post(
        f"/api/v1/classes/{class_id}/notices",
        json={"title": "  현장학습 안내  ", "content": "20일에 나들이를 갑니다."},
    )

    assert created.status_code == 201
    body = created.json()
    assert body["title"] == "현장학습 안내"
    assert body["author_teacher_id"] == str(teacher_id)
    assert body["class_id"] == str(class_id)
    listed = client.get(f"/api/v1/classes/{class_id}/notices").json()
    assert [item["notice_id"] for item in listed["items"]] == [body["notice_id"]]
    assert listed["next_cursor"] is None
    assert client.get(f"/api/v1/notices/{body['notice_id']}").json()["content"] == (
        "20일에 나들이를 갑니다."
    )


def test_교사는_보낸_필드만_수정하고_삭제한다(client, db):
    center_id = _center(db)
    notice = _notice(db, _class(db, center_id), title="원래 제목", content="원래 본문")
    _teacher(center_id)

    patched = client.patch(f"/api/v1/notices/{notice.id}", json={"title": "새 제목"})

    assert patched.status_code == 200
    assert patched.json()["title"] == "새 제목"
    assert patched.json()["content"] == "원래 본문"
    assert client.delete(f"/api/v1/notices/{notice.id}").status_code == 204
    gone = client.get(f"/api/v1/notices/{notice.id}")
    assert gone.status_code == 404
    assert gone.json()["error"]["code"] == "NOTICE_NOT_FOUND"


@pytest.mark.parametrize("body", [{}, {"title": None}, {"content": None}])
def test_수정은_바꿀_값이_없거나_null이면_422(client, db, body):
    center_id = _center(db)
    notice = _notice(db, _class(db, center_id))
    _teacher(center_id)

    response = client.patch(f"/api/v1/notices/{notice.id}", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "body",
    [
        {"title": "   ", "content": "본문"},
        {"title": "제목", "content": ""},
        {"title": "가" * 101, "content": "본문"},
        {"title": "제목", "content": "가" * 5001},
    ],
)
def test_등록은_빈_제목이나_너무_긴_값이면_422(client, db, body):
    center_id = _center(db)
    class_id = _class(db, center_id)
    _teacher(center_id)

    response = client.post(f"/api/v1/classes/{class_id}/notices", json=body)

    assert response.status_code == 422
    assert db.scalar(select(Notice)) is None


def test_교사는_다른_어린이집_반의_공지를_보지도_고치지도_지우지도_못한다(client, db):
    own_center = _center(db)
    other_class = _class(db, _center(db))
    other_notice = _notice(db, other_class)
    _teacher(own_center)

    responses = [
        client.get(f"/api/v1/classes/{other_class}/notices"),
        client.post(f"/api/v1/classes/{other_class}/notices", json={"title": "a", "content": "b"}),
        client.get(f"/api/v1/notices/{other_notice.id}"),
        client.patch(f"/api/v1/notices/{other_notice.id}", json={"title": "x"}),
        client.delete(f"/api/v1/notices/{other_notice.id}"),
    ]

    for response in responses:
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"
    db.expire_all()
    assert db.get(Notice, other_notice.id).title == "공지"


def test_소속이_없는_교사는_공지를_다루지_못한다(client, db):
    class_id = _class(db, _center(db))
    _teacher(None)

    response = client.get(f"/api/v1/classes/{class_id}/notices")

    assert response.status_code == 403


def test_학부모는_교사_API를_쓸_수_없다(client, db):
    class_id = _class(db, _center(db))
    _parent()

    response = client.post(
        f"/api/v1/classes/{class_id}/notices", json={"title": "a", "content": "b"}
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_교사는_학부모_공지_API를_쓸_수_없다(client, db):
    center_id = _center(db)
    child_id = _child(db, _class(db, center_id))
    _teacher(center_id)

    response = client.get(f"/api/v1/children/{child_id}/notices")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_목록은_최신순이고_커서로_이어_받는다(client, db):
    center_id = _center(db)
    class_id = _class(db, center_id)
    _teacher(center_id)
    ids = [
        client.post(
            f"/api/v1/classes/{class_id}/notices", json={"title": f"공지{n}", "content": "본문"}
        ).json()["notice_id"]
        for n in range(3)
    ]

    first = client.get(f"/api/v1/classes/{class_id}/notices", params={"limit": 2}).json()
    second = client.get(
        f"/api/v1/classes/{class_id}/notices",
        params={"limit": 2, "cursor": first["next_cursor"]},
    ).json()

    got = [item["notice_id"] for item in first["items"] + second["items"]]
    assert sorted(got) == sorted(ids)
    assert len(set(got)) == 3
    assert first["next_cursor"] is not None
    assert second["next_cursor"] is None


def test_읽을_수_없는_커서는_400(client, db):
    center_id = _center(db)
    class_id = _class(db, center_id)
    _teacher(center_id)

    response = client.get(f"/api/v1/classes/{class_id}/notices", params={"cursor": "abc"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_CURSOR"


def test_학부모는_자녀_반의_공지만_본다(client, db):
    center_id = _center(db)
    my_class = _class(db, center_id)
    sibling_class = _class(db, center_id, "달님반")
    child_id = _child(db, my_class)
    shown = _notice(db, my_class, title="우리 반")
    hidden_same_center = _notice(db, sibling_class, title="옆 반")
    hidden_other_center = _notice(db, _class(db, _center(db)), title="다른 원")
    _parent()

    listed = client.get(f"/api/v1/children/{child_id}/notices").json()

    assert [item["notice_id"] for item in listed["items"]] == [str(shown.id)]
    assert "author_teacher_id" not in listed["items"][0]
    for hidden in (hidden_same_center, hidden_other_center):
        response = client.get(f"/api/v1/children/{child_id}/notices/{hidden.id}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "NOTICE_NOT_FOUND"
    detail = client.get(f"/api/v1/children/{child_id}/notices/{shown.id}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "우리 반"


def test_학부모는_자기_자녀가_아닌_child_id로_공지를_볼_수_없다(client, db):
    center_id = _center(db)
    class_id = _class(db, center_id)
    notice = _notice(db, class_id)
    stranger_child = uuid.uuid4()
    _parent()

    for path in (
        f"/api/v1/children/{stranger_child}/notices",
        f"/api/v1/children/{stranger_child}/notices/{notice.id}",
    ):
        response = client.get(path)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert _logs(db) == []


def test_졸업_후_열람_기간이_지나면_403_CHILD_ACCESS_EXPIRED(client, db):
    class_id = _class(db, _center(db))
    child_id = _child(db, class_id, graduated_at=date(2020, 1, 1))
    notice = _notice(db, class_id)
    _parent()

    for path in (
        f"/api/v1/children/{child_id}/notices",
        f"/api/v1/children/{child_id}/notices/{notice.id}",
    ):
        response = client.get(path)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "CHILD_ACCESS_EXPIRED"
    assert _logs(db) == []


def test_NFR05_학부모_열람은_AccessLog를_남긴다(client, db):
    class_id = _class(db, _center(db))
    child_id = _child(db, class_id)
    first = _notice(db, class_id, title="하나")
    second = _notice(db, class_id, title="둘")
    _parent()

    client.get(f"/api/v1/children/{child_id}/notices")
    client.get(f"/api/v1/children/{child_id}/notices/{first.id}")

    logs = _logs(db)
    assert {(target, action, target_id) for target, action, target_id in logs} == {
        ("notice", "view_list", first.id),
        ("notice", "view_list", second.id),
        ("notice", "view_detail", first.id),
    }
    row = db.scalar(select(AccessLog))
    assert row.actor_type == "parent"
    assert row.actor_id == PARENT_ID


def test_교사_조회는_AccessLog를_남기지_않는다(client, db):
    center_id = _center(db)
    class_id = _class(db, center_id)
    notice = _notice(db, class_id)
    _teacher(center_id)

    client.get(f"/api/v1/classes/{class_id}/notices")
    client.get(f"/api/v1/notices/{notice.id}")

    assert _logs(db) == []
