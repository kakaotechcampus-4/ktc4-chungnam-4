import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.organization import service
from domains.organization.models import Center, EducationPlan, Klass, TeacherPersona
from main import app


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            EducationPlan.__table__,
            TeacherPersona.__table__,
        ],
    )
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _login_as_teacher(center_id: UUID | None, teacher_id: UUID | None = None) -> UUID:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=teacher_id or uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile
    return profile.teacher_id


def _center(db: Session) -> UUID:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    return center.id


def _class(db: Session, center_id: UUID) -> UUID:
    klass = Klass(center_id=center_id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    return klass.id


def _weekly_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "plan_type": "weekly",
        "start_date": "2026-09-14",
        "end_date": "2026-09-18",
        "title": "알록달록 블록과 모양",
        "goal": "여러 가지 모양의 블록으로 구성해요.",
        "daily_activities": {"mon": "모양 블록 탐색", "tue": "색깔별로 모으기"},
        "domains": ["nature", "art"],
    }
    body.update(overrides)
    return body


def _plan(
    db: Session,
    class_id: UUID,
    *,
    plan_type: str = "weekly",
    start: date = date(2026, 9, 14),
    end: date = date(2026, 9, 18),
    title: str = "계획",
) -> UUID:
    plan = EducationPlan(
        class_id=class_id,
        teacher_id=uuid.uuid4(),
        plan_type=plan_type,
        start_date=start,
        end_date=end,
        title=title,
        content="목표",
        daily_activities={},
        domains=[],
    )
    db.add(plan)
    db.flush()
    return plan.id


