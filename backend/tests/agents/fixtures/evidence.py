"""검증 테스트·팀 공용 예시 근거.

child_A/child_B는 실제 원아가 아니라 파이프라인에서 실명을 치환한 예시 토큰이다
(H-2 — 실명 사용 금지). 로컬 브랜치 feat/agents-generation-pipeline의 예시를
tools/contracts.py 형식(observed_date 포함)에 맞춰 정리했다.
"""

from __future__ import annotations

from datetime import date

from tools.contracts import AssignmentStatus, EvidenceItem, SourceType

RECORD_DATE = date(2026, 9, 8)
OTHER_DATE = date(2026, 9, 7)

EVIDENCE_CHILD_A = EvidenceItem(
    evidence_id="ev_001",
    source_type=SourceType.VIDEO_SPEECH,
    child_ids=["child_A"],
    observed_date=RECORD_DATE,
    text="제가 높은 탑을 만들었어요",
    media_id="video_002",
    start_ms=12000,
    end_ms=15000,
    assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
)

EVIDENCE_CHILD_B = EvidenceItem(
    evidence_id="ev_002",
    source_type=SourceType.PHOTO_OBSERVATION,
    child_ids=["child_B"],
    observed_date=RECORD_DATE,
    text="아이가 종이에 그림을 그리고 있다.",
    media_id="photo_010",
    assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
)

# 여러 원아의 공동 활동 근거 — 특정 아이의 개별 행동으로 확대 해석하면 안 되는 사례.
EVIDENCE_COMMON_ACTIVITY = EvidenceItem(
    evidence_id="ev_003",
    source_type=SourceType.VIDEO_SCENE,
    child_ids=["child_A", "child_B"],
    observed_date=RECORD_DATE,
    text="아이들이 함께 블록을 정리하고 있다.",
    media_id="video_002",
    start_ms=20000,
    end_ms=25000,
    assignment_status=AssignmentStatus.AUTO_LINKED,
)

# 대상이 확인되지 않은 근거 — 생성에 사용하면 안 되는 사례.
EVIDENCE_UNCONFIRMED = EvidenceItem(
    evidence_id="ev_004",
    source_type=SourceType.VIDEO_SCENE,
    child_ids=[],
    observed_date=RECORD_DATE,
    text="누구인지 확인되지 않은 아동이 미끄럼틀을 타고 있다.",
    media_id="video_003",
    start_ms=5000,
    end_ms=8000,
    assignment_status=AssignmentStatus.NEEDS_CONFIRMATION,
)

# 다른 날짜의 근거 — 날짜 불일치 검사용.
EVIDENCE_OTHER_DATE = EvidenceItem(
    evidence_id="ev_005",
    source_type=SourceType.PHOTO_OBSERVATION,
    child_ids=["child_A"],
    observed_date=OTHER_DATE,
    text="child_A가 어제 그림책을 봤다.",
    media_id="photo_099",
    assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
)

# 활동계획 근거 — 실제 관찰과 구분해야 하는 사례.
EVIDENCE_ACTIVITY_PLAN = EvidenceItem(
    evidence_id="ev_006",
    source_type=SourceType.ACTIVITY_PLAN,
    child_ids=["child_A"],
    observed_date=RECORD_DATE,
    text="오늘의 활동계획: 색종이 접기",
    media_id=None,
    assignment_status=AssignmentStatus.AUTO_LINKED,
)

SAMPLE_EVIDENCE_POOL: list[EvidenceItem] = [
    EVIDENCE_CHILD_A,
    EVIDENCE_CHILD_B,
    EVIDENCE_COMMON_ACTIVITY,
    EVIDENCE_UNCONFIRMED,
    EVIDENCE_OTHER_DATE,
    EVIDENCE_ACTIVITY_PLAN,
]

EVIDENCE_BY_ID: dict[str, EvidenceItem] = {
    item.evidence_id: item for item in SAMPLE_EVIDENCE_POOL
}
