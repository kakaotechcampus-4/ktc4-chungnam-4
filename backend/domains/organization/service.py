"""organization 판정·조회 함수.

face·media·agents는 organization 테이블(Child·ConsentRecord 등)을 직접 조회하지 않고
이 함수들을 부릅니다 (backend/CLAUDE.md 계층 규칙). 동의 규칙이 바뀌어도 이 파일
한 곳만 고치면 되도록 판정을 여기로 모읍니다 (#105, FR-04, H-2, H-3).

판정·조회 함수는 커밋·flush하지 않습니다. 커밋은 온보딩 쓰기 함수(반 만들기·원아 등록)와
교육 계획 쓰기 함수만 합니다. 어린이집 만들기는 auth 가입 트랜잭션 안에서 불리므로 flush까지만 합니다.
"""

from __future__ import annotations

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Exists, case, func, select
from sqlalchemy.orm import Session

from core.exceptions import (
    CenterAccessDenied,
    CenterNotFound,
    ChildAccessDenied,
    ChildAccessExpired,
    ChildNotFound,
    ChildNotInClass,
    ClassAccessDenied,
    ClassNotFound,
    PlanNotFound,
    RequestValidationFailed,
)
from domains.organization.models import (
    Center,
    Child,
    ConsentRecord,
    EducationPlan,
    Klass,
    ParentChildRelation,
    TeacherPersona,
)
from domains.organization.schemas import (
    AgeBand,
    ChildCreateRequest,
    ChildDetail,
    ClassChildItem,
    ClassChildListResponse,
    ClassCreateRequest,
    ClassItem,
    ClassListResponse,
    ClassSummary,
    ClassSummaryListResponse,
    ConsentItem,
    EducationPlanCreateRequest,
    EducationPlanItem,
    EducationPlanListResponse,
    EducationPlanUpdateRequest,
    MyChildItem,
    MyChildListResponse,
    PlanType,
)

# Child.status 값 — 재원 원아만 동의 판정 대상입니다 (졸업·퇴소 제외).
CHILD_STATUS_ENROLLED = "enrolled"
# ConsentRecord.status 값. 철회는 같은 행의 revoked_at을 채우므로 둘 다 봅니다.
CONSENT_STATUS_AGREED = "agreed"
# 학부모 열람 기간의 "오늘"은 KST 날짜로 봅니다 (graduated_at이 날짜라서).
_KST = ZoneInfo("Asia/Seoul")


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


def ensure_parent_child_access(
    db: Session, parent_id: UUID, child_id: UUID, *, today: date | None = None
) -> None:
    """학부모가 이 원아의 자료를 봐도 되는지 확인하고, 안 되면 예외를 올립니다.

    학부모 열람 권한 판단은 `ParentChildRelation` 조회 한 곳으로 모읍니다 (organization/CLAUDE.md).
    열람은 졸업·퇴소 확정일(`Child.graduated_at`) 후 1년까지이고, 조회 시점에 판정합니다
    (NFR-03, F-3). 1년이 되는 날까지는 열람할 수 있습니다. `today`는 테스트용이며 기본은 KST 오늘입니다.

    - 관계가 없음(없는 원아 포함): `ChildAccessDenied` (403 `CHILD_ACCESS_DENIED`) — 없는 원아와
      남의 원아를 구분하면 원아 ID가 있는지가 샙니다.
    - 열람 기간이 지남: `ChildAccessExpired` (403 `CHILD_ACCESS_EXPIRED`)
    """
    row = db.execute(
        select(Child.graduated_at)
        .join(ParentChildRelation, ParentChildRelation.child_id == Child.id)
        .where(ParentChildRelation.parent_id == parent_id, Child.id == child_id)
    ).first()
    if row is None:
        raise ChildAccessDenied("이 원아에 접근할 권한이 없습니다.")
    if _is_access_expired(row.graduated_at, today):
        raise ChildAccessExpired("열람 기간이 지났습니다.")


def _is_access_expired(graduated_at: date | None, today: date | None) -> bool:
    """졸업·퇴소 확정일 + 1년이 지났는가 (NFR-03). 재원 중(`None`)이면 False입니다.

    `ensure_parent_child_access`와 `list_my_children`이 같이 써서 두 판정이 어긋나지 않게 합니다.
    """
    if graduated_at is None:
        return False
    return (today or datetime.now(_KST).date()) > _one_year_after(graduated_at)


