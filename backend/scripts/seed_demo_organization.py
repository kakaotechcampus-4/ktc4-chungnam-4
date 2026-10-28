"""시연용 어린이집·반·원아·학부모 연결을 만듭니다. backend에서 python -m scripts.seed_demo_organization으로 실행합니다.

계정 시드(scripts.seed_demo_accounts)만으로는 반 목록·원아 명단·학부모 화면이 비어 보여서
시연 2단계·13단계를 볼 수 없습니다. 온보딩 API(어린이집 만들기·반·원아 등록)가 생기기 전까지
이 스크립트로 채웁니다.

교사를 만들 때 어린이집 ID가, 반을 만들 때 교사 ID가 필요해서 세 번에 나눠 돌립니다.

1. `python -m scripts.seed_demo_organization` — 어린이집을 만들고 `center_id`를 출력합니다.
2. `python -m scripts.seed_demo_accounts --center-id <center_id> …` — 교사·학부모 계정
3. `python -m scripts.seed_demo_organization --teacher-id <teacher_id> --parent-id <parent_id>`
   — 반·원아를 만들고, 학부모를 모든 원아의 법정대리인으로 연결해 동의 3종을 넣습니다.

- 학부모 계정이 하나뿐이라 모든 원아에 연결합니다. 보호자가 없는 원아는 게시에서 빠지고
  (`NO_LINKED_PARENT`), 동의가 없는 원아는 얼굴 대조·LLM 입력에서 빠지기 때문입니다 (H-3).
- 이미 있는 행(가입 코드·반 이름·원아 이름·연결·유효한 동의)은 건너뜁니다. 여러 번 돌려도 같습니다.
- 출력에는 ID만 남깁니다. 이름은 찍지 않습니다 (H-4).
- 실제 원아·학부모 정보를 넣지 않습니다. 원아 이름은 합성 값이나 사진을 쓰는 팀원 본인 이름만 씁니다.
"""

from __future__ import annotations

import argparse
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import SessionLocal
from core.exceptions import CenterNotFound
from domains.organization import service
from domains.organization.models import Center, Child, ConsentRecord, Klass, ParentChildRelation

DEFAULT_CHILD_NAMES = ("김하늘", "이바다", "박가람", "최새봄")
# personal_info(①)·activity_media(②)·face_feature(③) — 시연에서는 셋 다 동의한 상태로 둡니다.
CONSENT_TYPES = ("personal_info", "activity_media", "face_feature")
DEMO_BIRTH_DATE = date(2021, 5, 1)
DEMO_ENROLLED_AT = date(2026, 3, 1)


def ensure_center(db: Session, *, center_code: str, name: str) -> uuid.UUID:
    """가입 코드로 어린이집을 찾고, 없으면 만듭니다."""
    try:
        return service.find_center_by_code(db, center_code).center_id
    except CenterNotFound:
        center = Center(center_code=center_code, name=name, contract_status="trial")
        db.add(center)
        db.flush()
        return center.id


def ensure_class_roster(
    db: Session,
    *,
    center_id: uuid.UUID,
    teacher_id: uuid.UUID,
    class_name: str,
    age_group: str,
    child_names: Sequence[str],
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """어린이집에 반을, 반에 재원 원아를 만듭니다. 반은 이름, 원아는 반 안의 이름으로 찾습니다."""
    class_id = db.scalar(
        select(Klass.id).where(Klass.center_id == center_id, Klass.name == class_name)
    )
    if class_id is None:
        klass = Klass(
            center_id=center_id, teacher_id=teacher_id, name=class_name, age_group=age_group
        )
        db.add(klass)
        db.flush()
        class_id = klass.id

    child_ids = []
    for name in child_names:
        child_id = db.scalar(select(Child.id).where(Child.class_id == class_id, Child.name == name))
        if child_id is None:
            child = Child(
                class_id=class_id,
                name=name,
                birth_date=DEMO_BIRTH_DATE,
                status=service.CHILD_STATUS_ENROLLED,
                enrolled_at=DEMO_ENROLLED_AT,
            )
            db.add(child)
            db.flush()
            child_id = child.id
        child_ids.append(child_id)
    return class_id, child_ids


def link_parent(
    db: Session, *, parent_id: uuid.UUID, child_ids: Sequence[uuid.UUID], agreed_at: datetime
) -> None:
    """학부모를 원아들의 법정대리인으로 연결하고, 유효한 동의가 없는 종류만 동의 행을 넣습니다."""
    for child_id in child_ids:
        linked = db.scalar(
            select(ParentChildRelation.id).where(
                ParentChildRelation.parent_id == parent_id,
                ParentChildRelation.child_id == child_id,
            )
        )
        if linked is None:
            db.add(
                ParentChildRelation(parent_id=parent_id, child_id=child_id, is_legal_guardian=True)
            )
        for consent_type in CONSENT_TYPES:
            if not service.has_consent(db, child_id, consent_type):
                db.add(
                    ConsentRecord(
                        child_id=child_id,
                        parent_id=parent_id,
                        consent_type=consent_type,
                        status=service.CONSENT_STATUS_AGREED,
                        agreed_at=agreed_at,
                    )
                )
        db.flush()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--center-code", default="AIDAM-DEMO", help="어린이집 가입 코드 (UNIQUE)")
    parser.add_argument("--center-name", default="아이담 시연 어린이집")
    parser.add_argument(
        "--teacher-id",
        type=uuid.UUID,
        default=None,
        help="반 생성 교사 ID(seed_demo_accounts 출력). 없으면 어린이집만 만듭니다.",
    )
    parser.add_argument(
        "--parent-id",
        type=uuid.UUID,
        default=None,
        help="모든 원아에 연결할 학부모 ID(seed_demo_accounts 출력).",
    )
    parser.add_argument("--class-name", default="햇살반")
    parser.add_argument("--age-group", default="만 4세")
    parser.add_argument(
        "--child-name",
        action="append",
        dest="child_names",
        help="원아 이름. 여러 번 줄 수 있고, 없으면 합성 이름 4개를 씁니다.",
    )
    args = parser.parse_args()
    if args.parent_id and not args.teacher_id:
        parser.error(
            "--parent-id는 원아가 있어야 연결할 수 있어 --teacher-id와 함께 넘겨야 합니다."
        )

    with SessionLocal() as db:
        center_id = ensure_center(db, center_code=args.center_code, name=args.center_name)
        print(f"center: center_id={center_id}")

        if args.teacher_id:
            class_id, child_ids = ensure_class_roster(
                db,
                center_id=center_id,
                teacher_id=args.teacher_id,
                class_name=args.class_name,
                age_group=args.age_group,
                child_names=args.child_names or DEFAULT_CHILD_NAMES,
            )
            print(f"class: class_id={class_id}")
            print(f"children: {len(child_ids)}명 child_ids={[str(i) for i in child_ids]}")

            if args.parent_id:
                link_parent(
                    db, parent_id=args.parent_id, child_ids=child_ids, agreed_at=datetime.now(UTC)
                )
                print(
                    f"parent: parent_id={args.parent_id}에 원아 {len(child_ids)}명 연결·동의 완료"
                )
        else:
            print(
                "다음: seed_demo_accounts --center-id로 교사를 만든 뒤 --teacher-id로 다시 실행하세요."
            )
        db.commit()


if __name__ == "__main__":
    main()
