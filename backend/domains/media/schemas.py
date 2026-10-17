"""media 도메인 요청·응답 스키마 (docs/api/media-face.md).

ORM 모델을 그대로 내보내지 않습니다 — `storage_url`(S3 경로)·`teacher_id` 같은 내부 값이
응답에 섞이지 않게 필요한 필드만 옮깁니다(backend/CLAUDE.md "스키마와 예외").
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field, model_validator

from domains.media.service import Attribution, AttributionInput, UploadRequestItem

MediaType = Literal["photo", "video", "voice_memo"]
AttributionMethod = Literal["face_recognition", "manual"]


class ErrorBody(BaseModel):
    """공통 에러 모양의 `code`·`message`. 묶음 요청 안의 파일 하나가 실패했을 때 씁니다."""

    code: str
    message: str


# ---- POST /media/upload-urls ----


class UploadUrlRequestItem(BaseModel):
    client_photo_id: UUID
    type: MediaType
    # 형식 검사는 서버가 파일마다 합니다. 빈 값도 받아서 그 파일만 MEDIA_TYPE_NOT_ALLOWED로 돌려줍니다
    content_type: str
    size_bytes: int = Field(gt=0)

    def to_item(self) -> UploadRequestItem:
        return UploadRequestItem(
            client_photo_id=self.client_photo_id,
            media_type=self.type,
            content_type=self.content_type,
            size_bytes=self.size_bytes,
        )


class UploadUrlsRequest(BaseModel):
    class_id: UUID
    # 개수 상한(UPLOAD_MAX_FILES_PER_REQUEST)은 설정값이라 서비스가 검사합니다
    items: list[UploadUrlRequestItem] = Field(min_length=1)


class UploadUrlResponseItem(BaseModel):
    """파일 하나의 결과. `status`에 따라 채워지는 필드가 다릅니다.

    - `issued`: `upload_url`·`upload_headers`·`upload_url_expires_at`
    - `registered`: 이미 확정된 파일이라 `media_id`만
    - `error`: 이 파일만 실패, `error`
    """

    client_photo_id: UUID
    status: Literal["issued", "registered", "error"]
    media_id: UUID | None = None
    upload_url: str | None = None
    upload_headers: dict[str, str] | None = None
    upload_url_expires_at: datetime | None = None
    error: ErrorBody | None = None


class UploadUrlsResponse(BaseModel):
    items: list[UploadUrlResponseItem]


# ---- 귀속 (POST /media의 사진) ----


class ChildLinkBody(BaseModel):
    child_id: UUID
    method: AttributionMethod
    # face_recognition일 때만 채우고 manual이면 null. 짝 검사는 서비스가 합니다
    confidence_score: float | None = None

    def to_attribution(self) -> Attribution:
        return Attribution(
            child_id=self.child_id, method=self.method, confidence_score=self.confidence_score
        )


# ---- POST /media ----


class MediaCompleteRequest(BaseModel):
    """업로드 완료 통지. 사진은 귀속이 필수, 영상·음성은 귀속을 받지 않습니다.

    영상·음성은 교사 확인 전에 먼저 올라오므로 귀속을 나중에 따로 저장합니다. 그 방식
    (파일 단위 선택 / 발화 연결로 계산)은 BE·AI 회의에서 정합니다(#142).
    """

    client_photo_id: UUID
    class_id: UUID
    type: MediaType
    captured_at: AwareDatetime  # 시간대가 없으면 KST·UTC를 구분할 수 없어 받지 않습니다
    model_version: str | None = None
    llm_allowed: bool | None = None
    child_links: list[ChildLinkBody] | None = None

    @model_validator(mode="after")
    def attribution_matches_type(self) -> Self:
        has_attribution = self.llm_allowed is not None or self.child_links is not None
        if self.type == "photo" and (self.llm_allowed is None or self.child_links is None):
            raise ValueError("사진은 child_links와 llm_allowed를 함께 보내야 합니다.")
        if self.type != "photo" and has_attribution:
            raise ValueError("영상·음성은 완료 통지에 귀속을 싣지 않습니다.")
        return self

    def to_attribution(self) -> AttributionInput | None:
        """사진이면 귀속, 영상·음성이면 None. 짝은 위 검사가 이미 맞춰 두었습니다."""
        if self.llm_allowed is None or self.child_links is None:
            return None
        return AttributionInput(
            llm_allowed=self.llm_allowed,
            child_links=[link.to_attribution() for link in self.child_links],
        )


class MediaAssetResponse(BaseModel):
    """확정된 미디어. 서명 URL은 싣지 않습니다(내려줄 때 따로 서명합니다)."""

    media_id: UUID
    client_photo_id: UUID
    class_id: UUID
    type: MediaType
    captured_at: datetime
    size_bytes: int
    llm_allowed: bool
    child_links: list[ChildLinkBody]
    attributed_at: datetime | None


# ---- GET /media/{media_id} ----


class MediaUrlResponse(BaseModel):
    """재발급한 서명 URL. `storage_url`·`teacher_id`·`model_version`은 싣지 않습니다."""

    media_id: UUID
    type: MediaType
    captured_at: datetime
    url: str
    url_expires_at: datetime