def _one_year_after(day: date) -> date:
    """1년 뒤 같은 날. 2월 29일은 다음 해 2월 28일로 봅니다 — 기간을 늘리지 않는 쪽입니다."""
    try:
        return day.replace(year=day.year + 1)
    except ValueError:
        return day.replace(year=day.year + 1, day=28)


def has_linked_parent(db: Session, child_id: UUID) -> bool:
    """이 원아에게 연결된 학부모가 한 명이라도 있는가.

    documents가 알림장을 게시할 때 받을 사람이 없는 원아를 `NO_LINKED_PARENT`로 거릅니다 (#173).
    없는 원아도 `False`입니다.
    """
    return bool(
        db.scalar(
            select(
                select(ParentChildRelation.id)
                .where(ParentChildRelation.child_id == child_id)
                .exists()
            )
        )
    )


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
    # face가 organization의 권한 함수를 사용하므로 표시 조회는 함수 안에서 가져온다.
    from domains.face.service import registered_child_ids

    rows = db.scalars(
        select(Child)
        .where(Child.class_id == class_id, Child.status == CHILD_STATUS_ENROLLED)
        .order_by(Child.name, Child.id)
    ).all()
    registered = registered_child_ids(db, [child.id for child in rows])
    klass = db.get(Klass, class_id)
    return ClassChildListResponse(
        items=[
            ClassChildItem(
                child_id=child.id,
                class_id=class_id,
                name=child.name,
                age_group=klass.age_group,
                consent_agreed_count=sum(
                    has_consent(db, child.id, kind)
                    for kind in ("personal_info", "activity_media", "face_feature")
                ),
                face_feature_agreed=has_consent(db, child.id, "face_feature"),
                is_face_registered=child.id in registered,
                parent_linked=has_linked_parent(db, child.id),
            )
            for child in rows
        ]
    )


def get_class_child_names(db: Session, class_id: UUID) -> dict[UUID, list[str]]:
    """반 원아 전체의 원아 ID → 이름들. agents가 근거 속 실명을 토큰으로 바꿀 때 씁니다 (H-2).
    첫 값은 승인 전 초안 본문에 되돌려 넣는 호칭이고, 나머지는 본문에서 찾아 바꿀 다른 이름입니다.
    졸업·퇴소 원아도 넣습니다 — 발화에서 불릴 수 있고, 빠뜨리면 실명이 LLM으로 갑니다.
    반이 없거나 원아가 없으면 빈 딕셔너리입니다. 접근 검사는 하지 않습니다(worker가 부르는 내부 함수).
    """
    rows = db.execute(select(Child.id, Child.name).where(Child.class_id == class_id))
    return {child_id: _name_variants(name) for child_id, name in rows}


def _name_variants(name: str) -> list[str]:
    """성명 하나에서 호칭과 바꿀 이름들을 만듭니다.

    세 글자 이름("김민준")은 앞 한 글자를 성으로 보고 이름("민준")을 호칭으로, 성명을 그다음에
    둡니다. 그 밖의 길이는 성을 가를 수 없어(두 글자 성·외자 이름) 성명만 씁니다 — 한 글자만
    남기면 다른 낱말 속 글자까지 바꿔 버립니다.
    TODO(이한나): 임시 결정. 호칭 형식("민준"/"민준이")·애칭 저장 여부는 agents(정은)와 확인.
    """
    full_name = name.strip()
    if len(full_name) == 3:
        return [full_name[1:], full_name]
    return [full_name]


@dataclass(frozen=True)
class CenterSummary:
    """가입 코드로 찾은 어린이집. auth는 `center_id`를 교사 소속으로 저장하고,
    가입 화면은 `name`으로 "OO어린이집이 맞나요?"를 보여 줍니다."""

    center_id: UUID
    name: str


