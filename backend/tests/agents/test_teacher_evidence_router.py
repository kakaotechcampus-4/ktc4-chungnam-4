"""추가 근거(교사 관찰 메모) API — GET /classes/{class_id}/evidence,
PUT /children/{child_id}/evidence/{record_date} (FR-05, docs/api/agents.md §추가 근거).

로그인 교사만 바꿔 끼우고, 반·원아 접근은 organization 판정 함수가, 열람 기록은 audit이 실제
행으로 처리하게 둡니다. 에러는 HTTP 상태와 `error.code`로 봅니다.
"""

import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents.models import TeacherEvidence
from domains.agents.schemas import TEACHER_EVIDENCE_TEXT_MAX_LENGTH
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_teacher
from domains.auth.service import TeacherProfile
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
OTHER_TEACHER_ID = uuid.uuid4()
CENTER_ID = uuid.uuid4()
OTHER_CENTER_ID = uuid.uuid4()
CLASS_ID = uuid.uuid4()
OTHER_CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
YERIN = uuid.uuid4()
OTHER_CHILD = uuid.uuid4()
DAY = date(2026, 9, 15)


@pytest.fixture
def session_factory() -> sessionmaker[Session]:
    # TestClient는 동기 라우트를 다른 스레드에서 돌리므로 연결 하나를 같이 씁니다.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            TeacherEvidence.__table__,
            AccessLog.__table__,
        ],
    )
    factory = sessionmaker(bind=engine)
    with factory() as db:
        for center_id, code in ((CENTER_ID, "sunshine"), (OTHER_CENTER_ID, "moonlight")):
            db.add(Center(id=center_id, center_code=code, name=code, contract_status="trial"))
        db.flush()
        for class_id, center_id, teacher_id in (
            (CLASS_ID, CENTER_ID, TEACHER_ID),
            (OTHER_CLASS_ID, OTHER_CENTER_ID, OTHER_TEACHER_ID),
        ):
            db.add(
                Klass(
                    id=class_id,
                    center_id=center_id,
                    teacher_id=teacher_id,
                    name="해바라기반",
                    age_group="만 4세",
                )
            )
        db.flush()
        for child_id, class_id in (
            (DOYUN, CLASS_ID),
            (YERIN, CLASS_ID),
            (OTHER_CHILD, OTHER_CLASS_ID),
        ):
            db.add(
                Child(
                    id=child_id,
                    class_id=class_id,
                    name="합성원아",
                    birth_date=date(2021, 5, 1),
                    status="enrolled",
                    enrolled_at=date(2025, 3, 1),
                )
            )
        db.commit()
    return factory


@pytest.fixture
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    def override_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    _login_as(CENTER_ID)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def _login_as(center_id: uuid.UUID | None, teacher_id: uuid.UUID = TEACHER_ID) -> None:
    app.dependency_overrides[get_current_teacher] = lambda: TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=teacher_id,
        center_id=center_id,
    )


def _put(client: TestClient, child_id: uuid.UUID, day: date = DAY, **body: str):
    payload = {"activity_time": "10:30", "text": "나뭇잎을 모아 크기를 비교했어요."} | body
    return client.put(f"/api/v1/children/{child_id}/evidence/{day}", json=payload)


def _error_code(response) -> str:
    return response.json()["error"]["code"]


def test_처음_저장은_201_다시_저장은_200으로_덮어쓰고_아이_날짜당_한_건이다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    first = _put(client, DOYUN)
    assert first.status_code == 201
    body = first.json()
    assert body["child_id"] == str(DOYUN)
    assert body["record_date"] == str(DAY)
    assert body["activity_time"] == "10:30"
    assert body["text"] == "나뭇잎을 모아 크기를 비교했어요."
    assert body["source"] == "teacher_note"

    second = _put(client, DOYUN, activity_time="15:10", text="  블록으로 탑을 쌓았어요.  ")
    assert second.status_code == 200
    assert second.json()["evidence_id"] == body["evidence_id"]
    # 앞뒤 공백은 지우고 저장한다
    assert second.json()["text"] == "블록으로 탑을 쌓았어요."
    assert second.json()["activity_time"] == "15:10"

    with session_factory() as db:
        rows = list(db.scalars(select(TeacherEvidence)))
    assert len(rows) == 1
    assert rows[0].author_teacher_id == TEACHER_ID


