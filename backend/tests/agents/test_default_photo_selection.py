"""AI가 초안을 저장할 때 근거 사진을 보낼 사진의 기본 선택으로 넘기는지 (9주차 #257 리뷰 4번).

실제 저장과 화면에 내려가는 모양은 test_photo_pipeline.py와 tests/documents/test_save_draft.py가
본다. 여기서는 근거에서 사진 ID를 뽑는 규칙만 봅니다.
"""

import uuid
from datetime import date

from domains.agents.service import _photo_media_ids
from tools.contracts import AssignmentStatus, EvidenceItem, SourceType

DAY = date(2026, 9, 15)


def _item(evidence_id: str, source_type: SourceType, media_id: str | None) -> EvidenceItem:
    return EvidenceItem(
        evidence_id=evidence_id,
        source_type=source_type,
        child_ids=["child-1"],
        observed_date=DAY,
        text="근거",
        media_id=media_id,
        assignment_status=AssignmentStatus.AUTO_LINKED,
    )


def test_사진_근거의_media_id만_근거_순서대로_뽑고_같은_사진은_한_번만_쓴다() -> None:
    first, second = uuid.uuid4(), uuid.uuid4()
    evidence = {
        "e1": _item("e1", SourceType.PHOTO_OBSERVATION, str(first)),
        "e2": _item("e2", SourceType.VIDEO_SPEECH, str(uuid.uuid4())),
        "e3": _item("e3", SourceType.PHOTO_OBSERVATION, str(second)),
        # 같은 사진에서 나온 두 번째 관찰
        "e4": _item("e4", SourceType.PHOTO_OBSERVATION, str(first)),
        "e5": _item("e5", SourceType.ACTIVITY_PLAN, None),
        "e6": _item("e6", SourceType.TEACHER_VOICE_MEMO, str(uuid.uuid4())),
    }

    assert _photo_media_ids(evidence) == [first, second]


def test_사진_근거가_없으면_빈_목록이다() -> None:
    evidence = {"e1": _item("e1", SourceType.VIDEO_SPEECH, str(uuid.uuid4()))}

    assert _photo_media_ids(evidence) == []
    assert _photo_media_ids({}) == []
