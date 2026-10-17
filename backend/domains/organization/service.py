"""organization 판정·조회 함수.

face·media·agents는 organization 테이블(Child·ConsentRecord 등)을 직접 조회하지 않고
이 함수들을 부릅니다 (backend/CLAUDE.md 계층 규칙). 동의 규칙이 바뀌어도 이 파일
한 곳만 고치면 되도록 판정을 여기로 모읍니다 (#105, FR-04, H-2, H-3).

조회만 하므로 커밋·flush하지 않습니다.
"""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import ColumnElement, Exists, select
from sqlalchemy.orm import Session

from core.exceptions import (
    ChildAccessDenied,
    ChildNotFound,
    ChildNotInClass,
    ClassAccessDenied,
    ClassNotFound,
)
from domains.organization.models import Center, Child, ConsentRecord, Klass
from domains.organization.schemas import (
    ClassChildItem,
    ClassChildListResponse,
    ClassItem,
    ClassListResponse,
)

# Child.status 값 — 재원 원아만 동의 판정 대상입니다 (졸업·퇴소 제외).
CHILD_STATUS_ENROLLED = "enrolled"
# ConsentRecord.status 값. 철회는 같은 행의 revoked_at을 채우므로 둘 다 봅니다.
CONSENT_STATUS_AGREED = "agreed"


def _valid_consent_exists(child_id: ColumnElement[UUID] | UUID, consent_type: str) -> Exists:
    """그 원아에게 `consent_type`의 유효한 동의 행이 하나라도 있는가.

    유효한 행은 `status == "agreed"`이고 `revoked_at`이 비어 있는 행입니다. 동의 판정
    함수가 모두 이 조건 하나를 쓰도록 모아, 규칙이 바뀔 때 한쪽만 고쳐지지 않게 합니다.
    """
    return (
        select(ConsentRecord.id)
        .where(
            ConsentRecord.child_id == child_id,
            ConsentRecord.consent_type == consent_type,
            ConsentRecord.status == CONSENT_STATUS_AGREED,
            ConsentRecord.revoked_at.is_(None),
        )
        .exists()
    )


def get_consented_children(db: Session, class_id: UUID, consent_type: str) -> list[UUID]:
    """해당 반에서 그 동의가 유효한 재원 원아의 id 목록.

    유효한 동의 행(`status == "agreed"`이고 `revoked_at`이 비어 있음)이 **하나라도 있으면**
    포함합니다. 철회 후 다시 동의해 새 행이 생긴 원아도 들어가도록 "철회 행이 있으면 제외"가
    아니라 "유효한 행이 있으면 포함"으로 판정합니다. 동의 행이 없는 원아(미동의)는 빠집니다.

    `consent_type`은 영문 값(`personal_info`·`activity_media`·`face_feature`)입니다.
    해당 원아가 없으면 빈 리스트를 돌려주고, 이름·생년월일은 넘기지 않습니다 (H-2).
    """
    stmt = (
        select(Child.id)
        .where(
            Child.class_id == class_id,
            Child.status == CHILD_STATUS_ENROLLED,
            _valid_consent_exists(Child.id, consent_type),
        )
        .order_by(Child.id)
    )
    return list(db.scalars(stmt))


def ensure_class_access(db: Session, class_id: UUID, center_id: UUID | None) -> None:
    """교사가 이 반에 접근해도 되는지 확인하고, 안 되면 예외를 올립니다.

    같은 어린이집(center) 소속 교사는 모든 반에 접근합니다 (FR-25, 담당교사 개념 폐지).
    교사의 `center_id`는 auth 로그인 의존성이 확인해 넘깁니다 — organization은 auth의
    교사 테이블을 조회하지 않고 반의 `center_id`와만 비교합니다 (#105). 아직 소속이 없는
    교사(`center_id`가 None)는 어느 반과도 같지 않아 `ClassAccessDenied`가 됩니다.

    - 없는 반: `ClassNotFound` (404 `CLASS_NOT_FOUND`)
    - 다른 어린이집의 반: `ClassAccessDenied` (403 `CLASS_ACCESS_DENIED`)
    """
    class_center_id = db.scalar(select(Klass.center_id).where(Klass.id == class_id))
    if class_center_id is None:
        raise ClassNotFound("반을 찾을 수 없습니다.")
    if class_center_id != center_id:
        raise ClassAccessDenied("이 반에 접근할 권한이 없습니다.")