def find_center_by_code(db: Session, center_code: str) -> CenterSummary:
    """가입 코드(`Center.center_code`, UNIQUE)로 어린이집을 찾습니다 (FR-23).

    교사 회원가입에서 auth가 부릅니다 — auth는 Center 테이블을 직접 조회하지 않습니다
    (organization/CLAUDE.md: 코드 조회는 이 함수 하나로 모읍니다).
    발급 코드는 대문자·숫자뿐이라(`_new_center_code`) 앞뒤 공백을 지우고 대문자로 바꿔 비교합니다.
    교사가 소문자로 입력해도 찾습니다 (#212 리뷰).

    - 일치하는 어린이집이 없음: `CenterNotFound` (404 `CENTER_NOT_FOUND`)
    """
    row = db.execute(
        select(Center.id, Center.name).where(Center.center_code == center_code.strip().upper())
    ).one_or_none()
    if row is None:
        raise CenterNotFound("가입 코드와 일치하는 어린이집이 없습니다.")
    return CenterSummary(center_id=row.id, name=row.name)


def list_my_children(
    db: Session, parent_id: UUID, *, today: date | None = None
) -> MyChildListResponse:
    """학부모와 연결된 자녀 목록, 이름순 (FR-09, W3·W4 상단 자녀 칩).

    `ParentChildRelation`으로 연결된 자녀만 돌려줍니다. 열람 기간이 지난 자녀(NFR-03)도 빼지 않고
    `access_expired: true`로 표시합니다 — 그 자녀의 알림장 조회는 `ensure_parent_child_access`가
    `CHILD_ACCESS_EXPIRED`로 막습니다. 연결된 자녀가 없으면 빈 목록입니다.
    """
    rows = db.execute(
        select(
            Child.id,
            Child.name,
            Child.graduated_at,
            Klass.id.label("class_id"),
            Klass.name.label("class_name"),
            Klass.age_group,
            Center.name.label("center_name"),
        )
        .join(ParentChildRelation, ParentChildRelation.child_id == Child.id)
        .join(Klass, Klass.id == Child.class_id)
        .join(Center, Center.id == Klass.center_id)
        .where(ParentChildRelation.parent_id == parent_id)
        .distinct()
        .order_by(Child.name, Child.id)
    )
    return MyChildListResponse(
        items=[
            MyChildItem(
                child_id=row.id,
                name=row.name,
                class_id=row.class_id,
                class_name=row.class_name,
                age_group=row.age_group,
                center_name=row.center_name,
                access_expired=_is_access_expired(row.graduated_at, today),
            )
            for row in rows
        ]
    )


# 원아 동의 항목 전체. 원아 상세의 동의 목록은 이 순서로 줍니다 (organization/CLAUDE.md).
CONSENT_TYPES = ("personal_info", "activity_media", "face_feature")
CONTRACT_STATUS_TRIAL = "trial"
# 반 만들기 화면의 2택 문구를 표시용 age_group으로 씁니다 (FE types/api-draft/organization.ts AgeBand).
_AGE_GROUP_LABELS = {AgeBand.INFANT: "만 0~2세", AgeBand.PRESCHOOL: "만 3~5세"}
# 가입 코드 문자 — 헷갈리는 0/O, 1/I를 뺀 대문자·숫자. TODO(이한나): 임시 결정, #158 3번에서
#   길이·문자셋·재발급 여부가 정해지면 _new_center_code만 고칩니다.
_CENTER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CENTER_CODE_LENGTH = 8
_CENTER_CODE_ATTEMPTS = 5


@dataclass(frozen=True)
class CreatedCenter:
    """새로 만든 어린이집. auth는 `center_id`를 교사 소속으로 저장하고, 화면은 `center_code`를
    다른 교사에게 알려 줄 가입 코드로 보여 줍니다."""

    center_id: UUID
    name: str
    center_code: str


def _new_center_code(db: Session) -> str:
    """겹치지 않는 가입 코드를 만듭니다. 몇 번 시도해도 겹치면 서버 오류로 둡니다(코드 공간이 큼)."""
    for _ in range(_CENTER_CODE_ATTEMPTS):
        code = "".join(secrets.choice(_CENTER_CODE_ALPHABET) for _ in range(_CENTER_CODE_LENGTH))
        if db.scalar(select(Center.id).where(Center.center_code == code)) is None:
            return code
    raise RuntimeError("어린이집 가입 코드를 만들지 못했습니다.")