def test_반_조회는_그날_우리_반_메모만_주고_메모마다_열람_기록을_남긴다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    _put(client, DOYUN)
    _put(client, YERIN, text="친구를 도와 줬어요.")
    _put(client, DOYUN, day=DAY - timedelta(days=1), text="어제 메모")
    _login_as(OTHER_CENTER_ID, OTHER_TEACHER_ID)
    _put(client, OTHER_CHILD, text="다른 어린이집 메모")
    _login_as(CENTER_ID)

    response = client.get(f"/api/v1/classes/{CLASS_ID}/evidence", params={"record_date": str(DAY)})

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["child_id"] for item in items} == {str(DOYUN), str(YERIN)}
    assert {item["text"] for item in items} == {
        "나뭇잎을 모아 크기를 비교했어요.",
        "친구를 도와 줬어요.",
    }
    assert response.json()["next_cursor"] is None
    with session_factory() as db:
        logs = list(
            db.scalars(select(AccessLog).where(AccessLog.target_type == "teacher_evidence"))
        )
    assert {log.target_id for log in logs} == {uuid.UUID(item["evidence_id"]) for item in items}
    assert all(log.actor_type == "teacher" and log.actor_id == TEACHER_ID for log in logs)
    assert all(log.action == "view_list" for log in logs)


def test_메모가_없는_날은_빈_목록이고_열람_기록도_없다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = client.get(f"/api/v1/classes/{CLASS_ID}/evidence", params={"record_date": str(DAY)})

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    with session_factory() as db:
        assert db.scalars(select(AccessLog)).first() is None


def test_다른_어린이집_원아에는_저장하지_못한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = _put(client, OTHER_CHILD)

    assert response.status_code == 403
    assert _error_code(response) == "CHILD_ACCESS_DENIED"
    with session_factory() as db:
        assert db.scalars(select(TeacherEvidence)).first() is None


def test_다른_어린이집_반은_조회하지_못한다(client: TestClient) -> None:
    response = client.get(
        f"/api/v1/classes/{OTHER_CLASS_ID}/evidence", params={"record_date": str(DAY)}
    )

    assert response.status_code == 403
    assert _error_code(response) == "CLASS_ACCESS_DENIED"


def test_없는_원아와_없는_반은_404(client: TestClient) -> None:
    missing = uuid.uuid4()
    assert _put(client, missing).status_code == 404
    response = client.get(f"/api/v1/classes/{missing}/evidence", params={"record_date": str(DAY)})
    assert response.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"text": ""},
        {"text": "   "},
        {"activity_time": "25:00"},
        {"activity_time": "9:30"},
        {"activity_time": ""},
    ],
)
def test_빈_내용과_잘못된_시각은_422로_거절한다(
    client: TestClient, session_factory: sessionmaker[Session], body: dict[str, str]
) -> None:
    response = _put(client, DOYUN, **body)

    assert response.status_code == 422
    with session_factory() as db:
        assert db.scalars(select(TeacherEvidence)).first() is None


def test_글자_수_상한까지는_저장하고_넘으면_422로_거절한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    limit = TEACHER_EVIDENCE_TEXT_MAX_LENGTH

    over = _put(client, DOYUN, text="가" * (limit + 1))
    assert over.status_code == 422
    assert _error_code(over) == "VALIDATION_ERROR"
    with session_factory() as db:
        assert db.scalars(select(TeacherEvidence)).first() is None

    # 앞뒤 공백은 세지 않는다
    exact = _put(client, DOYUN, text=f"  {'가' * limit}  ")
    assert exact.status_code == 201
    assert len(exact.json()["text"]) == limit


def test_상한을_넘어_거절한_응답에는_입력한_글이_실리지_않는다(client: TestClient) -> None:
    # 공통 검증 핸들러(main.py)가 입력값과 msg를 응답에서 뺀다는 사실을 회귀 테스트로 남긴다(H-4).
    response = _put(
        client, DOYUN, text="서연이가 말했어요. " + "가" * TEACHER_EVIDENCE_TEXT_MAX_LENGTH
    )

    assert response.status_code == 422
    assert "서연이가" not in response.text


def test_저장된_메모를_상한을_넘는_글로_덮어쓰려_하면_422이고_기존_메모는_그대로다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    assert _put(client, DOYUN).status_code == 201

    response = _put(client, DOYUN, text="가" * (TEACHER_EVIDENCE_TEXT_MAX_LENGTH + 1))

    assert response.status_code == 422
    with session_factory() as db:
        row = db.scalars(select(TeacherEvidence)).one()
    assert row.text == "나뭇잎을 모아 크기를 비교했어요."


def test_오늘보다_뒤_날짜는_거절한다(client: TestClient) -> None:
    tomorrow = datetime.now(ZoneInfo("Asia/Seoul")).date() + timedelta(days=1)

    response = _put(client, DOYUN, day=tomorrow)

    assert response.status_code == 400
    assert _error_code(response) == "INVALID_RECORD_DATE"
