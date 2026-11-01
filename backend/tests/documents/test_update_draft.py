"""PATCH /api/v1/drafts/{draft_id} — 교사가 문장을 직접 고치거나 새 문장을 덧붙인다 (FR-17)."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from core.exceptions import StorageNotConfigured
from domains.agents.models import SentenceEvidence
from domains.auth.middleware import get_current_user
from domains.auth.service import TeacherProfile
from domains.documents import service as documents_service
from domains.documents.models import (
    DocType,
    DocumentPublication,
    DraftDocument,
    DraftSentence,
    DraftStatus,
    RevisionLog,
)
from domains.documents.service import get_draft_version
from domains.media.service import MediaEvidence, SignedMediaUrl
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
PHOTO_A = uuid.uuid4()
PHOTO_B = uuid.uuid4()
VIDEO = uuid.uuid4()
VOICE = uuid.uuid4()


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    tables.append(SentenceEvidence)  # 상세 응답이 문장별 근거를 읽는다(agents)
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    # 서버 세션(core/database.py SessionLocal)처럼 autoflush를 끕니다 — 켜 두면 커밋 전 조회가
    # 새 문장을 알아서 보여 줘서, 응답에서 새 문장이 빠지는 버그를 못 잡습니다(#206 멘토 리뷰)
    session = sessionmaker(bind=engine, autoflush=False)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _draft(
    db: Session, *sentence_ids: str, status: DraftStatus = DraftStatus.VERIFIED
) -> DraftDocument:
    """같은 어린이집 원아의 초안. 그 어린이집 교사로 로그인해 둔다."""
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
        version=3,
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(draft_id=draft.id, sentence_id=sid, position=n, text=f"{sid} 원래 문장")
        for n, sid in enumerate(sentence_ids or ("s1", "s2"))
    )
    db.commit()
    _login_as_teacher(center.id)
    return draft


def _login_as_teacher(center_id: UUID | None) -> None:
    profile = TeacherProfile(
        account_id=uuid.uuid4(),
        email="teacher@example.com",
        name="교사A",
        teacher_id=TEACHER_ID,
        center_id=center_id,
    )
    app.dependency_overrides[get_current_user] = lambda: profile


def _patch(client: TestClient, draft: DraftDocument, **body):
    return client.patch(f"/api/v1/drafts/{draft.id}", json={"expected_version": 3, **body})


def _stored(db: Session, draft: DraftDocument) -> list[tuple[str, str, bool]]:
    rows = db.scalars(
        select(DraftSentence)
        .where(DraftSentence.draft_id == draft.id)
        .execution_options(populate_existing=True)
        .order_by(DraftSentence.position)
    )
    return [(row.sentence_id, row.text, row.is_edited_by_teacher) for row in rows]


def _logs(db: Session, draft: DraftDocument) -> list[tuple[str, str | None, str | None, str]]:
    rows = db.scalars(select(RevisionLog).where(RevisionLog.draft_id == draft.id))
    return [
        (row.target_sentence_id, row.before_content, row.after_content, row.edit_method)
        for row in rows
    ]


def test_문장을_고치면_수정됨_표시와_이력이_남고_버전이_오른다(client, db):
    draft = _draft(db)

    response = _patch(client, draft, sentences=[{"sentence_id": "s2", "text": "고친 문장"}])

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 4
    assert [(s["sentence_id"], s["is_edited_by_teacher"]) for s in body["sentences"]] == [
        ("s1", False),
        ("s2", True),
    ]
    assert _stored(db, draft) == [("s1", "s1 원래 문장", False), ("s2", "고친 문장", True)]
    assert _logs(db, draft) == [("s2", "s2 원래 문장", "고친 문장", "manual")]
    # 고친 문서는 AI 재생성이 덮어쓰지 않는다 (_has_teacher_edits)
    info = get_draft_version(
        db, child_id=draft.child_id, doc_type=DocType.PARENT_NOTE, record_date=draft.record_date
    )
    assert info.has_teacher_edits is True


def test_새_문장은_맨_뒤에_t_번호_최댓값_다음부터_붙는다(client, db):
    draft = _draft(db, "s1", "t1")

    response = _patch(
        client, draft, added_sentences=[{"text": "첫 새 문장"}, {"text": "둘째 새 문장"}]
    )

    assert response.status_code == 200
    assert _stored(db, draft)[2:] == [("t2", "첫 새 문장", False), ("t3", "둘째 새 문장", False)]
    # 커밋 전에 만드는 응답에도 새 문장이 담긴다(#206 멘토 리뷰 — autoflush가 꺼진 세션)
    assert [s["sentence_id"] for s in response.json()["sentences"]][2:] == ["t2", "t3"]
    assert _logs(db, draft) == [
        ("t2", None, "첫 새 문장", "manual"),
        ("t3", None, "둘째 새 문장", "manual"),
    ]


def test_t_번호는_문자열이_아니라_숫자로_센다(client, db):
    # 문자열로 비교하면 "t9" > "t10"이라 다음 번호가 t10으로 겹친다
    draft = _draft(db, "s1", "t9", "t10")

    _patch(client, draft, added_sentences=[{"text": "새 문장"}])

    assert _stored(db, draft)[3] == ("t11", "새 문장", False)


def test_고치기와_덧붙이기를_한_요청에_보내면_둘_다_이력에_남는다(client, db):
    draft = _draft(db)

    response = _patch(
        client,
        draft,
        sentences=[{"sentence_id": "s1", "text": "고친 문장"}],
        added_sentences=[{"text": "새 문장"}],
    )

    assert response.json()["version"] == 4  # 한 요청은 버전을 한 번만 올린다
    assert _logs(db, draft) == [
        ("s1", "s1 원래 문장", "고친 문장", "manual"),
        ("t1", None, "새 문장", "manual"),
    ]
    # 고친 것·덧붙인 것 모두 로그인한 교사의 edit으로 남는다
    rows = db.scalars(select(RevisionLog).where(RevisionLog.draft_id == draft.id))
    assert {(row.action, row.editor_id) for row in rows} == {("edit", TEACHER_ID)}


def test_교사가_쓴_문장도_고치면_수정됨이다(client, db):
    draft = _draft(db, "s1", "t1")

    _patch(client, draft, sentences=[{"sentence_id": "t1", "text": "다시 고친 문장"}])

    assert _stored(db, draft)[1] == ("t1", "다시 고친 문장", True)


@pytest.mark.parametrize(
    "text", ["s1 원래 문장", " s1 원래 문장\n"], ids=["같음", "앞뒤_공백만_다름"]
)
def test_글자가_그대로인_문장은_고친_것으로_보지_않는다(client, db, text):
    draft = _draft(db)

    _patch(client, draft, sentences=[{"sentence_id": "s1", "text": text}])

    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
    assert _logs(db, draft) == []


def test_없는_문장이면_400이고_아무것도_바꾸지_않는다(client, db):
    draft = _draft(db)

    response = _patch(
        client,
        draft,
        sentences=[
            {"sentence_id": "s1", "text": "고친 문장"},
            {"sentence_id": "s9", "text": "없는 문장"},
        ],
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_SENTENCE_ID"
    db.refresh(draft)
    assert draft.version == 3
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
    assert _logs(db, draft) == []


@pytest.mark.parametrize(
    "status, expected_version, code",
    [
        (DraftStatus.VERIFIED, 2, "DRAFT_VERSION_CONFLICT"),
        (DraftStatus.DRAFT, 3, "DRAFT_NOT_READY"),
        (DraftStatus.APPROVED, 3, "DRAFT_ALREADY_APPROVED"),
    ],
)
def test_고칠_수_없는_상태면_409(client, db, status, expected_version, code):
    draft = _draft(db, status=status)

    response = _patch(
        client,
        draft,
        expected_version=expected_version,
        sentences=[{"sentence_id": "s1", "text": "고친 문장"}],
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == code
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"sentences": [{"sentence_id": "s1", "text": "a"}, {"sentence_id": "s1", "text": "b"}]},
        {"selected_media_ids": [str(PHOTO_A), str(PHOTO_A)]},
        {"sentences": [{"sentence_id": "s1", "text": "  \n"}]},
        {"added_sentences": [{"text": " "}]},
    ],
    ids=["바꿀_것_없음", "같은_문장_두_번", "같은_사진_두_번", "공백만_고침", "공백만_추가"],
)
def test_요청이_맞지_않으면_422(client, db, body):
    draft = _draft(db)

    response = _patch(client, draft, **body)

    assert response.status_code == 422
    db.refresh(draft)
    assert draft.version == 3


def test_다른_어린이집_교사는_고칠_수_없다(client, db):
    draft = _draft(db)
    _login_as_teacher(uuid.uuid4())

    response = _patch(client, draft, sentences=[{"sentence_id": "s1", "text": "고친 문장"}])

    assert response.status_code == 403
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)


@pytest.fixture
def photos(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """그 원아·그 날짜에 고를 수 있는 사진은 PHOTO_A·PHOTO_B다. 서명 URL은 S3 없이 만든다.

    collect_media_for_llm은 영상·음성메모도 돌려주므로 VIDEO·VOICE도 함께 싣는다.
    """
    calls: list[tuple] = []
    taken = datetime(2026, 10, 27, 1, 0, tzinfo=UTC)

    def collect(db, child_id, target_date):
        calls.append((child_id, target_date))
        return [
            MediaEvidence(media_id=media_id, type=kind, captured_at=taken, storage_url="s3://x")
            for media_id, kind in (
                (PHOTO_A, "photo"),
                (VIDEO, "video"),
                (PHOTO_B, "photo"),
                (VOICE, "voice_memo"),
            )
        ]

    def sign(db, media_ids):
        expires = datetime(2026, 10, 27, 2, 0, tzinfo=UTC)
        return [
            SignedMediaUrl(media_id=m, type="photo", url=f"https://s3/{m}", url_expires_at=expires)
            for m in media_ids
        ]

    monkeypatch.setattr(documents_service.media_service, "collect_media_for_llm", collect)
    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", sign)
    return calls


def test_고른_사진을_그_순서로_저장하고_서명_URL을_돌려준다(client, db, photos):
    draft = _draft(db)

    response = _patch(client, draft, selected_media_ids=[str(PHOTO_B), str(PHOTO_A)])

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 4
    assert body["selected_media_ids"] == [str(PHOTO_B), str(PHOTO_A)]
    assert [m["url"] for m in body["media"]] == [f"https://s3/{PHOTO_B}", f"https://s3/{PHOTO_A}"]
    db.refresh(draft)
    assert draft.selected_media_ids == [str(PHOTO_B), str(PHOTO_A)]
    # 그 원아·그 날짜의 고를 수 있는 사진 범위로 확인한다
    assert photos == [(draft.child_id, draft.record_date)]


def test_응답을_만들다_실패하면_고친_문장도_이력도_남지_않는다(client, db, photos, monkeypatch):
    draft = _draft(db)
    draft.selected_media_ids = [str(PHOTO_A)]  # 응답에 서명 URL이 필요하다
    db.commit()

    def broken(db, media_ids):
        raise StorageNotConfigured("파일 저장소에 접근할 수 없어요.")

    monkeypatch.setattr(documents_service.media_service, "get_signed_urls", broken)

    response = _patch(client, draft, sentences=[{"sentence_id": "s1", "text": "고친 문장"}])

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "STORAGE_NOT_CONFIGURED"
    assert _stored(db, draft)[0] == ("s1", "s1 원래 문장", False)
    assert _logs(db, draft) == []
    db.refresh(draft)
    assert draft.version == 3


def test_빈_배열이면_사진을_모두_뺀다(client, db, photos):
    draft = _draft(db)
    _patch(client, draft, selected_media_ids=[str(PHOTO_A)])

    response = _patch(client, draft, expected_version=4, selected_media_ids=[])

    assert response.json()["selected_media_ids"] == []
    assert response.json()["media"] == []


@pytest.mark.parametrize(
    "media_id", [uuid.uuid4(), VIDEO, VOICE], ids=["범위_밖", "영상", "음성메모"]
)
def test_고를_수_없는_사진이면_400이고_아무것도_바꾸지_않는다(client, db, photos, media_id):
    draft = _draft(db)

    response = _patch(client, draft, selected_media_ids=[str(PHOTO_A), str(media_id)])

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "MEDIA_NOT_LINKED_TO_CHILD"
    db.refresh(draft)
    assert (draft.version, draft.selected_media_ids) == (3, [])
