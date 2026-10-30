"""organization 판정·조회 함수.

face·media·agents는 organization 테이블(Child·ConsentRecord 등)을 직접 조회하지 않고
이 함수들을 부릅니다 (backend/CLAUDE.md 계층 규칙). 동의 규칙이 바뀌어도 이 파일
한 곳만 고치면 되도록 판정을 여기로 모읍니다 (#105, FR-04, H-2, H-3).

판정·조회 함수는 커밋·flush하지 않습니다. 커밋은 온보딩 쓰기 함수(반 만들기·원아 등록)만
합니다. 어린이집 만들기는 auth 가입 트랜잭션 안에서 불리므로 flush까지만 합니다.
"""

from __future__ import annotations

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import ColumnElement, Exists, func, select
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
    RequestValidationFailed,
)
from domains.organization.models import (
    Center,
    Child,
    ConsentRecord,
    Klass,
    ParentChildRelation,
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
    MyChildItem,
    MyChildListResponse,
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
    코드 형식(자릿수·대소문자)이 아직 정해지지 않아 입력값을 바꾸지 않고 그대로 비교합니다.
    TODO(이한나): 코드 형식이 정해지면 정규화(공백 제거·대소문자 통일) 여부를 정합니다.

    - 일치하는 어린이집이 없음: `CenterNotFound` (404 `CENTER_NOT_FOUND`)
    """
    row = db.execute(
        select(Center.id, Center.name).where(Center.center_code == center_code)
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
