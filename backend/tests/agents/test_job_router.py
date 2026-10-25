"""초안 생성 작업 API — POST /classes/{class_id}/jobs, GET /jobs/{job_id} (FR-05, FR-06, FR-26).

로그인 교사와 Celery 큐 넣기만 바꿔 끼우고, 반 접근은 organization 판정 함수가, 미디어 준비·
대상 원아는 media 함수가 실제 행으로 판단하게 둡니다. 에러는 HTTP 상태와 `error.code`로 봅니다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents import router as agents_router
from domains.agents.models import GenerationJob, Job, JobStatus
from domains.auth.middleware import get_current_teacher
from domains.auth.service import TeacherProfile
from domains.media.models import MediaAsset, MediaChildLink
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
CENTER_ID = uuid.uuid4()
CLASS_ID = uuid.uuid4()
DOYUN = uuid.uuid4()
YERIN = uuid.uuid4()
DAY = date(2026, 9, 15)
# 한국 10:10 = UTC 01:10. 같은 날짜입니다.
MORNING = datetime(2026, 9, 15, 1, 10, tzinfo=UTC)


@pytest.fixture
def session_factory() -> sessionmaker[Session]:
    # TestClient는 동기 라우트를 다른 스레드에서 돌리므로 연결 하나를 같이 씁니다.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine,
        tables=[
            GenerationJob.__table__,
            Job.__table__,
            MediaAsset.__table__,
            MediaChildLink.__table__,
            Center.__table__,
            Klass.__table__,
            Child.__table__,
        ],
    )
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(
            Center(
                id=CENTER_ID, center_code="sunshine", name="햇살어린이집", contract_status="trial"
            )
        )
        db.flush()
        db.add(
            Klass(
                id=CLASS_ID,
                center_id=CENTER_ID,
                teacher_id=TEACHER_ID,
                name="해바라기반",
                age_group="만 4세",
            )
        )
        for child_id in (DOYUN, YERIN):
            db.add(
                Child(
                    id=child_id,
                    class_id=CLASS_ID,
                    name="합성원아",
                    birth_date=date(2021, 5, 1),
                    status="enrolled",
                    enrolled_at=date(2025, 3, 1),
                )
            )
        db.commit()
    return factory


@pytest.fixture
def enqueued(monkeypatch: pytest.MonkeyPatch) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Celery에 실제로 넣지 않고 넣으려던 (Job id, child_id)를 모읍니다."""
    calls: list[tuple[uuid.UUID, uuid.UUID]] = []
    monkeypatch.setattr(agents_router, "enqueue_generate_drafts", calls.extend)
    return calls


@pytest.fixture
def client(
    session_factory: sessionmaker[Session], enqueued: list[tuple[uuid.UUID, uuid.UUID]]
) -> Iterator[TestClient]:
    def override_db() -> Iterator[Session]:
        with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    _login_as(CENTER_ID)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


def _login_as(center_id: uuid.UUID | None) -> None:
    app.dependency_overrides[get_current_teacher] = lambda: TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )


def _add_photo(
    factory: sessionmaker[Session],
    *child_ids: uuid.UUID,
    captured_at: datetime = MORNING,
    attributed: bool = True,
) -> uuid.UUID:
    media_id = uuid.uuid4()
    with factory() as db:
        db.add(
            MediaAsset(
                id=media_id,
                client_photo_id=uuid.uuid4(),
                class_id=CLASS_ID,
                teacher_id=TEACHER_ID,
                type="photo",
                captured_at=captured_at,
                storage_url=f"s3://bucket/{media_id}.jpg",
                size_bytes=2048,
                llm_allowed=True,
                attributed_at=captured_at if attributed else None,
            )
        )
        db.flush()
        for child_id in child_ids:
            db.add(MediaChildLink(media_id=media_id, child_id=child_id, method="manual"))
        db.commit()
    return media_id


def _body(*media_ids: uuid.UUID, request_id: uuid.UUID | None = None) -> dict:
    return {
        "request_id": str(request_id or uuid.uuid4()),
        "record_date": DAY.isoformat(),
        "media_ids": [str(media_id) for media_id in media_ids],
    }


def _start(client: TestClient, body: dict):
    return client.post(f"/api/v1/classes/{CLASS_ID}/jobs", json=body)


def _error_code(response) -> str:
    return response.json()["error"]["code"]


def _set_status(factory: sessionmaker[Session], child_id: uuid.UUID, status: JobStatus) -> None:
    with factory() as db:
        job = db.scalar(select(Job).where(Job.child_id == child_id))
        job.status = status.value
        db.commit()


def test_귀속된_자료가_있는_원아마다_Job을_만들고_커밋_뒤_큐에_넣는다(
    client: TestClient, session_factory: sessionmaker[Session], enqueued: list
) -> None:
    photo = _add_photo(session_factory, DOYUN, YERIN)

    response = _start(client, _body(photo))

    assert response.status_code == 202
    body = response.json()
    assert response.headers["Location"] == f"/api/v1/jobs/{body['job_id']}"
    assert body["status"] == "pending"
    assert body["progress"] == {"percent": 0, "total_children": 2, "finished_children": 0}
    assert {child["child_id"] for child in body["children"]} == {str(DOYUN), str(YERIN)}
    with session_factory() as db:
        jobs = db.scalars(select(Job)).all()
        generation_job = db.get(GenerationJob, uuid.UUID(body["job_id"]))
        # 비동기 task가 초안의 작성 교사로 쓴다 (FR-26)
        assert generation_job.requested_by_teacher_id == TEACHER_ID
    assert sorted(enqueued) == sorted((job.id, job.child_id) for job in jobs)


