"""FR-23~28: 신규 교사 준비부터 보호자 연결·선택 동의·접근 경계를 실제 API로 검사합니다."""

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, DropSchema

from core.base import Base
from core.database import get_db
from domains.auth.models import Account, ParentInvite
from domains.organization import service as organization
from domains.organization.models import ConsentRecord, ParentChildRelation
from main import app


@pytest.fixture
def flow() -> Iterator[tuple[TestClient, Session]]:
    database_url = os.environ.get("PHOTO_PIPELINE_TEST_DATABASE_URL")
    schema = f"invite_test_{uuid4().hex}"
    if database_url:
        url = make_url(database_url)
        if url.host not in {"localhost", "127.0.0.1"} or url.database != "photo_integration":
            raise ValueError("Use only the local photo_integration test database")
        engine = create_engine(url, hide_parameters=True)
        with engine.begin() as conn:
            conn.execute(CreateSchema(schema))
        engine = engine.execution_options(schema_translate_map={None: schema})
    else:
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    Base.metadata.create_all(engine)
    db = sessionmaker(engine, autoflush=False, expire_on_commit=False)()
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as client:
        yield client, db
    app.dependency_overrides.clear()
    db.close()
    if database_url:
        Base.metadata.drop_all(engine)
        with engine.begin() as conn:
            conn.execute(DropSchema(schema))
    engine.dispose()


def prepare(client: TestClient, *, email: str = "teacher@example.com") -> tuple[str, str]:
    response = client.post(
        "/api/v1/accounts",
        json={
            "email": email,
            "password": "test-only",
            "name": "예시교사",
            "new_center": {"name": "시연어린이집", "address": "시연 주소"},
        },
    )
    assert response.status_code == 201, response.text
    center = response.json()
    assert client.get("/api/v1/me").json()["center_id"] == center["center_id"]
    response = client.post(
        "/api/v1/classes",
        json={"center_id": center["center_id"], "name": "새싹반", "age_band": "preschool"},
    )
    assert response.status_code == 201, response.text
    klass = response.json()["class_id"]
    response = client.post(
        f"/api/v1/classes/{klass}/children",
        json={"class_id": klass, "name": "합성원아", "birth_date": "2022-01-01"},
    )
    assert response.status_code == 201, response.text
    child = response.json()["child_id"]
    assert response.json()["consent_agreed_count"] == 0
    assert client.get(f"/api/v1/children/{child}").status_code == 200
    overview = client.get(f"/api/v1/children/{child}/overview")
    assert overview.status_code == 200, overview.text
    assert overview.json() == {"recent_notes": [], "domain_counts": None}
    return klass, child


def issue(client: TestClient, child: str) -> str:
    response = client.post(f"/api/v1/children/{child}/parent-invites")
    assert response.status_code == 201, response.text
    return response.json()["invite_url"].rsplit("/", 1)[-1]


def body(*, face: bool = False) -> dict:
    return {
        "email": "parent@example.com",
        "password": "test-only",
        "name": "예시보호자",
        "is_legal_guardian": True,
        "consents": {"personal_info": True, "activity_media": True, "face_feature": face},
    }


def test_가입_반_원아_초대_선택미동의_학부모연결(flow):
    client, db = flow
    klass, child = prepare(client)
    token = issue(client, child)
    saved = db.scalar(select(ParentInvite))
    assert saved.token_hash != token and len(saved.token_hash) == 64
    client.delete("/api/v1/sessions/current")
    preview = client.get(f"/api/v1/parent-invites/{token}")
    assert preview.status_code == 200
    assert "birth_date" not in preview.json()
    assert preview.headers["cache-control"] == "no-store"
    accepted = client.post(f"/api/v1/parent-invites/{token}/accept", json=body())
    assert accepted.status_code == 201, accepted.text
    assert client.get("/api/v1/me").json()["account_type"] == "parent"
    assert client.get("/api/v1/me/children").json()["items"][0]["child_id"] == child
    assert not organization.has_consent(db, UUID(child), "face_feature")
    assert organization.has_consent(db, UUID(child), "activity_media")
    assert client.get(f"/api/v1/children/{child}/parent-notes").status_code == 200
    assert client.post(f"/api/v1/parent-invites/{token}/accept", json=body()).status_code == 410
    assert db.scalar(select(func.count()).select_from(ParentChildRelation)) == 1
    assert db.scalar(select(func.count()).select_from(ConsentRecord)) == 2
    client.post("/api/v1/sessions", json={"email": "teacher@example.com", "password": "test-only"})
    detail = client.get(f"/api/v1/children/{child}").json()
    assert detail["parent_linked"] and detail["consent_agreed_count"] == 2
    assert not detail["face_feature_agreed"]
    assert client.get(f"/api/v1/classes/{klass}/children").json()["items"][0]["parent_linked"]


