"""perception(발화·사진 정규화) 입출력 타입.

perception은 domains를 import하지 않는다. agents/service가 media 행을 아래 입력 타입으로
옮겨 담아 넘기고, 결과로 tools.contracts.EvidenceItem 목록과 버린 입력의 사유를 받는다.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal, Self

from pydantic import AwareDatetime, ConfigDict, Field, model_validator

from tools.contracts import ContractModel, EvidenceItem, NonEmpty


class AudioSource(StrEnum):
    """발화 구간의 출처 (테크스펙 TranscriptSegment.source)."""

    VIDEO_AUDIO = "video_audio"
    VOICE_MEMO = "voice_memo"


class Speaker(StrEnum):
    """교사가 분류한 화자 (테크스펙 TranscriptSegment.speaker). 분류 전이면 None."""

    CHILD = "child"
    TEACHER_OBSERVATION = "teacher_observation"
    TOGETHER = "together"


class TranscriptSegmentInput(ContractModel):
    """교사 확인을 거친 발화 구간 한 개 (테크스펙 TranscriptSegment·TranscriptChildLink).

    raw_text·text에는 실명 호명이 그대로 있을 수 있어 로그에 찍지 않는다 (H-4).
    """

    # 검증 오류의 str()·traceback에 입력을 싣지 않는다. e.errors()·e.json()에는 남으므로
    # 기록할 때는 include_input=False로 부른다 (H-4).
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    segment_id: NonEmpty
    media_id: NonEmpty  # 서버 UUID 문자열
    source: AudioSource
    captured_at: AwareDatetime  # MediaAsset 촬영 시각
    start_time: float | None  # 초, 파일 처음부터
    end_time: float | None
    raw_text: str  # STT 원문. 인식 실패 시 "멘트 없음"
    text: str  # 교사 수정본. 안 고쳤으면 raw_text와 같음
    speaker: Speaker | None
    child_ids: tuple[NonEmpty, ...]  # TranscriptChildLink
    excluded: bool


class ChildLink(ContractModel):
    """사진 한 장에 귀속된 원아 한 명 (테크스펙 MediaChildLink). method도 같은 값을 쓴다."""

    child_id: NonEmpty
    method: Literal["face_recognition", "manual"]  # 로컬 자동 / 로컬 수동


class PhotoInput(ContractModel):
    """LLM에 보낸 활동 사진 한 장 (테크스펙 MediaAsset·MediaChildLink).

    귀속이 끝나고 동의 판정을 통과한 사진만 들어오므로 links는 1개 이상이다 (H-2).
    """

    # TranscriptSegmentInput과 같은 이유로 검증 오류 문자열에 입력을 싣지 않는다 (H-4).
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    media_id: NonEmpty  # 서버 UUID 문자열
    captured_at: AwareDatetime  # MediaAsset 촬영 시각
    links: tuple[ChildLink, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_children(self) -> Self:
        if len({link.child_id for link in self.links}) != len(self.links):
            raise ValueError("duplicate child_id in links")
        return self

    @property
    def child_ids(self) -> tuple[str, ...]:
        """귀속 원아 ID(정렬·고유). 프롬프트에 보내는 아이 수는 이 길이다."""
        return tuple(sorted({link.child_id for link in self.links}))


class DropReason(StrEnum):
    """근거로 만들지 않은 사유."""

    EXCLUDED_BY_TEACHER = "excluded_by_teacher"
    NO_CHILD_LINK = "no_child_link"
    NOT_TARGET_CHILD = "not_target_child"
    DATE_MISMATCH = "date_mismatch"
    STT_NO_SPEECH = "stt_no_speech"
    EMPTY_TEXT = "empty_text"
    UNMAPPED_SPEAKER = "unmapped_speaker"
    AMBIGUOUS_ACTOR = "ambiguous_actor"  # 사진의 아이 수와 관찰 scope가 맞지 않음
    NO_VISIBLE_OBSERVATION = "no_visible_observation"  # 사진에서 쓸 관찰이 없다고 응답함
    PHOTO_NOT_ANSWERED = "photo_not_answered"  # 사진 분석 응답에 그 사진이 빠짐
    PHOTO_RESPONSE_ERROR = "photo_response_error"  # 재시도 뒤에도 그 사진의 분석 응답이 형식 위반


class Dropped(ContractModel):
    """버린 입력 한 건. source_id는 발화면 segment_id, 사진이면 media_id다.

    원문은 남기지 않고 사유만 둔다 (H-4). 사진 한 장에서 관찰 여러 개를 버리면 같은
    source_id가 여러 번 나올 수 있다.
    """

    source_id: NonEmpty
    reason: DropReason


class PerceptionStatus(StrEnum):
    OK = "ok"  # items 1개 이상
    EMPTY = "empty"  # 정상 처리했지만 쓸 근거가 없음
    RESPONSE_ERROR = "response_error"  # 사진 분석 응답이 JSON·스키마 위반. 재시도는 service가 판단


class PerceptionResult(ContractModel):
    """perception 결과.

    items[].text는 비식별화 전 원문(교사 수정본)이라 실명이 남아 있을 수 있다.
    서버 내부용이며, 3단계 비식별화(CHILD_A 토큰 치환)를 거치기 전에는 LLM으로 보내지
    않는다 (H-2). 로그에도 찍지 않는다 (H-4).
    """

    # TranscriptSegmentInput과 같은 이유로 검증 오류 문자열에 입력을 싣지 않는다 (H-4).
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    status: PerceptionStatus
    items: list[EvidenceItem]
    dropped: list[Dropped]

    @model_validator(mode="after")
    def consistent_status(self) -> Self:
        if self.status == PerceptionStatus.OK and not self.items:
            raise ValueError("ok result requires items")
        if self.status != PerceptionStatus.OK and self.items:
            raise ValueError(f"{self.status} result must not have items")
        return self
