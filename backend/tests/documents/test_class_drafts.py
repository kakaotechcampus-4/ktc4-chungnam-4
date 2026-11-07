"""GET /api/v1/classes/{class_id}/drafts — 반·날짜별 원아 초안 상태 목록 (FR-06, FR-16).

원아 이름은 합성 값만 쓴다. 응답에는 이름이 실리지 않는다.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.auth.middleware import get_current_user
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
from domains.auth.service import ParentProfile, TeacherProfile
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
)
from domains.documents.models import UnclassifiedItem as FailureItem
from domains.face.models import FaceEmbedding
from domains.organization.models import Center, Child, Klass
from domains.organization.models import ConsentRecord as RosterConsent
from domains.organization.models import ParentChildRelation as RosterParent
from main import app

RECORD_DATE = date(2026, 10, 27)
PATH = "/api/v1/classes/{class_id}/drafts"


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(
        engine, tables=[FaceEmbedding.__table__, RosterConsent.__table__, RosterParent.__table__]
    )
    Base.metadata.create_all(
        engine, tables=[LookupAccount.__table__, LookupTeacher.__table__, FailureItem.__table__]
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Center.__table__,
            Klass.__table__,
            Child.__table__,
            DraftDocument.__table__,
            DraftSentence.__table__,
            DocumentPublication.__table__,
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


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=uuid.uuid4(),
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _class(db: Session) -> tuple[UUID, UUID]:
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    return center.id, klass.id


def _child(db: Session, class_id: UUID, name: str) -> UUID:
    child = Child(
        class_id=class_id,
        name=name,
        birth_date=date(2021, 5, 1),
        status="enrolled",
        enrolled_at=date(2025, 3, 1),
    )
    db.add(child)
    db.flush()
    return child.id


def _draft(
    db: Session,
    child_id: UUID,
    *sentences: str,
    doc_type: DocType = DocType.PARENT_NOTE,
    record_date: date = RECORD_DATE,
    status: DraftStatus = DraftStatus.VERIFIED,
) -> DraftDocument:
    draft = DraftDocument(
        child_id=child_id,
        author_teacher_id=uuid.uuid4(),
        doc_type=doc_type.value,
        record_date=record_date,
        status=status.value,
        ai_version=1,
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=f"s{n}", position=n - 1, text=text)
        for n, text in enumerate(sentences or ("블록을 쌓았어요.",), start=1)
    )
    db.flush()
    return draft


def _publish(
    db: Session,
    draft: DraftDocument,
    *,
    revoked: bool = False,
    viewed: bool = False,
    published_at: datetime = datetime(2026, 10, 27, 8, 40, tzinfo=UTC),
) -> datetime:
    db.add(
        DocumentPublication(
            draft_id=draft.id,
            round_number=1,
            publish_request_id=str(uuid.uuid4()),
            published_version=draft.version,
            published_at=published_at,
            revoke_deadline=published_at + timedelta(hours=24),
            revoked_at=published_at + timedelta(hours=1) if revoked else None,
            first_viewed_at=published_at + timedelta(minutes=10) if viewed else None,
        )
    )
    db.flush()
    return published_at


def _summary(draft: DraftDocument, preview: str, published_at: str | None = None) -> dict:
    return {
        "draft_id": str(draft.id),
        "status": draft.status,
        "version": draft.version,
        "published_at": published_at,
        "revoke_deadline": None,
        "can_revoke": False,
        "preview": preview,
    }


def test_그날_초안이_있는_원아만_명단_순서대로_문서_종류별_칸에_담는다(client, db):
    center_id, class_id = _class(db)
    first = _child(db, class_id, "가나")
    _child(db, class_id, "다라")  # 초안 없음 — "자료 없음"은 FE가 명단과 비교해 만든다
    second = _child(db, class_id, "마바")
    note = _draft(db, first, "블록을 쌓았어요.", "탑이 높아졌어요.")
    log = _draft(db, first, "블록 놀이에 집중함.", doc_type=DocType.OBSERVATION_LOG)
    other = _draft(db, second, "그림책을 봤어요.", status=DraftStatus.APPROVED)
    _draft(db, second, "어제 일이에요.", record_date=RECORD_DATE - timedelta(days=1))
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "child_id": str(first),
                "observation_log": _summary(log, "블록 놀이에 집중함."),
                "parent_note": _summary(note, "블록을 쌓았어요. 탑이 높아졌어요."),
                "unclassified": None,
            },
            {
                "child_id": str(second),
                "observation_log": None,
                "parent_note": _summary(other, "그림책을 봤어요."),
                "unclassified": None,
            },
        ],
        "next_cursor": None,
    }


def test_원아_이름은_응답에_싣지_않는다(client, db):
    center_id, class_id = _class(db)
    _draft(db, _child(db, class_id, "합성이름"))
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    assert "합성이름" not in response.text


def test_doc_type을_주면_그_종류만_담는다(client, db):
    center_id, class_id = _class(db)
    child_id = _child(db, class_id, "가나")
    note = _draft(db, child_id)
    _draft(db, child_id, doc_type=DocType.OBSERVATION_LOG)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(
        PATH.format(class_id=class_id),
        params={"record_date": "2026-10-27", "doc_type": "parent_note"},
    )

    [item] = response.json()["items"]
    assert item["observation_log"] is None
    assert item["parent_note"]["draft_id"] == str(note.id)


def test_다른_반_원아의_초안은_담지_않는다(client, db):
    center_id, class_id = _class(db)
    other_class = Klass(
        center_id=center_id, teacher_id=uuid.uuid4(), name="달님반", age_group="만 4세"
    )
    db.add(other_class)
    db.flush()
    _draft(db, _child(db, other_class.id, "가나"))
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    assert response.json()["items"] == []


def test_미리보기는_문장_경계에서_100자를_넘기지_않는다(client, db):
    center_id, class_id = _class(db)
    child_id = _child(db, class_id, "가나")
    _draft(db, child_id, "가" * 60, "나" * 30, "다" * 20)
    _draft(db, child_id, "라" * 150, doc_type=DocType.OBSERVATION_LOG)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    [item] = response.json()["items"]
    # 셋째 문장까지 이으면 112자라 둘째 문장에서 멈춘다(공백 포함 91자).
    assert item["parent_note"]["preview"] == f"{'가' * 60} {'나' * 30}"
    # 첫 문장이 100자를 넘으면 그 문장을 100자에서 자른다 — 빈 미리보기를 내지 않는다.
    assert item["observation_log"]["preview"] == "라" * 100


def test_활성_게시_회차가_있으면_게시_시각을_싣고_회수된_회차는_싣지_않는다(client, db):
    center_id, class_id = _class(db)
    published = _draft(db, _child(db, class_id, "가나"), status=DraftStatus.APPROVED)
    revoked = _draft(db, _child(db, class_id, "다라"), status=DraftStatus.APPROVED)
    _publish(db, published)
    _publish(db, revoked, revoked=True)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    published_at = [item["parent_note"]["published_at"] for item in response.json()["items"]]
    # 테스트 DB(SQLite)는 시간대를 저장하지 않아 "Z"가 빠진다. PostgreSQL은 timestamptz라 UTC로 온다.
    assert published_at[0].removesuffix("Z") == "2026-10-27T08:40:00"
    assert published_at[1] is None


def test_회수_기한과_회수_가능_여부를_상세와_같은_규칙으로_싣는다(client, db):
    """게시 완료 화면이 상세를 미리 받지 않고 회수 버튼을 정하게 한다 (#260)."""
    center_id, class_id = _class(db)
    just_now = datetime.now(UTC).replace(microsecond=0) - timedelta(hours=1)
    open_ = _draft(db, _child(db, class_id, "가나"), status=DraftStatus.APPROVED)
    viewed = _draft(db, _child(db, class_id, "다라"), status=DraftStatus.APPROVED)
    expired = _draft(db, _child(db, class_id, "마바"), status=DraftStatus.APPROVED)
    revoked = _draft(db, _child(db, class_id, "사아"), status=DraftStatus.APPROVED)
    unpublished = _draft(db, _child(db, class_id, "자차"), status=DraftStatus.APPROVED)
    _publish(db, open_, published_at=just_now)
    _publish(db, viewed, published_at=just_now, viewed=True)
    _publish(db, expired)  # 10/27 게시라 기한이 지났다
    _publish(db, revoked, revoked=True)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    by_draft = {
        item["parent_note"]["draft_id"]: item["parent_note"] for item in response.json()["items"]
    }
    # 테스트 DB(SQLite)는 시간대를 저장하지 않아 "Z"가 빠진다. PostgreSQL은 timestamptz라 UTC로 온다.
    deadline = (just_now + timedelta(hours=24)).replace(tzinfo=None).isoformat()
    assert by_draft[str(open_.id)]["revoke_deadline"].removesuffix("Z") == deadline
    assert by_draft[str(open_.id)]["can_revoke"] is True
    # 학부모가 본문을 열었어도 기한 안이면 회수할 수 있다 (#266).
    assert by_draft[str(viewed.id)]["revoke_deadline"].removesuffix("Z") == deadline
    assert by_draft[str(viewed.id)]["can_revoke"] is True
    assert by_draft[str(expired.id)]["revoke_deadline"].removesuffix("Z") == "2026-10-28T08:40:00"
    assert by_draft[str(expired.id)]["can_revoke"] is False
    for draft in (revoked, unpublished):
        assert by_draft[str(draft.id)]["revoke_deadline"] is None
        assert by_draft[str(draft.id)]["can_revoke"] is False


def test_published면_게시본만_담고_날짜가_없으면_원아마다_가장_최근_게시본_하나다(client, db):
    center_id, class_id = _class(db)
    child_id = _child(db, class_id, "가나")
    older = _draft(
        db, child_id, status=DraftStatus.APPROVED, record_date=RECORD_DATE - timedelta(days=2)
    )
    newer = _draft(
        db, child_id, status=DraftStatus.APPROVED, record_date=RECORD_DATE - timedelta(days=1)
    )
    _draft(db, child_id, status=DraftStatus.APPROVED)  # 승인했지만 게시 전
    _publish(db, older)
    _publish(db, newer)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(
        PATH.format(class_id=class_id), params={"published": "true", "doc_type": "parent_note"}
    )

    [item] = response.json()["items"]
    assert item["parent_note"]["draft_id"] == str(newer.id)


def test_published가_아닌데_날짜가_없으면_422_VALIDATION_ERROR(client, db):
    center_id, class_id = _class(db)
    db.commit()
    _login_as_teacher(center_id)

    response = client.get(PATH.format(class_id=class_id))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_다른_어린이집_반이면_403_CLASS_ACCESS_DENIED(client, db):
    _, class_id = _class(db)
    db.commit()
    _login_as_teacher(uuid.uuid4())

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CLASS_ACCESS_DENIED"


def test_H1_학부모는_승인_전_초안_미리보기가_담긴_반_목록을_볼_수_없다(client, db):
    _, class_id = _class(db)
    db.commit()
    parent = ParentProfile(
        account_id=uuid.uuid4(), email="parent@example.com", name="학부모A", parent_id=uuid.uuid4()
    )
    app.dependency_overrides[get_current_user] = lambda: parent

    response = client.get(PATH.format(class_id=class_id), params={"record_date": "2026-10-27"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_NOT_ALLOWED"
