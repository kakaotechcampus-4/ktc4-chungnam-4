"""POST /api/v1/drafts/{draft_id}/revision-requests — AI에게 다듬기 요청 (FR-18).

LLM은 실제로 부르지 않고 가짜 함수로 바꾼다 (CLAUDE.md: LLM 실제 호출 금지). 이름은 합성이다.
"""

import json
import uuid
from collections.abc import Callable, Iterator
from datetime import date
from uuid import UUID

import httpx
import openai
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from core.base import Base
from core.database import get_db
from domains.agents import service as agents_service
from domains.agents.models import SentenceEvidence
from domains.auth.middleware import get_current_user
from domains.auth.models import Account as LookupAccount
from domains.auth.models import Teacher as LookupTeacher
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
from domains.documents.models import UnclassifiedItem as FailureItem
from domains.organization.models import Center, Child, Klass
from main import app

TEACHER_ID = uuid.uuid4()
CHILD_NAME = "가나"
VERSION = 3


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    tables = [Center, Klass, Child, DraftDocument, DraftSentence, DocumentPublication, RevisionLog]
    tables.append(SentenceEvidence)
    Base.metadata.create_all(
        engine, tables=[LookupAccount.__table__, LookupTeacher.__table__, FailureItem.__table__]
    )
    Base.metadata.create_all(engine, tables=[table.__table__ for table in tables])
    # 서버 세션처럼 autoflush를 끈다(documents 테스트와 같다)
    session = sessionmaker(bind=engine, autoflush=False)()
    yield session
    session.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    app.dependency_overrides.clear()


class FakeLlm:
    """call_claude를 대신한다. 받은 프롬프트를 모으고 미리 정한 응답(또는 예외)을 차례로 준다."""

    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.answers: list[str | Exception | Callable[[], str]] = []

    def __call__(self, prompt: str) -> str | None:
        self.prompts.append(prompt)
        answer = self.answers.pop(0) if self.answers else '{"sentences": {}}'
        if isinstance(answer, Exception):
            raise answer
        return answer() if callable(answer) else answer


@pytest.fixture
def llm(monkeypatch: pytest.MonkeyPatch) -> FakeLlm:
    fake = FakeLlm()
    monkeypatch.setattr(agents_service, "call_claude", fake)
    return fake


def _draft(
    db: Session,
    *,
    status: DraftStatus = DraftStatus.VERIFIED,
    edited: tuple[str, ...] = (),
    sentences: tuple[tuple[str, str], ...] = (
        ("s1", "CHILD_A는 블록을 쌓았어요."),
        ("s2", "CHILD_A는 점심을 먹었어요."),
    ),
) -> DraftDocument:
    """같은 어린이집 원아의 초안. 그 어린이집 교사로 로그인해 둔다.

    본문은 DB에 실명으로 저장되므로 CHILD_A 자리에 이름을 넣어 저장한다.
    """
    center = Center(center_code=uuid.uuid4().hex[:8], name="햇살어린이집", contract_status="trial")
    db.add(center)
    db.flush()
    klass = Klass(center_id=center.id, teacher_id=uuid.uuid4(), name="햇살반", age_group="만 4세")
    db.add(klass)
    db.flush()
    child = Child(
        class_id=klass.id,
        name=CHILD_NAME,
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
        version=VERSION,
    )
    db.add(draft)
    db.flush()
    db.add_all(
        DraftSentence(
            draft_id=draft.id,
            sentence_id=sentence_id,
            position=position,
            text=text.replace("CHILD_A", CHILD_NAME),
            is_edited_by_teacher=sentence_id in edited,
        )
        for position, (sentence_id, text) in enumerate(sentences)
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


def _revise(
    client: TestClient,
    draft: DraftDocument,
    instruction: str = "점심 이야기는 빼 주세요",
    *,
    version: int = VERSION,
):
    return client.post(
        f"/api/v1/drafts/{draft.id}/revision-requests",
        json={"instruction": instruction, "expected_version": version},
    )


def _answer(**sentences: str) -> str:
    return json.dumps({"sentences": sentences}, ensure_ascii=False)


def _texts(db: Session, draft: DraftDocument) -> dict[str, tuple[str, bool]]:
    rows = db.scalars(
        select(DraftSentence)
        .where(DraftSentence.draft_id == draft.id)
        .execution_options(populate_existing=True)
    )
    return {row.sentence_id: (row.text, row.is_edited_by_teacher) for row in rows}


def _version(db: Session, draft: DraftDocument) -> int:
    return db.scalar(
        select(DraftDocument.version)
        .where(DraftDocument.id == draft.id)
        .execution_options(populate_existing=True)
    )


def _logs(db: Session, draft: DraftDocument) -> list[RevisionLog]:
    return list(db.scalars(select(RevisionLog).where(RevisionLog.draft_id == draft.id)))


def test_다듬은_문장만_바뀌고_버전과_이력이_함께_남는다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s2="CHILD_A는 오늘 친구들과 즐겁게 놀았어요.")]

    response = _revise(client, draft)

    assert response.status_code == 200
    body = response.json()
    assert body["changed_sentence_ids"] == ["s2"]
    assert body["draft"]["version"] == VERSION + 1
    texts = _texts(db, draft)
    assert texts["s1"] == ("가나는 블록을 쌓았어요.", False)
    # 토큰은 실명으로 되돌아오고, AI가 바꾼 문장은 교사가 직접 고친 문장이 아니다.
    assert texts["s2"] == ("가나는 오늘 친구들과 즐겁게 놀았어요.", False)
    assert _version(db, draft) == VERSION + 1
    (log,) = _logs(db, draft)
    assert (log.action, log.edit_method, log.target_sentence_id) == ("edit", "prompt", "s2")
    assert log.instruction_prompt == "점심 이야기는 빼 주세요"
    assert log.before_content == "가나는 점심을 먹었어요."
    assert log.after_content == "가나는 오늘 친구들과 즐겁게 놀았어요."
    assert log.editor_id == TEACHER_ID