def create_center(
    db: Session, *, name: str, address: str | None, created_by_teacher_id: UUID | None
) -> CreatedCenter:
    """교사가 직접 어린이집을 등록합니다 (FR-24). 가입 코드는 서버가 발급합니다 (FR-23).

    교사 회원가입에서 auth가 부릅니다 — 교사 소속(`center_id`) 저장은 auth 몫이라, 같은
    트랜잭션으로 묶을 수 있게 커밋하지 않고 flush까지만 합니다. 계약 상태는 `trial`로 시작하고
    가입 흐름에서 올리지 않습니다 (organization/CLAUDE.md).
    TODO(이한나): 같은 어린이집 중복 등록 검증(open-questions 78행)은 #158 3번과 함께 정합니다.
    """
    clean_name = name.strip()
    if not clean_name:
        raise RequestValidationFailed("어린이집 이름이 비어 있습니다.")
    center = Center(
        center_code=_new_center_code(db),
        name=clean_name,
        address=(address or "").strip() or None,
        contract_status=CONTRACT_STATUS_TRIAL,
        created_by_teacher_id=created_by_teacher_id,
    )
    db.add(center)
    db.flush()
    return CreatedCenter(center_id=center.id, name=center.name, center_code=center.center_code)


def _ensure_own_center(center_id: UUID, teacher_center_id: UUID | None) -> None:
    """교사가 소속된 어린이집인지 확인합니다. 다른 어린이집이 있는지 없는지는 알려 주지 않습니다.

    - 소속이 아니거나 소속이 없음: `CenterAccessDenied` (403 `CENTER_ACCESS_DENIED`)
    """
    if teacher_center_id is None or center_id != teacher_center_id:
        raise CenterAccessDenied("이 어린이집에 접근할 권한이 없습니다.")


def _class_summaries(db: Session, *class_filter: ColumnElement[bool]) -> list[ClassSummary]:
    child_count = (
        select(func.count(Child.id))
        .where(Child.class_id == Klass.id, Child.status == CHILD_STATUS_ENROLLED)
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            Klass.id,
            Klass.center_id,
            Center.name,
            Klass.name,
            Klass.age_group,
            Klass.age_band,
            child_count,
        )
        .join(Center, Center.id == Klass.center_id)
        .where(*class_filter)
        .order_by(Klass.name, Klass.id)
    )
    return [
        ClassSummary(
            class_id=class_id,
            center_id=class_center_id,
            center_name=center_name,
            name=name,
            age_group=age_group,
            age_band=age_band,
            child_count=count,
        )
        for class_id, class_center_id, center_name, name, age_group, age_band, count in rows
    ]


def list_center_classes(
    db: Session, center_id: UUID, teacher_center_id: UUID | None
) -> ClassSummaryListResponse:
    """반 고르기 화면의 반 목록, 이름순 (FR-25). 같은 어린이집 반 전체가 후보입니다."""
    _ensure_own_center(center_id, teacher_center_id)
    return ClassSummaryListResponse(items=_class_summaries(db, Klass.center_id == center_id))


def create_class(
    db: Session, *, teacher_id: UUID, teacher_center_id: UUID | None, request: ClassCreateRequest
) -> ClassSummary:
    """반을 만듭니다 (FR-25). 소속 어린이집에만 만들 수 있습니다.

    담당교사 개념이 폐지돼 담임 배정은 하지 않고, `Klass.teacher_id`에 만든 교사만 기록합니다.
    같은 이름의 반도 막지 않습니다. 표시용 `age_group`은 연령 구분의 화면 문구로 채웁니다.
    """
    _ensure_own_center(request.center_id, teacher_center_id)
    klass = Klass(
        center_id=request.center_id,
        teacher_id=teacher_id,
        name=request.name,
        age_group=_AGE_GROUP_LABELS[request.age_band],
        age_band=request.age_band.value,
    )
    db.add(klass)
    db.commit()
    return _class_summaries(db, Klass.id == klass.id)[0]


