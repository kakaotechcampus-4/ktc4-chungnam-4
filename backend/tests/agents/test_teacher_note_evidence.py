"""교사 메모(추가 근거)가 근거 계약·비식별화·검증·문장별 근거 표시에서 어떻게 다뤄지는지 (FR-05).

저장·API는 test_teacher_evidence_router.py, 생성 파이프라인 연결은 test_photo_pipeline.py가 봅니다.
"""

import uuid
from datetime import date

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.base import Base
from domains.agents.models import SentenceEvidence
from domains.agents.service import TEACHER_NOTE_EVIDENCE_PREFIX, list_sentence_evidences
from domains.media.models import MediaAsset
from tools.contracts import (
    AssignmentStatus,
    DocType,
    DraftDocument,
    DraftSentence,
    EvidenceItem,
    SourceType,
    VerificationCheckType,
)
from tools.generation.pseudonymize import pseudonymize_evidence
from tools.verification.references import validate_references

DAY = date(2026, 9, 15)
CHILD = "child-1"


def _note(text: str = "나뭇잎을 모아 크기를 비교했어요.", **overrides: object) -> EvidenceItem:
    data: dict[str, object] = {
        "evidence_id": f"{TEACHER_NOTE_EVIDENCE_PREFIX}{uuid.uuid4()}",
        "source_type": SourceType.TEACHER_NOTE,
        "child_ids": [CHILD],
        "observed_date": DAY,
        "text": text,
        "assignment_status": AssignmentStatus.TEACHER_CONFIRMED,
    }
    return EvidenceItem.model_validate(data | overrides)


def test_교사_메모_근거는_미디어와_시간_구간_없이_만들어진다() -> None:
    note = _note()

    assert note.source_type == SourceType.TEACHER_NOTE
    assert note.media_id is None
    assert note.start_ms is None and note.end_ms is None


@pytest.mark.parametrize(
    "extra",
    [{"media_id": "media-1"}, {"start_ms": 0}, {"end_ms": 1000}],
)
def test_교사_메모에_미디어나_시간_구간을_붙이면_거부한다(extra: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _note(**extra)


def test_영상_음성_근거는_여전히_미디어가_있어야_한다() -> None:
    with pytest.raises(ValidationError):
        EvidenceItem(
            evidence_id="e1",
            source_type=SourceType.TEACHER_VOICE_MEMO,
            child_ids=[CHILD],
            observed_date=DAY,
            text="블록을 쌓았어요.",
            assignment_status=AssignmentStatus.AUTO_LINKED,
        )


def test_교사_메모의_실명은_토큰으로_바뀌어_LLM_사본에만_간다() -> None:
    note = _note("서연이가 비 오는 날 우산을 직접 챙겼어요.")

    masked = pseudonymize_evidence(
        {note.evidence_id: note},
        target_child_id=CHILD,
        names_by_child_id={CHILD: ["서연"]},
    )

    (llm_item,) = masked.llm_items
    assert llm_item.source_type == SourceType.TEACHER_NOTE
    assert "서연" not in llm_item.text
    assert "CHILD_A" in llm_item.text
    # 저장에 쓰는 원본은 그대로다 — 교사 근거 패널에는 실제 메모가 보인다
    assert "서연" in note.text


def test_교사_메모만_참조한_문장은_코드_검증을_통과한다() -> None:
    note = _note()
    document = DraftDocument(
        doc_type=DocType.PARENT_NOTE,
        child_id=CHILD,
        record_date=DAY,
        sentences=[
            DraftSentence(
                sentence_id="s1", text="나뭇잎을 비교했어요.", evidence_ids=[note.evidence_id]
            )
        ],
    )

    assert validate_references(document, {note.evidence_id: note}) == []


def test_활동계획만_참조하면_여전히_관찰로_보지_않는다() -> None:
    plan = EvidenceItem(
        evidence_id="plan:1",
        source_type=SourceType.ACTIVITY_PLAN,
        child_ids=[CHILD],
        observed_date=DAY,
        text="나뭇잎 놀이",
        assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
    )
    document = DraftDocument(
        doc_type=DocType.PARENT_NOTE,
        child_id=CHILD,
        record_date=DAY,
        sentences=[DraftSentence(sentence_id="s1", text="했어요.", evidence_ids=["plan:1"])],
    )

    issues = validate_references(document, {"plan:1": plan})

    assert [issue.check_type for issue in issues] == [VerificationCheckType.PLAN_AS_OBSERVED_FACT]


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[SentenceEvidence.__table__, MediaAsset.__table__])
    with sessionmaker(bind=engine)() as session:
        yield session


def test_문장별_근거_조회는_미디어_없는_근거를_접두로_교사_메모와_활동계획으로_가른다(
    db: Session,
) -> None:
    draft_id = uuid.uuid4()
    for evidence_id, text in (
        (f"{TEACHER_NOTE_EVIDENCE_PREFIX}{uuid.uuid4()}", "교사 메모 원문"),
        ("plan:7", "활동계획"),
    ):
        db.add(
            SentenceEvidence(
                draft_id=draft_id,
                sentence_id="s1",
                evidence_id=evidence_id,
                source_media_id=None,
                source_timestamp=None,
                source_text=text,
            )
        )
    source_document_id = uuid.uuid4()
    db.add(
        SentenceEvidence(
            draft_id=draft_id,
            sentence_id="s1",
            evidence_id="parent-note:1",
            source_document_id=source_document_id,
            source_text="게시 알림장 원문",
        )
    )
    db.flush()

    views = list_sentence_evidences(db, draft_id)["s1"]

    by_text = {view.text: view for view in views}
    assert by_text["교사 메모 원문"].source_type == "teacher_note"
    assert by_text["활동계획"].source_type == "activity_plan"
    assert by_text["게시 알림장 원문"].source_type == "parent_note"
    assert by_text["게시 알림장 원문"].source_document_id == source_document_id
    assert all(view.media_id is None and view.captured_at is None for view in views)
