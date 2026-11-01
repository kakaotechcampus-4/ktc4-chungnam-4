"""GET /api/v1/drafts/{draft_id} — 교사용 초안 상세(문장·문장별 근거·사진) (FR-06·FR-07·FR-16).

문장별 근거는 agents의 list_sentence_evidences(#178)가 만든다. 여기서는 같은 모양의 가짜를
넣고 documents가 하는 일(고친 문장의 근거 비우기, 미디어 서명, 열람 기록, 권한)만 본다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents.service import SentenceEvidenceView
from domains.audit.models import AccessLog
from domains.auth.middleware import get_current_user
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents import service as documents_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionLog,
)
from domains.media.service import SignedMediaUrl
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
PHOTO = uuid.uuid4()
VOICE = uuid.uuid4()
SELECTED = uuid.uuid4()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    tables.append(AccessLog)
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    taken = datetime(2026, 10, 27, 1, 0, tzinfo=UTC)

    def evidences(db, draft_id):
        return {
            "s1": [
                SentenceEvidenceView(
                    "photo:1", "photo_observation", "블록을 쌓음", PHOTO, None, None, taken
                ),
                SentenceEvidenceView(
                    "plan:1", "activity_plan", "블록 놀이 계획", None, None, None, None
                ),
            ],
            # 교사가 고친 문장이라 응답에서는 비워야 한다
            "s2": [
                SentenceEvidenceView("memo:1", "teacher_voice_memo", "탑", VOICE, 1500, None, taken)
            ],
        }

    def sign(db, media_ids):
        expires = datetime(2026, 10, 27, 2, 0, tzinfo=UTC)
        return [
            SignedMediaUrl(media_id=m, type="photo", url=f"https://s3/{m}", url_expires_at=expires)
            for m in media_ids
        ]

    monkeypatch.setattr(documents_service.agents_service, "list_sentence_evidences", evidences)
    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign)
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _draft(db: Session, status: DraftStatus = DraftStatus.VERIFIED) -> tuple[UUID, DraftDocument]:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name="가나",
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    draft = DraftDocument(
        child_id=child.id,
        author_teacher_id=uuid.uuid4(),
        doc_type=DocType.PARENT_NOTE.value,
        record_date=date(2026, 10, 27),
        status=status.value,
        ai_version=1,
        selected_media_ids=[str(SELECTED), str(PHOTO)],
    )
    db.add(draft)
    db.flush()
    db.add_all(
        [
            DraftSentence(draft_id=draft.id, sentence_id="s1", position=0, text="블록을 쌓았어요."),
            DraftSentence(
                draft_id=draft.id,
                sentence_id="s2",
                position=1,
                text="교사가 고친 문장",
                is_edited_by_teacher=True,
            ),
        ]
    )
    db.commit()
    return center.id, draft


def _views(db: Session) -> list[tuple[str, UUID, str]]:
    return [(log.actor_type, log.actor_id, log.action) for log in db.scalars(select(AccessLog))]


def test_승인_전_초안도_문장별_근거와_사진을_담아_교사에게_보여_준다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/drafts/{draft.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "verified"
    first, edited = body["sentences"]
    assert [e["evidence_id"] for e in first["evidences"]] == ["photo:1", "plan:1"]
    assert first["evidences"][0]["captured_at"] is not None
    # 교사가 고친 문장은 원문이 뒷받침한다고 볼 수 없어 근거를 비운다(#75)
    assert (edited["is_edited_by_teacher"], edited["evidences"]) == (True, [])
    # 선택 사진 다음 보여 주는 근거의 미디어, 겹치지 않게(고친 문장의 음성메모는 빠짐)
    assert [m["media_id"] for m in body["media"]] == [str(SELECTED), str(PHOTO)]
    assert body["selected_media_ids"] == [str(SELECTED), str(PHOTO)]
    assert (body["published_at"], body["include_photos"]) == (None, None)
    assert "ai_version" not in body


def test_게시한_초안은_게시_시각과_사진_함께_보내기를_싣는다(client, db):
    center_id, draft = _draft(db, DraftStatus.APPROVED)
    published_at = datetime(2026, 10, 27, 8, 40, tzinfo=UTC)
    db.add(
        DocumentPublication(
            draft_id=draft.id,
            round_number=1,
            publish_request_id="r1",
            published_version=2,
            published_at=published_at,
            revoke_deadline=published_at + timedelta(hours=24),
            include_photos=False,
        )
    )
    db.commit()
    _login_as_teacher(center_id)

    body = client.get(f"/api/v1/drafts/{draft.id}").json()

    assert body["published_at"].removesuffix("Z") == "2026-10-27T08:40:00"
    assert body["include_photos"] is False


def test_볼_때마다_교사_열람_기록이_남는다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    client.get(f"/api/v1/drafts/{draft.id}")
    client.get(f"/api/v1/drafts/{draft.id}")

    assert _views(db) == [("teacher", TEACHER_ID, "view_detail")] * 2
    assert {log.target_id for log in db.scalars(select(AccessLog))} == {draft.id}


def test_열람_기록에_실패하면_본문_없이_500(client, db, monkeypatch):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    def broken(*args, **kwargs):
        raise SQLAlchemyError("disk full")

    monkeypatch.setattr(documents_service.audit_service, "record_access", broken)

    response = client.get(f"/api/v1/drafts/{draft.id}")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "ACCESS_LOG_FAILED"
    assert "블록" not in response.text


def test_다른_어린이집_교사는_볼_수_없고_기록도_남지_않는다(client, db):
    _, draft = _draft(db)
    _login_as_teacher(uuid.uuid4())

    response = client.get(f"/api/v1/drafts/{draft.id}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert _views(db) == []


def test_없는_초안은_404(client, db):
    center_id, _ = _draft(db)
    _login_as_teacher(center_id)

    response = client.get(f"/api/v1/drafts/{uuid.uuid4()}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DRAFT_NOT_FOUND"


def test_H1_학부모는_교사_상세를_볼_수_없다(client, db):
    _, draft = _draft(db)
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = client.get(f"/api/v1/drafts/{draft.id}")

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"


def test_승인_응답에도_근거가_담긴다(client, db):
    center_id, draft = _draft(db)
    _login_as_teacher(center_id)

    body = client.post(
        f"/api/v1/drafts/{draft.id}/approve", json={"expected_version": 1, "reviewed": True}
    ).json()

    assert [e["evidence_id"] for e in body["sentences"][0]["evidences"]] == ["photo:1", "plan:1"]
    assert body["sentences"][1]["evidences"] == []
    # 승인은 열람이 아니라 상세 열람 기록을 남기지 않는다
    assert _views(db) == []