def create_child(
    db: Session,
    class_id: UUID,
    *,
    teacher_center_id: UUID | None,
    request: ChildCreateRequest,
    today: date | None = None,
) -> ChildDetail:
    """반에 원아를 등록합니다. 재원(`enrolled`)으로 시작하고 입소일은 오늘(KST)입니다.

    동의는 학부모가 초대 링크로 직접 하므로(FR-28) 동의 0건·보호자 미연결로 만들고,
    얼굴·기록 관련 값도 모두 비어 있는 상태로 돌려줍니다.

    - 본문 `class_id`가 경로와 다름, 생년월일이 오늘 이후: `RequestValidationFailed` (422)
    - 없는 반 404 `CLASS_NOT_FOUND`, 다른 어린이집 반 403 `CLASS_ACCESS_DENIED`
    """
    ensure_class_access(db, class_id, teacher_center_id)
    if request.class_id != class_id:
        raise RequestValidationFailed("본문의 class_id가 경로의 반과 다릅니다.")
    today = today or datetime.now(_KST).date()
    if request.birth_date > today:
        raise RequestValidationFailed("생년월일이 오늘 이후입니다.")
    klass = db.get(Klass, class_id)
    child = Child(
        class_id=class_id,
        name=request.name,
        birth_date=request.birth_date,
        status=CHILD_STATUS_ENROLLED,
        enrolled_at=today,
    )
    db.add(child)
    db.commit()
    return ChildDetail(
        child_id=child.id,
        class_id=class_id,
        name=child.name,
        birth_date=child.birth_date,
        age_group=klass.age_group,
        consent_agreed_count=0,
        consent_total=len(CONSENT_TYPES),
        is_face_registered=False,
        face_feature_agreed=False,
        face_photo_count=0,
        parent_linked=False,
        class_name=klass.name,
        consents=[ConsentItem(consent_type=kind, agreed=False) for kind in CONSENT_TYPES],
        consent_checked_at=None,
        consent_checked_by=None,
        month_record_count=0,
        today_note_sent=False,
    )


@dataclass(frozen=True)
class ActivityPlanSummary:
    """초안 생성에 넣을 교육계획 하나. agents가 `activity_plan` 근거로 씁니다 (NFR-12).

    계획은 "했다"가 아니라 "하려던 것"입니다 — 관찰 사실로 쓰지 않는 규칙은 agents 프롬프트에
    있습니다. 작성 교사(`teacher_id`)는 넘기지 않습니다(LLM 입력에 교사 정보를 넣지 않음, H-2).
    `title`·`goal`·`daily_activities`는 교사가 쓴 자유 텍스트라 원아 실명이 들어 있을 수 있습니다 —
    LLM에 넣기 전에 실명 치환(`tools/generation/pseudonymize.py`)을 거쳐야 합니다 (H-2, #210 리뷰).
    """

    plan_id: UUID
    plan_type: str
    title: str
    goal: str
    daily_activities: dict[str, str]
    domains: list[str]
    start_date: date
    end_date: date


def get_activity_plans_for_date(
    db: Session, class_id: UUID, target_date: date
) -> list[ActivityPlanSummary]:
    """그 반에서 `target_date`가 기간 안에 드는 교육계획 (NFR-12, 테크스펙 EducationPlan).

    주간 계획을 월간 계획보다 앞에 둡니다 — 하루 활동에 더 가까운 쪽입니다. 같은 종류끼리는
    시작일이 늦은(더 최근에 세운) 계획이 앞입니다. 어느 계획을 근거로 쓸지는 agents가 고릅니다.
    해당 계획이 없으면 빈 리스트입니다. 접근 검사는 하지 않습니다(worker가 부르는 내부 함수).
    """
    rows = db.scalars(
        select(EducationPlan)
        .where(
            EducationPlan.class_id == class_id,
            EducationPlan.start_date <= target_date,
            EducationPlan.end_date >= target_date,
        )
        .order_by(
            case((EducationPlan.plan_type == PlanType.WEEKLY.value, 0), else_=1),
            EducationPlan.start_date.desc(),
            EducationPlan.id,
        )
    )
    return [
        ActivityPlanSummary(
            plan_id=plan.id,
            plan_type=plan.plan_type,
            title=plan.title,
            goal=plan.content,
            daily_activities=dict(plan.daily_activities),
            domains=list(plan.domains),
            start_date=plan.start_date,
            end_date=plan.end_date,
        )
        for plan in rows
    ]