def test_H2_LLM에_보내는_프롬프트에는_실명이_없다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s2="CHILD_A는 놀았어요.")]

    _revise(client, draft, f"{CHILD_NAME} 이야기를 더 다정하게 써 주세요")

    (prompt,) = llm.prompts
    assert CHILD_NAME not in prompt
    assert "CHILD_A" in prompt


def test_직접_고친_문장은_AI가_바꾸지_않고_프롬프트에_잠금으로_표시된다(client, db, llm) -> None:
    draft = _draft(db, edited=("s1",))
    llm.answers = [_answer(s2="CHILD_A는 놀았어요.")]

    response = _revise(client, draft)

    assert response.status_code == 200
    assert response.json()["changed_sentence_ids"] == ["s2"]
    assert _texts(db, draft)["s1"] == ("가나는 블록을 쌓았어요.", True)
    assert '"locked": true' in llm.prompts[0]


def test_AI가_잠긴_문장을_바꾸려_하면_그_응답을_버리고_한_번_더_부른다(client, db, llm) -> None:
    draft = _draft(db, edited=("s1",))
    llm.answers = [_answer(s1="CHILD_A는 몰래 바꿨어요."), _answer(s2="CHILD_A는 놀았어요.")]

    response = _revise(client, draft)

    assert response.status_code == 200
    assert len(llm.prompts) == 2
    assert _texts(db, draft)["s1"] == ("가나는 블록을 쌓았어요.", True)


def test_두_번_모두_규칙에_어긋나면_502이고_초안은_그대로다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = ["문장을 바꿨어요", "아직도 JSON이 아니에요"]

    response = _revise(client, draft)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "REVISION_FAILED"
    assert len(llm.prompts) == 2
    assert _version(db, draft) == VERSION
    assert _logs(db, draft) == []


def test_알_수_없는_토큰이_남은_응답은_버린다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s2="CHILD_Z는 놀았어요."), _answer(s2="CHILD_A는 놀았어요.")]

    response = _revise(client, draft)

    assert response.status_code == 200
    assert "CHILD_Z" not in _texts(db, draft)["s2"][0]


def test_호출이_실패하면_다시_부르지_않고_502다(client, db, llm) -> None:
    draft = _draft(db)
    request = httpx.Request("POST", "http://llm.invalid/v1")
    llm.answers = [openai.APIConnectionError(request=request)]

    response = _revise(client, draft)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "REVISION_FAILED"
    assert len(llm.prompts) == 1
    assert _version(db, draft) == VERSION


def test_바꿀_문장이_없다는_응답이면_버전도_이력도_그대로다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = ['{"sentences": {}}']

    response = _revise(client, draft)

    assert response.status_code == 200
    assert response.json()["changed_sentence_ids"] == []
    assert response.json()["draft"]["version"] == VERSION
    assert _version(db, draft) == VERSION
    assert _logs(db, draft) == []