def test_재발급과만료는_계정이나동의없이_거절(flow):
    client, db = flow
    _, child = prepare(client)
    old = issue(client, child)
    current = issue(client, child)
    assert client.get(f"/api/v1/parent-invites/{old}").status_code == 410
    invite = db.scalar(select(ParentInvite).where(ParentInvite.revoked_at.is_(None)))
    invite.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    client.delete("/api/v1/sessions/current")
    for token in [old, current, "unknown-token"]:
        assert client.post(f"/api/v1/parent-invites/{token}/accept", json=body()).status_code == 410
    assert db.scalar(select(func.count()).select_from(Account)) == 1
    assert db.scalar(select(func.count()).select_from(ConsentRecord)) == 0


@pytest.mark.parametrize("missing", ["personal_info", "activity_media", "is_legal_guardian"])
def test_필수동의가없으면_초대가소비되지않음(flow, missing):
    client, db = flow
    _, child = prepare(client)
    token = issue(client, child)
    client.delete("/api/v1/sessions/current")
    payload = body()
    if missing == "is_legal_guardian":
        payload[missing] = False
    else:
        payload["consents"][missing] = False
    assert client.post(f"/api/v1/parent-invites/{token}/accept", json=payload).status_code == 422
    assert db.scalar(select(ParentInvite)).consumed_at is None


def test_다른원교사는_초대를발급하거나_상세열람불가(flow):
    client, _ = flow
    _, child = prepare(client)
    prepare(client, email="other@example.com")
    assert client.post(f"/api/v1/children/{child}/parent-invites").status_code == 403
    assert client.get(f"/api/v1/children/{child}").status_code == 403


def test_기존학부모는_로그인으로_다른자녀를연결하고_동의실패는롤백(flow, monkeypatch):
    client, db = flow
    klass, first = prepare(client)
    token = issue(client, first)
    # 교사 세션으로 수락은 막습니다.
    assert client.post(f"/api/v1/parent-invites/{token}/accept", json=body()).status_code == 403
    client.delete("/api/v1/sessions/current")
    assert (
        client.post(f"/api/v1/parent-invites/{token}/accept", json=body(face=True)).status_code
        == 201
    )
    assert organization.has_consent(db, UUID(first), "face_feature")
    client.post("/api/v1/sessions", json={"email": "teacher@example.com", "password": "test-only"})
    second = client.post(
        f"/api/v1/classes/{klass}/children",
        json={"class_id": klass, "name": "합성둘째", "birth_date": "2023-01-01"},
    ).json()["child_id"]
    second_token = issue(client, second)
    client.delete("/api/v1/sessions/current")
    assert (
        client.post(f"/api/v1/parent-invites/{second_token}/accept", json=body()).status_code == 409
    )
    client.post("/api/v1/sessions", json={"email": "parent@example.com", "password": "test-only"})
    payload = {"is_legal_guardian": True, "consents": body()["consents"]}
    with monkeypatch.context() as patch:

        def fail(*args, **kwargs):
            raise RuntimeError("simulated persistence failure")

        patch.setattr(organization, "link_parent_with_consents", fail)
        with pytest.raises(RuntimeError, match="simulated"):
            client.post(f"/api/v1/parent-invites/{second_token}/accept", json=payload)
    assert client.get(f"/api/v1/parent-invites/{second_token}").status_code == 200
    assert (
        client.post(f"/api/v1/parent-invites/{second_token}/accept", json=payload).status_code
        == 201
    )
    assert len(client.get("/api/v1/me/children").json()["items"]) == 2
    assert db.scalar(select(func.count()).select_from(Account)) == 2


@pytest.mark.skipif(
    not os.environ.get("PHOTO_PIPELINE_TEST_DATABASE_URL"), reason="PostgreSQL row locks required"
)
def test_동시_수락은_한_계정만_연결한다(flow):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from core.exceptions import InviteUnavailable
    from domains.auth import service

    client, db = flow
    _, child = prepare(client)
    token = issue(client, child)
    factory = sessionmaker(db.get_bind(), expire_on_commit=False, autoflush=False)
    barrier = Barrier(2)

    def accept(index):
        with factory() as other:
            barrier.wait(timeout=10)
            try:
                service.accept_parent_invite(
                    other,
                    token,
                    None,
                    email=f"concurrent{index}@example.com",
                    password="test-only",
                    name="합성보호자",
                    face_feature=False,
                )
                return 201
            except InviteUnavailable:
                return 410

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, [1, 2]))
    assert sorted(results) == [201, 410]
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(ParentChildRelation)) == 1
    assert db.scalar(select(func.count()).select_from(ConsentRecord)) == 2
    assert db.scalar(select(func.count()).select_from(Account)) == 2