@dataclass(frozen=True)
class TeacherPersonaSummary:
    """교사 문체 프로필의 최신 버전. agents가 `context_lookup["teacher_persona"]`에 넣습니다
    (NFR-07). 교사 실명은 담지 않습니다 — 페르소나에는 문체만 둡니다 (organization/CLAUDE.md).
    `sample_phrases`·`style_rules`는 교사 글에서 뽑은 문장이라 원아 실명이 섞일 수 있어, LLM에
    넣기 전에 실명 치환을 거쳐야 합니다 (H-2, #210 리뷰)."""

    persona_id: UUID
    version: int
    tone_summary: str
    style_rules: list[str]
    sample_phrases: list[str]


def get_teacher_persona(db: Session, teacher_id: UUID) -> TeacherPersonaSummary | None:
    """교사의 최신 문체 프로필. 아직 없으면 `None`입니다 — 문체 없이 기본 말투로 생성합니다.

    갱신할 때마다 `version`이 오르고 이전 버전은 이력으로 남으므로 가장 높은 버전을 씁니다
    (테크스펙 TeacherPersona).
    """
    persona = db.scalars(
        select(TeacherPersona)
        .where(TeacherPersona.teacher_id == teacher_id)
        .order_by(TeacherPersona.version.desc(), TeacherPersona.updated_at.desc())
        .limit(1)
    ).first()
    if persona is None:
        return None
    return TeacherPersonaSummary(
        persona_id=persona.id,
        version=persona.version,
        tone_summary=persona.tone_summary,
        style_rules=list(persona.style_rules),
        sample_phrases=list(persona.sample_phrases),
    )