def ensure_child_access(db: Session, child_id: UUID, center_id: UUID) -> None:
    """교사가 이 원아에 접근해도 되는지 확인하고, 안 되면 예외를 올립니다.

    원아의 반이 속한 어린이집과 교사의 `center_id`를 비교합니다 (FR-25, #105).
    졸업·퇴소 원아도 통과시킵니다 — 얼굴 정보 삭제처럼 재원이 끝난 뒤에도 해야 하는
    처리가 있기 때문입니다. TODO(이한나): 임시 결정, BE 회의에서 확인.

    - 없는 원아: `ChildNotFound` (404 `CHILD_NOT_FOUND`)
    - 다른 어린이집의 원아: `ChildAccessDenied` (403 `CHILD_ACCESS_DENIED`)
    """
    child_center_id = db.scalar(
        select(Klass.center_id).join(Child, Child.class_id == Klass.id).where(Child.id == child_id)
    )
    if child_center_id is None:
        raise ChildNotFound("원아를 찾을 수 없습니다.")
    if child_center_id != center_id:
        raise ChildAccessDenied("이 원아에 접근할 권한이 없습니다.")


def ensure_children_in_class(db: Session, class_id: UUID, child_ids: Sequence[UUID]) -> None:
    """원아들이 모두 그 반의 재원 원아인지 확인하고, 아니면 예외를 올립니다.

    반의 사진·기록에 다른 반 원아를 연결하지 못하게 막습니다 (FR-04, #105). 빈 목록은
    통과합니다 — 원아가 없는 사진도 저장할 수 있어야 합니다. 같은 id가 여러 번 와도 한 번으로
    셉니다(중복 거절은 호출하는 쪽에서 합니다). 졸업·퇴소 원아는 새로 연결하지 않으므로
    빠뜨립니다. TODO(이한나): 임시 결정, BE 회의에서 확인.

    - 하나라도 그 반 재원 원아가 아님(없는 원아 포함): `ChildNotInClass` (400 `CHILD_NOT_IN_CLASS`)
    """
    requested = set(child_ids)
    if not requested:
        return
    found = set(
        db.scalars(
            select(Child.id).where(
                Child.id.in_(requested),
                Child.class_id == class_id,
                Child.status == CHILD_STATUS_ENROLLED,
            )
        )
    )
    if found != requested:
        raise ChildNotInClass("이 반의 원아가 아닌 원아가 포함되어 있습니다.")


def has_consent(db: Session, child_id: UUID, consent_type: str) -> bool:
    """이 원아에게 `consent_type`의 유효한 동의가 지금 있는가.

    `get_consented_children`의 원아 한 명짜리입니다. 판정 조건은 같습니다 — 철회 후 다시
    동의한 원아는 `True`, 동의 행이 없거나 철회만 있으면 `False` (H-3, FR-22).
    `False`일 때 어떻게 거절할지는 호출하는 쪽이 정합니다(face: `FACE_CONSENT_REQUIRED`).
    """
    return bool(db.scalar(select(_valid_consent_exists(child_id, consent_type))))


def list_classes(db: Session, center_id: UUID | None) -> ClassListResponse:
    """교사가 고를 수 있는 반 목록 — 같은 어린이집의 반 전체, 반 이름순.

    담당교사 개념이 폐지돼 `Klass.teacher_id`로 거르지 않습니다 (FR-25). 소속이 아직 없는
    교사는 빈 목록을 받고, FE는 이 경우 온보딩으로 보냅니다 (docs/api/organization.md).
    """
    if center_id is None:
        return ClassListResponse(items=[])
    rows = db.execute(
        select(Klass.id, Klass.center_id, Center.name, Klass.name, Klass.age_group)
        .join(Center, Center.id == Klass.center_id)
        .where(Klass.center_id == center_id)
        .order_by(Klass.name, Klass.id)
    )
    return ClassListResponse(
        items=[
            ClassItem(
                class_id=class_id,
                center_id=class_center_id,
                center_name=center_name,
                name=name,
                age_group=age_group,
            )
            for class_id, class_center_id, center_name, name, age_group in rows
        ]
    )


def list_class_children(
    db: Session, class_id: UUID, center_id: UUID | None
) -> ClassChildListResponse:
    """반의 재원 원아 명단, 이름순. 교사 화면 원아 이름의 유일한 출처입니다 (FR-04).

    ③ 얼굴 동의가 없는 원아도 넣습니다 — 업로드·수동 분류는 막지 않고, LLM·얼굴 대조
    제외는 `get_consented_children`이 따로 판정합니다 (H-3). 졸업·퇴소 원아는 뺍니다.
    """
    ensure_class_access(db, class_id, center_id)
    rows = db.execute(
        select(Child.id, Child.name)
        .where(Child.class_id == class_id, Child.status == CHILD_STATUS_ENROLLED)
        .order_by(Child.name, Child.id)
    )
    return ClassChildListResponse(
        items=[
            ClassChildItem(child_id=child_id, class_id=class_id, name=name)
            for child_id, name in rows
        ]
    )