def test_교육_계획을_등록하면_goal로_돌려주고_작성_교사를_남긴다(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    teacher_id = _login_as_teacher(db.get(Klass, class_id).center_id)

    response = client.post(f"/api/v1/classes/{class_id}/education-plans", json=_weekly_body())

    assert response.status_code == 201
    body = response.json()
    assert body["class_id"] == str(class_id)
    assert body["goal"] == "여러 가지 모양의 블록으로 구성해요."
    assert body["daily_activities"] == {"mon": "모양 블록 탐색", "tue": "색깔별로 모으기"}
    assert body["domains"] == ["nature", "art"]
    assert "teacher_id" not in body
    saved = db.get(EducationPlan, UUID(body["plan_id"]))
    assert saved.teacher_id == teacher_id
    assert saved.content == body["goal"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"end_date": "2026-09-13"},
        {"plan_type": "monthly"},  # 월간인데 요일별 놀이가 있음
        {"domains": ["art", "art"]},
        {"domains": ["music"]},
        {"daily_activities": {"sat": "소풍"}},
        {"title": "   "},
    ],
)
def test_맞지_않는_계획은_VALIDATION_ERROR(
    client: TestClient, db: Session, overrides: dict[str, Any]
):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(db.get(Klass, class_id).center_id)

    response = client.post(
        f"/api/v1/classes/{class_id}/education-plans", json=_weekly_body(**overrides)
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert db.query(EducationPlan).count() == 0


def test_월간_계획은_요일별_놀이_없이_등록한다(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(db.get(Klass, class_id).center_id)

    response = client.post(
        f"/api/v1/classes/{class_id}/education-plans",
        json=_weekly_body(
            plan_type="monthly", start_date="2026-09-01", end_date="2026-09-30", daily_activities={}
        ),
    )

    assert response.status_code == 201
    assert response.json()["daily_activities"] == {}


def test_목록은_시작일_최신순이고_plan_type으로_거른다(client: TestClient, db: Session):
    center_id = _center(db)
    class_id = _class(db, center_id)
    older = _plan(db, class_id, start=date(2026, 9, 7), end=date(2026, 9, 11))
    newer = _plan(db, class_id, start=date(2026, 9, 14), end=date(2026, 9, 18))
    monthly = _plan(
        db, class_id, plan_type="monthly", start=date(2026, 9, 1), end=date(2026, 9, 30)
    )
    _plan(db, _class(db, center_id))  # 같은 어린이집 다른 반
    db.commit()
    _login_as_teacher(center_id)

    everything = client.get(f"/api/v1/classes/{class_id}/education-plans")
    weekly = client.get(f"/api/v1/classes/{class_id}/education-plans?plan_type=weekly")

    assert [item["plan_id"] for item in everything.json()["items"]] == [
        str(newer),
        str(older),
        str(monthly),
    ]
    assert everything.json()["next_cursor"] is None
    assert [item["plan_id"] for item in weekly.json()["items"]] == [str(newer), str(older)]


def test_수정은_보낸_필드만_바꾼다(client: TestClient, db: Session):
    center_id = _center(db)
    plan_id = _plan(db, _class(db, center_id), title="처음 제목")
    db.commit()
    _login_as_teacher(center_id)

    response = client.patch(
        f"/api/v1/education-plans/{plan_id}", json={"goal": "바뀐 목표", "domains": ["social"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "처음 제목"
    assert body["goal"] == "바뀐 목표"
    assert body["domains"] == ["social"]
    assert client.get(f"/api/v1/education-plans/{plan_id}").json()["goal"] == "바뀐 목표"


@pytest.mark.parametrize(
    "patch",
    [
        {"title": None},
        {"end_date": "2026-09-01"},  # 기존 시작일(9/14)보다 앞
        {"plan_type": "monthly", "daily_activities": {"mon": "산책"}},
    ],
)
def test_수정_결과가_맞지_않으면_바꾸지_않는다(
    client: TestClient, db: Session, patch: dict[str, Any]
):
    center_id = _center(db)
    plan_id = _plan(db, _class(db, center_id), title="처음 제목")
    db.commit()
    _login_as_teacher(center_id)

    response = client.patch(f"/api/v1/education-plans/{plan_id}", json=patch)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    db.expire_all()
    saved = db.get(EducationPlan, plan_id)
    assert saved.title == "처음 제목"
    assert saved.end_date == date(2026, 9, 18)
    assert saved.plan_type == "weekly"


def test_삭제하면_다시_조회할_때_PLAN_NOT_FOUND(client: TestClient, db: Session):
    center_id = _center(db)
    plan_id = _plan(db, _class(db, center_id))
    db.commit()
    _login_as_teacher(center_id)

    deleted = client.delete(f"/api/v1/education-plans/{plan_id}")
    again = client.get(f"/api/v1/education-plans/{plan_id}")

    assert deleted.status_code == 204
    assert again.status_code == 404
    assert again.json()["error"]["code"] == "PLAN_NOT_FOUND"


@pytest.mark.parametrize(
    ("method", "body"),
    [("get", None), ("patch", {"title": "남의 계획"}), ("delete", None)],
)
def test_다른_어린이집_계획은_CLASS_ACCESS_DENIED(
    client: TestClient, db: Session, method: str, body: dict[str, Any] | None
):
    plan_id = _plan(db, _class(db, _center(db)), title="처음 제목")
    db.commit()
    _login_as_teacher(_center(db))

    response = client.request(method, f"/api/v1/education-plans/{plan_id}", json=body)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"
    db.expire_all()
    assert db.get(EducationPlan, plan_id).title == "처음 제목"


def test_다른_어린이집_반에는_등록하지_못한다(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    _login_as_teacher(_center(db))

    listed = client.get(f"/api/v1/classes/{class_id}/education-plans")
    created = client.post(f"/api/v1/classes/{class_id}/education-plans", json=_weekly_body())

    assert listed.status_code == 403
    assert created.status_code == 403
    assert db.query(EducationPlan).count() == 0


def test_없는_반은_CLASS_NOT_FOUND(client: TestClient, db: Session):
    center_id = _center(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/classes/{uuid.uuid4()}/education-plans")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "CLASS_NOT_FOUND"


def test_학부모는_교육_계획에_접근하지_못한다(client: TestClient, db: Session):
    class_id = _class(db, _center(db))
    db.commit()
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = client.get(f"/api/v1/classes/{class_id}/education-plans")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_그날이_기간에_드는_계획을_주간부터_돌려준다(db: Session):
    class_id = _class(db, _center(db))
    monthly = _plan(
        db, class_id, plan_type="monthly", start=date(2026, 9, 1), end=date(2026, 9, 30)
    )
    weekly = _plan(db, class_id, start=date(2026, 9, 14), end=date(2026, 9, 18))
    _plan(db, class_id, start=date(2026, 9, 21), end=date(2026, 9, 25))  # 기간 밖

    plans = service.get_activity_plans_for_date(db, class_id, date(2026, 9, 16))

    assert [plan.plan_id for plan in plans] == [weekly, monthly]
    assert plans[0].goal == "목표"


def test_교사_페르소나는_가장_높은_버전을_돌려준다(db: Session):
    teacher_id = uuid.uuid4()
    for version in (1, 2):
        db.add(
            TeacherPersona(
                teacher_id=teacher_id,
                tone_summary=f"v{version}",
                style_rules=["존댓말"],
                sample_phrases=[],
                version=version,
            )
        )
    db.flush()

    persona = service.get_teacher_persona(db, teacher_id)

    assert persona is not None
    assert persona.version == 2
    assert persona.tone_summary == "v2"
    assert service.get_teacher_persona(db, uuid.uuid4()) is None