def _plan_item(plan: EducationPlan) -> EducationPlanItem:
    return EducationPlanItem(
        plan_id=plan.id,
        class_id=plan.class_id,
        plan_type=plan.plan_type,
        start_date=plan.start_date,
        end_date=plan.end_date,
        title=plan.title,
        goal=plan.content,
        daily_activities=plan.daily_activities,
        domains=plan.domains,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


def _validate_plan(plan: EducationPlan) -> None:
    """필드 하나로는 못 막는 조합 조건 (docs/api/organization.md §공통 모양 EducationPlan).

    - 끝나는 날이 시작일보다 앞이면 안 됩니다.
    - 월간 계획에는 요일별 놀이가 없습니다(빈 객체).
    - 같은 영역을 두 번 고르지 않습니다.
    """
    if plan.end_date < plan.start_date:
        raise RequestValidationFailed("end_date는 start_date보다 앞일 수 없습니다.")
    if plan.plan_type == PlanType.MONTHLY.value and plan.daily_activities:
        raise RequestValidationFailed("월간 계획에는 daily_activities를 넣지 않습니다.")
    if len(set(plan.domains)) != len(plan.domains):
        raise RequestValidationFailed("domains에 같은 영역이 두 번 들어 있습니다.")


def _plan_for_teacher(db: Session, plan_id: UUID, center_id: UUID | None) -> EducationPlan:
    """계획을 찾고 그 반에 교사가 접근할 수 있는지 확인합니다.

    - 없는 계획: `PlanNotFound` (404 `PLAN_NOT_FOUND`)
    - 다른 어린이집 반의 계획: `ClassAccessDenied` (403 `CLASS_ACCESS_DENIED`)
    """
    plan = db.get(EducationPlan, plan_id)
    if plan is None:
        raise PlanNotFound("교육 계획을 찾을 수 없습니다.")
    ensure_class_access(db, plan.class_id, center_id)
    return plan


def list_education_plans(
    db: Session, class_id: UUID, center_id: UUID | None, plan_type: PlanType | None = None
) -> EducationPlanListResponse:
    """반의 교육 계획 목록 (FR-21). 시작일 최신순이고, `plan_type`을 주면 그 종류만 돌려줍니다."""
    ensure_class_access(db, class_id, center_id)
    stmt = select(EducationPlan).where(EducationPlan.class_id == class_id)
    if plan_type is not None:
        stmt = stmt.where(EducationPlan.plan_type == plan_type.value)
    plans = db.scalars(stmt.order_by(EducationPlan.start_date.desc(), EducationPlan.id))
    return EducationPlanListResponse(items=[_plan_item(plan) for plan in plans])


def create_education_plan(
    db: Session,
    class_id: UUID,
    *,
    center_id: UUID | None,
    teacher_id: UUID,
    request: EducationPlanCreateRequest,
) -> EducationPlanItem:
    """교육 계획을 등록합니다 (FR-20). 같은 어린이집 교사면 어느 반에나 등록합니다(담당교사 폐지).

    `teacher_id`는 작성 기록으로만 남기고 권한 판단에 쓰지 않습니다. 기간이 겹치는 계획도
    막지 않습니다 — 초안 생성 때 어느 계획을 쓸지는 agents가 고릅니다.
    """
    ensure_class_access(db, class_id, center_id)
    plan = EducationPlan(
        class_id=class_id,
        teacher_id=teacher_id,
        plan_type=request.plan_type.value,
        start_date=request.start_date,
        end_date=request.end_date,
        title=request.title,
        content=request.goal,
        daily_activities=dict(request.daily_activities),
        domains=[domain.value for domain in request.domains],
    )
    _validate_plan(plan)
    db.add(plan)
    db.commit()
    return _plan_item(plan)


def get_education_plan(db: Session, plan_id: UUID, center_id: UUID | None) -> EducationPlanItem:
    """교육 계획 하나 (수정 화면, FR-21)."""
    return _plan_item(_plan_for_teacher(db, plan_id, center_id))


def update_education_plan(
    db: Session, plan_id: UUID, center_id: UUID | None, request: EducationPlanUpdateRequest
) -> EducationPlanItem:
    """보낸 필드만 바꿉니다. 필드를 `null`로 보내 지울 수는 없습니다 (VALIDATION_ERROR).

    종류를 월간으로 바꾸면서 요일별 놀이를 그대로 두면 막힙니다 — 바꾼 결과 전체로 다시 확인합니다.
    """
    plan = _plan_for_teacher(db, plan_id, center_id)
    changes = request.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise RequestValidationFailed("교육 계획 필드는 null로 바꿀 수 없습니다.")
    for field, value in changes.items():
        if field == "goal":
            plan.content = value
        elif field == "plan_type":
            plan.plan_type = value.value
        elif field == "domains":
            plan.domains = [domain.value for domain in value]
        else:
            setattr(plan, field, value)
    try:
        _validate_plan(plan)
    except RequestValidationFailed:
        db.rollback()
        raise
    db.commit()
    return _plan_item(plan)


def delete_education_plan(db: Session, plan_id: UUID, center_id: UUID | None) -> None:
    """교육 계획을 지웁니다. `EvidenceBundle.source_activity_plan_id`는 FK가 없어 이미 만든
    근거 묶음은 그대로 남습니다 (테크스펙 데이터 모델 ④)."""
    plan = _plan_for_teacher(db, plan_id, center_id)
    db.delete(plan)
    db.commit()


def get_child_class_id(db: Session, child_id: UUID) -> UUID:
    """worker가 대상 원아의 반을 찾는다. 외부 접근은 호출 API에서 검사한다(FR-05)."""
    child = db.get(Child, child_id)
    if child is None:
        raise ChildNotFound("원아를 찾을 수 없습니다.")
    return child.class_id


@dataclass(frozen=True)
class InviteChild:
    child_name: str
    class_name: str
    center_name: str


def get_invite_child(db: Session, child_id: UUID, *, lock: bool = False) -> InviteChild:
    """초대에는 재원 원아의 표시 정보만 제공합니다 (FR-28)."""
    stmt = select(Child).where(Child.id == child_id, Child.status == CHILD_STATUS_ENROLLED)
    if lock:
        stmt = stmt.with_for_update()
    child = db.scalar(stmt)
    if child is None:
        raise ChildNotFound("재원 원아를 찾을 수 없습니다.")
    klass = db.get(Klass, child.class_id)
    center = db.get(Center, klass.center_id)
    return InviteChild(child.name, klass.name, center.name)


def link_parent_with_consents(
    db: Session, *, child_id: UUID, parent_id: UUID, face_feature: bool
) -> None:
    """자녀 연결·동의를 함께 준비합니다. 커밋은 auth의 초대 수락에서 합니다 (#225)."""
    get_invite_child(db, child_id, lock=True)
    relation = db.scalar(
        select(ParentChildRelation).where(
            ParentChildRelation.child_id == child_id, ParentChildRelation.parent_id == parent_id
        )
    )
    if relation is None:
        db.add(ParentChildRelation(child_id=child_id, parent_id=parent_id, is_legal_guardian=True))
    else:
        relation.is_legal_guardian = True
    now = datetime.now(_KST)
    for kind in CONSENT_TYPES:
        if kind == "face_feature" and not face_feature:
            continue
        existing = db.scalar(
            select(ConsentRecord.id).where(
                ConsentRecord.child_id == child_id,
                ConsentRecord.parent_id == parent_id,
                ConsentRecord.consent_type == kind,
                ConsentRecord.status == "agreed",
                ConsentRecord.revoked_at.is_(None),
            )
        )
        if existing is None:
            db.add(
                ConsentRecord(
                    child_id=child_id,
                    parent_id=parent_id,
                    consent_type=kind,
                    status="agreed",
                    agreed_at=now,
                )
            )
    db.flush()


def get_child_detail(
    db: Session, child_id: UUID, center_id: UUID | None, *, actor_id: UUID | None = None
) -> ChildDetail:
    """등록·초대·얼굴 화면에서 실제 동의 상태를 읽습니다 (FR-28)."""
    ensure_child_access(db, child_id, center_id)
    child = db.get(Child, child_id)
    klass = db.get(Klass, child.class_id)
    from domains.face.service import registered_child_ids

    consents = [
        ConsentItem(consent_type=kind, agreed=has_consent(db, child_id, kind))
        for kind in CONSENT_TYPES
    ]
    checked = db.scalar(
        select(func.max(ConsentRecord.agreed_at)).where(
            ConsentRecord.child_id == child_id,
            ConsentRecord.status == "agreed",
            ConsentRecord.revoked_at.is_(None),
        )
    )
    from domains.documents.service import child_record_summary

    summary = child_record_summary(db, child_id, datetime.now(_KST).date())
    if actor_id is not None:
        _record_child_view(db, child_id, actor_id)
    return ChildDetail(
        child_id=child.id,
        class_id=child.class_id,
        name=child.name,
        birth_date=child.birth_date,
        age_group=klass.age_group,
        consent_agreed_count=sum(c.agreed for c in consents),
        consent_total=len(CONSENT_TYPES),
        is_face_registered=child_id in registered_child_ids(db, [child_id]),
        face_feature_agreed=has_consent(db, child_id, "face_feature"),
        face_photo_count=None,
        parent_linked=has_linked_parent(db, child_id),
        class_name=klass.name,
        consents=consents,
        consent_checked_at=(
            checked.replace(tzinfo=_KST) if checked.tzinfo is None else checked.astimezone(_KST)
        ).date()
        if checked
        else None,
        consent_checked_by=None,
        month_record_count=summary["month_record_count"],
        today_note_sent=summary["today_note_sent"],
    )


def update_child(
    db: Session, child_id: UUID, center_id: UUID | None, request: ChildCreateRequest
) -> ChildDetail:
    ensure_child_access(db, child_id, center_id)
    ensure_class_access(db, request.class_id, center_id)
    if request.birth_date > datetime.now(_KST).date():
        raise RequestValidationFailed("생년월일이 오늘 이후입니다.")
    child = db.get(Child, child_id)
    child.name, child.birth_date, child.class_id = (
        request.name,
        request.birth_date,
        request.class_id,
    )
    db.commit()
    return get_child_detail(db, child_id, center_id)


def _record_child_view(db: Session, child_id: UUID, actor_id: UUID) -> None:
    from domains.audit.service import record_access

    record_access(
        db,
        actor_type="teacher",
        actor_id=actor_id,
        target_type="child",
        target_id=child_id,
        action="view_detail",
    )
    db.commit()


def get_child_overview(db: Session, child_id: UUID, center_id: UUID | None, actor_id: UUID):
    from domains.documents.service import child_record_summary
    from domains.organization.schemas import ChildOverview

    ensure_child_access(db, child_id, center_id)
    summary = child_record_summary(db, child_id, datetime.now(_KST).date())
    _record_child_view(db, child_id, actor_id)
    return ChildOverview(**summary)
