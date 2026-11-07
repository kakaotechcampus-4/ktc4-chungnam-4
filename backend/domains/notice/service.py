"""notice 서비스 — 교사의 공지 등록·수정·삭제와 학부모의 공지 확인 (FR-11, FR-12).

권한 판정은 organization의 함수 한 곳씩만 부릅니다. 교사는 `ensure_class_access`(같은 어린이집),
학부모는 `ensure_parent_child_access`(알림장과 같은 자녀 접근 검사)를 통과한 뒤 **자녀의 반** 공지만
읽습니다. 반 단위라 다른 반·다른 어린이집 공지는 어떤 경로로도 나가지 않습니다.

쓰기 함수는 커밋합니다. 학부모 열람은 `AccessLog`를 남기고 커밋한 뒤에 돌려줍니다 (NFR-05, E-4).
"""

from __future__ import annotations

import base64
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from core.exceptions import AccessLogFailed, InvalidCursor, NoticeNotFound, RequestValidationFailed
from domains.audit import service as audit_service
from domains.notice.models import Notice
from domains.notice.schemas import (
    NoticeCreateRequest,
    NoticeItem,
    NoticeListResponse,
    NoticeUpdateRequest,
    ParentNoticeItem,
    ParentNoticeListResponse,
)
from domains.organization import service as organization_service

# AccessLog.target_type 값 (audit/CLAUDE.md의 폴리모픽 기록).
_ACCESS_TARGET_NOTICE = "notice"


def _item(notice: Notice) -> NoticeItem:
    return NoticeItem(
        notice_id=notice.id,
        class_id=notice.class_id,
        author_teacher_id=notice.teacher_id,
        title=notice.title,
        content=notice.content,
        created_at=notice.created_at,
        updated_at=notice.updated_at,
    )


def _parent_item(notice: Notice) -> ParentNoticeItem:
    return ParentNoticeItem(
        notice_id=notice.id,
        title=notice.title,
        content=notice.content,
        created_at=notice.created_at,
        updated_at=notice.updated_at,
    )


def _as_utc(value: datetime) -> datetime:
    # SQLite는 시간대를 저장하지 않는다. DB에는 UTC로 저장한다 (backend/CLAUDE.md).
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _encode_cursor(notice: Notice) -> str:
    raw = f"{_as_utc(notice.created_at).isoformat()}|{notice.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str | None) -> tuple[datetime, UUID] | None:
    """다음 쪽은 이 공지보다 오래된 것부터다. 같은 시각이면 id로 가른다."""
    if cursor is None:
        return None
    try:
        created_at, notice_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(created_at), UUID(notice_id)
    except ValueError:
        raise InvalidCursor("목록 위치를 읽을 수 없습니다.") from None


def _page(
    db: Session, class_id: UUID, limit: int, cursor: str | None
) -> tuple[list[Notice], str | None]:
    """반의 공지 한 쪽(최신순)과 다음 커서. 한 건 더 읽어 다음 쪽이 있는지 판단한다."""
    stmt = select(Notice).where(Notice.class_id == class_id)
    after = _decode_cursor(cursor)
    if after is not None:
        created_at, notice_id = after
        stmt = stmt.where(
            or_(
                Notice.created_at < created_at,
                and_(Notice.created_at == created_at, Notice.id < notice_id),
            )
        )
    rows = list(
        db.scalars(stmt.order_by(Notice.created_at.desc(), Notice.id.desc()).limit(limit + 1))
    )
    page = rows[:limit]
    return page, _encode_cursor(page[-1]) if len(rows) > limit else None


def _notice_for_teacher(db: Session, notice_id: UUID, center_id: UUID | None) -> Notice:
    """공지를 찾고 그 반에 교사가 접근할 수 있는지 확인한다.

    - 없는 공지: `NoticeNotFound` (404 `NOTICE_NOT_FOUND`)
    - 다른 어린이집 반의 공지: `ClassAccessDenied` (403 `CLASS_ACCESS_DENIED`)
    """
    notice = db.get(Notice, notice_id)
    if notice is None:
        raise NoticeNotFound("공지를 찾을 수 없습니다.")
    organization_service.ensure_class_access(db, notice.class_id, center_id)
    return notice


def list_class_notices(
    db: Session, *, class_id: UUID, center_id: UUID | None, limit: int, cursor: str | None
) -> NoticeListResponse:
    """교사가 반의 공지 목록을 본다 (FR-11). 최신순."""
    organization_service.ensure_class_access(db, class_id, center_id)
    page, next_cursor = _page(db, class_id, limit, cursor)
    return NoticeListResponse(items=[_item(notice) for notice in page], next_cursor=next_cursor)