def test_글자가_그대로인_문장은_바뀐_것으로_보지_않는다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s1="CHILD_A는 블록을 쌓았어요.")]

    response = _revise(client, draft)

    assert response.status_code == 200
    assert response.json()["changed_sentence_ids"] == []
    assert _version(db, draft) == VERSION


def test_모든_문장이_잠겨_있으면_409이고_AI를_부르지_않는다(client, db, llm) -> None:
    draft = _draft(db, edited=("s1", "s2"))

    response = _revise(client, draft)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REVISION_NOTHING_TO_CHANGE"
    assert llm.prompts == []


def test_교사가_쓴_t_문장도_잠긴다(client, db, llm) -> None:
    draft = _draft(db, sentences=(("t1", "교사가 쓴 문장"), ("s1", "CHILD_A는 놀았어요.")))
    llm.answers = [_answer(t1="바꾸려 한다"), _answer(t1="또 바꾸려 한다")]

    response = _revise(client, draft)

    assert response.status_code == 502  # t1은 바꿀 수 있는 문장이 아니라 응답을 버린다
    assert _texts(db, draft)["t1"][0] == "교사가 쓴 문장"


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (DraftStatus.APPROVED, "DRAFT_ALREADY_APPROVED"),
        (DraftStatus.REVOKED, "DRAFT_REVOKED"),
        (DraftStatus.DRAFT, "DRAFT_NOT_READY"),
    ],
)
def test_H1_검토_대기가_아닌_초안은_다듬지_않고_AI도_부르지_않는다(
    client, db, llm, status: DraftStatus, code: str
) -> None:
    draft = _draft(db, status=status)

    response = _revise(client, draft)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == code
    assert llm.prompts == []


def test_버전이_다르면_409이고_AI를_부르지_않는다(client, db, llm) -> None:
    draft = _draft(db)

    response = _revise(client, draft, version=VERSION - 1)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_VERSION_CONFLICT"
    assert llm.prompts == []


def test_AI가_답하는_사이_다른_수정이_끼면_409이고_반영하지_않는다(client, db, llm) -> None:
    draft = _draft(db)

    def _answer_after_other_edit() -> str:
        # 교사가 다른 곳에서 먼저 저장해 버전이 올라간 경우를 만든다.
        db.execute(
            update(DraftDocument).where(DraftDocument.id == draft.id).values(version=VERSION + 1)
        )
        db.commit()
        return _answer(s2="CHILD_A는 놀았어요.")

    llm.answers = [_answer_after_other_edit]

    response = _revise(client, draft)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DRAFT_VERSION_CONFLICT"
    assert _texts(db, draft)["s2"][0] == "가나는 점심을 먹었어요."
    assert _logs(db, draft) == []


@pytest.mark.parametrize("instruction", ["", "   ", "가" * 501])
def test_지시문이_비었거나_너무_길면_422이고_지시문을_되돌려_보내지_않는다(
    client, db, llm, instruction: str
) -> None:
    draft = _draft(db)

    response = _revise(client, draft, instruction)

    assert response.status_code == 422
    assert instruction.strip() == "" or instruction not in response.text
    assert llm.prompts == []


def test_앞뒤_공백은_뗀_지시문이_이력에_남는다(client, db, llm) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s2="CHILD_A는 놀았어요.")]

    _revise(client, draft, "  더 짧게 써 주세요  ")

    assert _logs(db, draft)[0].instruction_prompt == "더 짧게 써 주세요"


def test_다른_어린이집_교사는_다듬을_수_없다(client, db, llm) -> None:
    draft = _draft(db)
    _login_as_teacher(uuid.uuid4())

    response = _revise(client, draft)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CHILD_ACCESS_DENIED"
    assert llm.prompts == []
    assert _logs(db, draft) == []


def test_없는_초안은_404다(client, db, llm) -> None:
    draft = _draft(db)
    draft.id = uuid.uuid4()

    response = _revise(client, draft)

    assert response.status_code == 404
    assert llm.prompts == []


def test_다듬은_초안은_승인_전이라_공개되지_않고_AI_재생성이_덮어쓰지_않는다(
    client, db, llm
) -> None:
    draft = _draft(db)
    llm.answers = [_answer(s2="CHILD_A는 놀았어요.")]

    _revise(client, draft)

    stored = documents_service.get_draft_version(
        db, child_id=draft.child_id, doc_type=DocType.PARENT_NOTE, record_date=draft.record_date
    )
    assert stored.status == DraftStatus.VERIFIED
    assert stored.has_teacher_edits is True
