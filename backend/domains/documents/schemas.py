"""documents 도메인 요청·응답 스키마.

교사용과 학부모용 응답을 반드시 분리한다 — 같은 스키마를 재사용하면 미승인
본문이 새는 경로가 생긴다 (CLAUDE.md H-1, documents/CLAUDE.md).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from domains.documents.models import DocType, DraftStatus

# ---- agents → documents (API 아님) ----


class DraftSentenceInput(BaseModel):
    """초안 문장 하나. sentence_id는 contracts.DraftSentence.sentence_id를 그대로 받는다."""

    # 검증 오류 문자열에 문장 본문을 싣지 않는다 — 본문에는 원아 이름이 들어 있다 (H-4).
    model_config = ConfigDict(hide_input_in_errors=True)

    sentence_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class DraftSaveInput(BaseModel):
    """agents가 최종 통과(PASS)한 생성 결과를 save_draft()로 넘길 때 쓰는 값.

    tools/contracts.py의 DraftDocument를 그대로 받지 않는다 — documents는 tools/를
    참조할 수 없으므로(backend/CLAUDE.md 계층 규칙) 변환은 agents 쪽에서 한다.

    - draft_id: 최초 저장이면 None일 수 있다(서버가 발급). 갱신이면 필수.
      최초 ID를 누가 언제 만드는지는 정은님 확인 전이라 양쪽을 다 받는다 (#35).
    - ai_version: contracts.DraftDocument.version(AI 생성 회차). 잠금용
      DraftDocument.version과 다르다.
    - sentences: agents가 만든 문장 단위·순서 그대로 받는다. 합치지 않는다 (#75).
    """

    model_config = ConfigDict(hide_input_in_errors=True)

    draft_id: UUID | None = None
    child_id: UUID
    author_teacher_id: UUID
    doc_type: DocType
    record_date: date
    sentences: list[DraftSentenceInput] = Field(min_length=1)
    ai_version: int = Field(ge=1)
    evidence_bundle_id: UUID | None = None

    @field_validator("sentences")
    @classmethod
    def _unique_sentence_ids(cls, sentences: list[DraftSentenceInput]) -> list[DraftSentenceInput]:
        # 같은 ID가 두 번 오면 근거가 어느 문장을 가리키는지 정할 수 없다.
        ids = [sentence.sentence_id for sentence in sentences]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate sentence_id")
        return sentences


class DraftVersionInfo(BaseModel):
    """get_draft_version() 결과. agents가 재생성으로 저장할지 건너뛸지 정하는 데 쓴다 (#75 5번).

    - version: 잠금용 DraftDocument.version. 재생성이면 save_draft(expected_version=...)에
      그대로 넘긴다. AI 회차(ai_version)와 다르다.
    - has_teacher_edits: 교사가 이 초안을 한 번이라도 수정·승인·회수했는지. true면 AI 결과로
      덮어쓰지 않는다 (#75 6-1).
    """

    model_config = ConfigDict(frozen=True)

    draft_id: UUID
    version: int
    status: DraftStatus
    has_teacher_edits: bool


# ---- 교사용 ----


class DraftSummary(BaseModel):
    """반·날짜 목록의 문서 한 건. 본문 대신 앞부분 미리보기만 싣는다."""

    draft_id: UUID
    status: DraftStatus
    version: int
    # 활성 게시 회차의 게시 시각. 게시 전이면 null이다 (승인·게시 분리).
    published_at: datetime | None
    preview: str


class UnclassifiedSummary(BaseModel):
    reason: str


class ClassDraftItem(BaseModel):
    """원아 한 명의 그날 문서. 원아 이름은 싣지 않는다 — FE가 organization 명단과 합친다."""

    child_id: UUID
    observation_log: DraftSummary | None = None
    parent_note: DraftSummary | None = None
    # TODO(한상균): 초안 없이 미분류로 끝난 원아의 사유. agents가 미분류를 기록하고
    #   (_send_to_unclassified) 원아·날짜로 찾을 길이 생기면 채운다. 그전까지 항상 null.
    unclassified: UnclassifiedSummary | None = None


class ClassDraftListResponse(BaseModel):
    """GET /api/v1/classes/{class_id}/drafts. 반 단위라 페이지를 나누지 않는다."""

    items: list[ClassDraftItem]
    next_cursor: str | None = None


class ChildDraftItem(DraftSummary):
    """원아별 문서 목록 한 줄. 날짜 이동에 필요한 값만 싣는다 — 임시 결정(김진하)."""

    record_date: date


class ChildDraftListResponse(BaseModel):
    """GET /api/v1/children/{child_id}/drafts. 한 원아 기준이라 페이지를 나누지 않는다
    (학기 단위로도 백 건 남짓 — 임시 결정(김진하))."""

    items: list[ChildDraftItem]
    next_cursor: str | None = None


class EvidenceView(BaseModel):
    """문장 하나를 뒷받침하는 근거. 사진·계획 근거는 start_ms·end_ms가 없다."""

    evidence_id: str
    source_type: str
    text: str
    media_id: UUID | None
    start_ms: int | None
    end_ms: int | None
    captured_at: datetime | None


class DraftSentenceView(BaseModel):
    sentence_id: str
    text: str
    is_edited_by_teacher: bool
    # 교사가 고친 문장·새로 쓴 문장은 빈 배열이다 (docs/api/documents.md §PATCH).
    evidences: list[EvidenceView]


class MediaUrl(BaseModel):
    """서명 URL. 만료되면 GET /api/v1/media/{media_id}로 다시 받는다."""

    media_id: UUID
    type: str
    url: str
    url_expires_at: datetime


class DraftDetailResponse(BaseModel):
    """교사용 초안 상세. 승인 전 본문도 싣는다 (H-1 — 검수 권한 교사 한정).

    수정·승인·승인 되돌리기도 이 모양으로 돌려준다 (docs/api/documents.md). 학부모 응답과
    스키마를 나눈다 — status·version·근거는 교사에게만 보인다.
    """

    draft_id: UUID
    child_id: UUID
    doc_type: DocType
    record_date: date
    status: DraftStatus
    version: int
    # AI가 제목을 만들지 않아 지금은 늘 null이다.
    title: str | None
    sentences: list[DraftSentenceView]
    selected_media_ids: list[UUID]
    media: list[MediaUrl]
    author_teacher_id: UUID
    author_name: str
    approved_at: datetime | None
    # 활성 게시 회차의 게시 시각. 게시 전이면 null이다 (승인·게시 분리).
    published_at: datetime | None
    include_photos: bool | None
    updated_at: datetime


class SentenceEdit(BaseModel):
    # 앞뒤 공백을 지운 뒤 길이를 본다 — 공백만 있는 문장은 422, 공백만 다른 문장은 그대로인 문장이다.
    model_config = ConfigDict(hide_input_in_errors=True, str_strip_whitespace=True)

    sentence_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class AddedSentence(BaseModel):
    model_config = ConfigDict(hide_input_in_errors=True, str_strip_whitespace=True)

    text: str = Field(min_length=1)


class DraftUpdateRequest(BaseModel):
    """PATCH /api/v1/drafts/{draft_id}. 교사가 문장을 직접 고치거나 새 문장을 덧붙인다 (FR-17).

    sentences에는 바뀐 문장만 sentence_id와 함께 보낸다. 본문 전체를 바꾸지 않는 것은 문장과
    근거의 연결이 어긋나지 않게 하려는 것이다 (#75). expected_version이 현재 버전과 다르면
    충돌로 거부한다.
    """

    # 검증 오류 문자열에 문장 본문을 싣지 않는다 — 본문에는 원아 이름이 들어 있다 (H-4).
    model_config = ConfigDict(hide_input_in_errors=True)

    expected_version: int = Field(ge=1)
    sentences: list[SentenceEdit] = Field(default_factory=list)
    added_sentences: list[AddedSentence] = Field(default_factory=list)
    # 알림장에 보일 사진의 순서. 보내지 않으면 그대로 둔다.
    selected_media_ids: list[UUID] | None = None

    @model_validator(mode="after")
    def _has_change_and_unique_ids(self) -> DraftUpdateRequest:
        if not self.sentences and not self.added_sentences and self.selected_media_ids is None:
            raise ValueError("sentences·added_sentences·selected_media_ids 중 하나는 있어야 합니다")
        ids = [edit.sentence_id for edit in self.sentences]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate sentence_id")
        media_ids = self.selected_media_ids or []
        if len(media_ids) != len(set(media_ids)):
            raise ValueError("duplicate media_id")
        return self


class DraftCreateRequest(BaseModel):
    """POST /api/v1/children/{child_id}/drafts. 자료 없는 원아의 초안을 교사가 직접 쓴다.

    사진·발화가 없어 근거를 함께 받지 않는다 — 임시 결정(김진하). sentences는 교사가 쓴 글을
    줄바꿈으로 나눈 순서다. 제목은 저장할 칸이 없어(AI 초안도 null) null만 받는다 — 보낸
    제목을 말없이 버리지 않으려는 것이다. 임시 결정(한상균).
    """

    model_config = ConfigDict(hide_input_in_errors=True)

    record_date: date
    doc_type: DocType
    title: None = None
    sentences: list[AddedSentence] = Field(min_length=1)


class ApproveRequest(BaseModel):
    """POST /api/v1/drafts/{draft_id}/approve.

    reviewed는 "지금 화면에 보이는 최신 본문을 확인하고 승인한다"는 교사의 표시다. 화면을
    새로고침하지 않은 채 오래된 내용을 승인하는 것을 막는다. expected_version과 별개로 항상
    True를 요구하고, 아니면 422다. 이전 이름 review_confirmed는 용어표의 금지어(confirm)라
    API 문서 이름으로 바꿨다.
    """

    expected_version: int = Field(ge=1)
    reviewed: Literal[True]


class ReopenRequest(BaseModel):
    """POST /api/v1/drafts/{draft_id}/reopen. 게시 전 승인을 되돌린다 (임시 결정(김진하))."""

    expected_version: int = Field(ge=1)


class PublishItem(BaseModel):
    draft_id: UUID
    expected_version: int = Field(ge=1)


class PublishRequest(BaseModel):
    """POST /api/v1/publications. 승인된 알림장을 학부모에게 게시한다(일괄, 건별 결과).

    request_id는 게시 버튼을 누를 때마다 새로 만든다. 같은 (request_id, draft_id)를 다시
    보내면 새 회차를 만들지 않고 처음 결과를 돌려준다. include_photos는 "사진도 함께
    보내기"로 반 전체에 한 번 정한다 (임시 결정(김진하)).
    """

    request_id: str = Field(min_length=1)
    include_photos: bool
    items: list[PublishItem] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def _unique_drafts(cls, items: list[PublishItem]) -> list[PublishItem]:
        ids = [item.draft_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate draft_id")
        return items


class PublicationResult(BaseModel):
    """건별 결과. 하나가 실패해도 나머지는 게시된다 (docs/api/documents.md).

    parent_note_id는 draft_id와 같다 — 다시 게시해도 학부모 링크가 유지된다. 없는 초안이면
    child_id·version이 null이다.
    """

    draft_id: UUID
    child_id: UUID | None
    status: Literal["published", "failed"]
    parent_note_id: UUID | None
    version: int | None
    published_at: datetime | None
    error_code: str | None


class PublishResponse(BaseModel):
    results: list[PublicationResult]


class RevokeRequest(BaseModel):
    expected_version: int = Field(ge=1)


class RevokeResponse(BaseModel):
    draft_id: UUID
    publication_id: UUID
    revoked_at: datetime
    version: int


# ---- 학부모용 ----
# 학부모 응답에는 status·version·근거가 없다 — 교사용과 스키마를 나눈다 (H-1, documents/CLAUDE.md).


class ParentNoteSummary(BaseModel):
    """학부모 목록의 알림장 한 건. 본문 대신 앞부분 미리보기만 싣는다."""

    parent_note_id: UUID
    record_date: date
    published_at: datetime
    preview: str
    # 앞 3장. "사진도 함께 보내기"를 끄고 게시했으면 빈 배열이다.
    photos: list[MediaUrl]
    is_read: bool


class ParentNoteListResponse(BaseModel):
    items: list[ParentNoteSummary]
    next_cursor: str | None
    unread_count: int
    # KST 기준 이번 달 알림장 수(제안). 기록 날짜(record_date)로 센다.
    this_month_count: int


class ParentNoteLink(BaseModel):
    parent_note_id: UUID
    record_date: date


class ParentNoteDetailResponse(BaseModel):
    """학부모 본문. 단일 게이트를 통과한 게시본만 여기로 온다 (H-1)."""

    parent_note_id: UUID
    child_id: UUID
    record_date: date
    # 문장 단위로 줄을 바꾼다(\n).
    content: str
    photos: list[MediaUrl]
    author_name: str
    published_at: datetime
    # 같은 자녀의 이전(더 오래된)·다음(더 최근) 게시본 (제안)
    prev: ParentNoteLink | None
    next: ParentNoteLink | None