def create_notice(
    db: Session,
    *,
    class_id: UUID,
    center_id: UUID | None,
    teacher_id: UUID,
    request: NoticeCreateRequest,
) -> NoticeItem:
    """공지를 등록한다 (FR-11). 저장하면 곧 그 반 학부모에게 보인다 — 승인 단계가 없다.

    같은 어린이집 교사면 어느 반에나 등록한다(담당교사 폐지). `teacher_id`는 작성 기록이다.
    """
    organization_service.ensure_class_access(db, class_id, center_id)
    notice = Notice(
        class_id=class_id, teacher_id=teacher_id, title=request.title, content=request.content
    )
    db.add(notice)
    db.commit()
    return _item(notice)


def get_notice(db: Session, *, notice_id: UUID, center_id: UUID | None) -> NoticeItem:
    """교사가 공지 하나를 본다 (수정 화면)."""
    return _item(_notice_for_teacher(db, notice_id, center_id))


def update_notice(
    db: Session, *, notice_id: UUID, center_id: UUID | None, request: NoticeUpdateRequest
) -> NoticeItem:
    """보낸 필드만 바꾼다. 하나도 없거나 `null`이면 막는다 (422 VALIDATION_ERROR)."""
    notice = _notice_for_teacher(db, notice_id, center_id)
    changes = request.model_dump(exclude_unset=True)
    if not changes or any(value is None for value in changes.values()):
        raise RequestValidationFailed("수정할 제목이나 내용을 보내 주세요.")
    for field, value in changes.items():
        setattr(notice, field, value)
    db.commit()
    return _item(notice)


def delete_notice(db: Session, *, notice_id: UUID, center_id: UUID | None) -> None:
    """공지를 지운다. 물리 삭제다 — 승인·회수 흐름이 없는 글이다."""
    notice = _notice_for_teacher(db, notice_id, center_id)
    db.delete(notice)
    db.commit()


def list_notices_for_parent(
    db: Session, *, child_id: UUID, parent_id: UUID, limit: int, cursor: str | None
) -> ParentNoticeListResponse:
    """학부모가 자녀 반의 공지 목록을 본다 (FR-12). 담은 공지마다 `view_list`를 남긴다."""
    class_id = _parent_child_class_id(db, parent_id, child_id)
    page, next_cursor = _page(db, class_id, limit, cursor)
    response = ParentNoticeListResponse(
        items=[_parent_item(notice) for notice in page], next_cursor=next_cursor
    )
    _record_parent_views(db, parent_id, [notice.id for notice in page], "view_list")
    return response


def get_notice_for_parent(
    db: Session, *, child_id: UUID, notice_id: UUID, parent_id: UUID
) -> ParentNoticeItem:
    """학부모가 공지 본문을 본다 (FR-12). 자녀 반의 공지가 아니면 없는 것으로 본다."""
    class_id = _parent_child_class_id(db, parent_id, child_id)
    notice = db.scalar(select(Notice).where(Notice.id == notice_id, Notice.class_id == class_id))
    if notice is None:
        raise NoticeNotFound("공지를 찾을 수 없습니다.")
    response = _parent_item(notice)
    _record_parent_views(db, parent_id, [notice.id], "view_detail")
    return response


def _parent_child_class_id(db: Session, parent_id: UUID, child_id: UUID) -> UUID:
    """학부모 노출 경로의 단일 관문 — 자녀 접근 검사를 통과해야 자녀의 반을 알려 준다.

    - 자녀가 아님: `ChildAccessDenied` (403), 열람 기간이 지남: `ChildAccessExpired` (403)
    """
    organization_service.ensure_parent_child_access(db, parent_id, child_id)
    return organization_service.get_child_class_id(db, child_id)


def _record_parent_views(
    db: Session, parent_id: UUID, notice_ids: Sequence[UUID], action: str
) -> None:
    """학부모 열람을 남기고 커밋한다. 실패하면 응답하지 않도록 드러낸다 (NFR-05, H-4: ID만)."""
    try:
        for notice_id in notice_ids:
            audit_service.record_access(
                db,
                actor_type="parent",
                actor_id=parent_id,
                target_type=_ACCESS_TARGET_NOTICE,
                target_id=notice_id,
                action=action,
            )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise AccessLogFailed("열람 기록을 남기지 못해 공지를 보여 드릴 수 없습니다.") from None
