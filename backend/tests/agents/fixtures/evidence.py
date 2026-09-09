"""팀 전체가 함께 쓰는 가짜 원아·근거 예시 (AI팀 개발 계획 v9 §7, 작업 상세 C 담당).

# TODO(C): 이 파일은 상균이 먼저 제공하는 공통 준비물이다. 실제 DB 모델 초안·
#   저장소 연동은 C가 이어서 맡는다. child_A/child_B는 실제 원아가 아니라
#   파이프라인에서 실명을 치환한 형태의 예시 토큰이다 (H-2 — 실명 사용 금지).
"""

from __future__ import annotations

from datetime import date

from domains.agents.schemas import AssignmentStatus, EvidenceItem, GenerationRequest, SourceType

# A아동의 근거 — 계획서 §7.1 예시와 동일
EVIDENCE_CHILD_A = EvidenceItem(
    evidence_id="ev_001",
    source_type=SourceType.VIDEO_SPEECH,
    child_ids=["child_A"],
    text="A야, 높은 탑을 만들었네",
    media_id="video_002",
    start_ms=12000,
    end_ms=15000,
    assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
)

# B아동의 근거
EVIDENCE_CHILD_B = EvidenceItem(
    evidence_id="ev_002",
    source_type=SourceType.PHOTO_CONTEXT,
    child_ids=["child_B"],
    text="아이가 종이에 그림을 그리고 있다.",
    media_id="photo_010",
    assignment_status=AssignmentStatus.TEACHER_CONFIRMED,
)

# A·B의 공통 활동 근거 — 특정 아이의 개별 행동으로 확대 해석하면 안 되는 사례 (§6)
EVIDENCE_COMMON_ACTIVITY = EvidenceItem(
    evidence_id="ev_003",
    source_type=SourceType.VIDEO_SCENE,
    child_ids=["child_A", "child_B"],
    text="아이들이 함께 블록을 정리하고 있다.",
    media_id="video_002",
    start_ms=20000,
    end_ms=25000,
    assignment_status=AssignmentStatus.AUTO_LINKED,
)

# 대상이 확인되지 않은 근거 — 생성에 사용하면 안 되는 사례 (§6 "확인되지 않은 근거는 제외")
EVIDENCE_UNCONFIRMED = EvidenceItem(
    evidence_id="ev_004",
    source_type=SourceType.VIDEO_SCENE,
    child_ids=[],
    text="누구인지 확인되지 않은 아동이 미끄럼틀을 타고 있다.",
    media_id="video_003",
    start_ms=5000,
    end_ms=8000,
    assignment_status=AssignmentStatus.NEEDS_CONFIRMATION,
)

SAMPLE_EVIDENCE_POOL: list[EvidenceItem] = [
    EVIDENCE_CHILD_A,
    EVIDENCE_CHILD_B,
    EVIDENCE_COMMON_ACTIVITY,
    EVIDENCE_UNCONFIRMED,
]

# 원아 한 명(child_A) 흐름 확인용 기본 요청 — 이번 주 완료 기준 시나리오에 사용
SAMPLE_REQUEST_CHILD_A = GenerationRequest(
    request_id="req_001",
    class_id="class_01",
    record_date=date(2026, 9, 8),
    evidence_ids=["ev_001", "ev_003"],
)
