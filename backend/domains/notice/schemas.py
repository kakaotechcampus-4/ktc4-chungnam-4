"""notice 요청·응답 스키마 (docs/api/notice.md).

교사용(`NoticeItem`)과 학부모용(`ParentNoticeItem`)을 나눕니다. 학부모 응답에는 작성 교사 ID 같은
교사 전용 필드를 싣지 않습니다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, StringConstraints

NoticeTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
NoticeContent = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)
]


class NoticeCreateRequest(BaseModel):
    title: NoticeTitle
    content: NoticeContent


class NoticeUpdateRequest(BaseModel):
    """보낸 필드만 바꿉니다. 하나도 없거나 `null`이면 service가 422로 막습니다."""

    title: NoticeTitle | None = None
    content: NoticeContent | None = None


class NoticeItem(BaseModel):
    notice_id: UUID
    class_id: UUID
    author_teacher_id: UUID
    title: str
    content: str
    created_at: datetime
    updated_at: datetime


class NoticeListResponse(BaseModel):
    items: list[NoticeItem]
    next_cursor: str | None = None


class ParentNoticeItem(BaseModel):
    notice_id: UUID
    title: str
    content: str
    created_at: datetime
    updated_at: datetime


class ParentNoticeListResponse(BaseModel):
    items: list[ParentNoticeItem]
    next_cursor: str | None = None
