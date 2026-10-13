"""organization 판정 함수.

face·media·agents는 organization 테이블(Child·ConsentRecord 등)을 직접 조회하지 않고
이 함수들을 부릅니다 (backend/CLAUDE.md 계층 규칙). 동의 규칙이 바뀌어도 이 파일
한 곳만 고치면 되도록 판정을 여기로 모읍니다 (#105, FR-04, H-2, H-3).

조회만 하므로 커밋·flush하지 않습니다.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.exceptions import ClassAccessDenied, ClassNotFound
from domains.organization.models import Child, ConsentRecord, Klass

# Child.status 값 — 재원 원아만 동의 판정 대상입니다 (졸업·퇴소 제외).
CHILD_STATUS_ENROLLED = "enrolled"
# ConsentRecord.status 값. 철회는 같은 행의 revoked_at을 채우므로 둘 다 봅니다.
CONSENT_STATUS_AGREED = "agreed"


def get_consented_children(db: Session, class_id: UUID, consent_type: str) -> list[UUID]:
    """해당 반에서 그 동의가 유효한 재원 원아의 id 목록.

    유효한 동의 행(`status == "agreed"`이고 `revoked_at`이 비어 있음)이 **하나라도 있으면**
    포함합니다. 철회 후 다시 동의해 새 행이 생긴 원아도 들어가도록 "철회 행이 있으면 제외"가
    아니라 "유효한 행이 있으면 포함"으로 판정합니다. 동의 행이 없는 원아(미동의)는 빠집니다.

    `consent_type`은 영문 값(`personal_info`·`activity_media`·`face_feature`)입니다.
    해당 원아가 없으면 빈 리스트를 돌려주고, 이름·생년월일은 넘기지 않습니다 (H-2).
    """
    valid_consent = (
        select(ConsentRecord.id)
        .where(
            ConsentRecord.child_id == Child.id,
            ConsentRecord.consent_type == consent_type,
            ConsentRecord.status == CONSENT_STATUS_AGREED,
            ConsentRecord.revoked_at.is_(None),
        )
        .exists()
    )
    stmt = (
        select(Child.id)
        .where(
            Child.class_id == class_id,
            Child.status == CHILD_STATUS_ENROLLED,
            valid_consent,
        )
        .order_by(Child.id)
    )
    return list(db.scalars(stmt))


def ensure_class_access(db: Session, class_id: UUID, center_id: UUID) -> None:
    """교사가 이 반에 접근해도 되는지 확인하고, 안 되면 예외를 올립니다.

    같은 어린이집(center) 소속 교사는 모든 반에 접근합니다 (FR-25, 담당교사 개념 폐지).
    교사의 `center_id`는 auth 로그인 의존성이 확인해 넘깁니다 — organization은 auth의
    교사 테이블을 조회하지 않고 반의 `center_id`와만 비교합니다 (#105).

    - 없는 반: `ClassNotFound` (404 `CLASS_NOT_FOUND`)
    - 다른 어린이집의 반: `ClassAccessDenied` (403 `CLASS_ACCESS_DENIED`)
    """
    class_center_id = db.scalar(select(Klass.center_id).where(Klass.id == class_id))
    if class_center_id is None:
        raise ClassNotFound("반을 찾을 수 없습니다.")
    if class_center_id != center_id:
        raise ClassAccessDenied("이 반에 접근할 권한이 없습니다.")