def test_같은_request_id로_다시_부르면_기존_작업을_돌려주고_큐에_다시_넣지_않는다(
    client: TestClient, session_factory: sessionmaker[Session], enqueued: list
) -> None:
    photo = _add_photo(session_factory, DOYUN)
    body = _body(photo)

    first = _start(client, body)
    second = _start(client, body)

    assert second.status_code == 202
    assert second.json()["job_id"] == first.json()["job_id"]
    assert len(enqueued) == 1


def test_다른_어린이집_교사는_작업을_시작하지_못한다(
    client: TestClient, session_factory: sessionmaker[Session], enqueued: list
) -> None:
    photo = _add_photo(session_factory, DOYUN)
    _login_as(uuid.uuid4())

    response = _start(client, _body(photo))

    assert response.status_code == 403
    assert _error_code(response) == "CLASS_ACCESS_DENIED"
    assert enqueued == []


def test_없는_반이면_404(client: TestClient) -> None:
    response = client.post(f"/api/v1/classes/{uuid.uuid4()}/jobs", json=_body())

    assert response.status_code == 404
    assert _error_code(response) == "CLASS_NOT_FOUND"


def test_오늘보다_뒤_날짜는_거절한다(client: TestClient) -> None:
    body = {**_body(), "record_date": "2999-01-01"}

    response = _start(client, body)

    assert response.status_code == 400
    assert _error_code(response) == "INVALID_RECORD_DATE"


def test_귀속_저장_전이거나_없는_미디어가_있으면_그_ID를_담아_409(
    client: TestClient, session_factory: sessionmaker[Session], enqueued: list
) -> None:
    ready = _add_photo(session_factory, DOYUN)
    not_attributed = _add_photo(session_factory, DOYUN, attributed=False)
    unknown = uuid.uuid4()

    response = _start(client, _body(ready, not_attributed, unknown))

    assert response.status_code == 409
    assert _error_code(response) == "MEDIA_NOT_READY"
    assert response.json()["error"]["detail"]["media_ids"] == [str(not_attributed), str(unknown)]
    assert enqueued == []


def test_다른_날짜의_미디어도_준비되지_않은_것으로_본다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    # 한국 9/16 00:10 = UTC 9/15 15:10. UTC로는 같은 날이지만 KST로는 다음 날입니다.
    next_day = _add_photo(
        session_factory, DOYUN, captured_at=datetime(2026, 9, 15, 15, 10, tzinfo=UTC)
    )

    response = _start(client, _body(next_day))

    assert _error_code(response) == "MEDIA_NOT_READY"


def test_그_날짜에_귀속된_원아가_없으면_409(client: TestClient) -> None:
    response = _start(client, _body())

    assert response.status_code == 409
    assert _error_code(response) == "NO_TARGET_CHILDREN"


def test_같은_반_날짜에_진행_중인_작업이_있으면_그_job_id를_담아_409(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    photo = _add_photo(session_factory, DOYUN)
    first = _start(client, _body(photo))

    response = _start(client, _body(photo))

    assert response.status_code == 409
    assert _error_code(response) == "JOB_ALREADY_RUNNING"
    assert response.json()["error"]["detail"]["job_id"] == first.json()["job_id"]


def test_앞선_작업이_끝났으면_같은_날짜로_다시_시작할_수_있다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    photo = _add_photo(session_factory, DOYUN)
    first = _start(client, _body(photo))
    _set_status(session_factory, DOYUN, JobStatus.SUCCEEDED)

    response = _start(client, _body(photo))

    assert response.status_code == 202
    assert response.json()["job_id"] != first.json()["job_id"]


def test_폴링은_원아별_상태로_반_전체_상태와_진행률을_계산한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    photo = _add_photo(session_factory, DOYUN, YERIN)
    job_id = _start(client, _body(photo)).json()["job_id"]

    _set_status(session_factory, DOYUN, JobStatus.SUCCEEDED)
    _set_status(session_factory, YERIN, JobStatus.RUNNING)
    running = client.get(f"/api/v1/jobs/{job_id}").json()

    _set_status(session_factory, YERIN, JobStatus.FAILED)
    finished = client.get(f"/api/v1/jobs/{job_id}").json()

    assert running["status"] == "running"
    assert running["progress"] == {"percent": 50, "total_children": 2, "finished_children": 1}
    # 실패가 1명이라도 있으면 failed. 나머지 원아의 초안은 검토할 수 있습니다.
    assert finished["status"] == "failed"
    assert finished["progress"]["percent"] == 100
    assert {child["child_id"]: child["status"] for child in finished["children"]} == {
        str(DOYUN): "succeeded",
        str(YERIN): "failed",
    }


def test_없는_작업을_조회하면_404(client: TestClient) -> None:
    response = client.get(f"/api/v1/jobs/{uuid.uuid4()}")

    assert response.status_code == 404
    assert _error_code(response) == "JOB_NOT_FOUND"


def test_다른_어린이집_교사는_작업을_조회하지_못한다(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    photo = _add_photo(session_factory, DOYUN)
    job_id = _start(client, _body(photo)).json()["job_id"]
    _login_as(uuid.uuid4())

    response = client.get(f"/api/v1/jobs/{job_id}")

    assert response.status_code == 403
    assert _error_code(response) == "CLASS_ACCESS_DENIED"
