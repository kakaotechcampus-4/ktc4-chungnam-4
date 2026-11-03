"""#226 합성 사진용 시연 계정·반·원아를 준비합니다(FR-04, FR-13).

비밀번호는 환경변수 또는 숨긴 입력으로만 받습니다. 기존 계정의 암호와 기존 동의는
변경하지 않습니다. 다른 데이터와 섞이지 않도록 전용 어린이집·이메일을 사용합니다.
실행: python -m scripts.seed_photo_demo
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.database import SessionLocal
from domains.auth import service as auth
from domains.auth.models import Account, Parent, Teacher
from domains.organization.models import ConsentRecord, ParentChildRelation
from scripts.seed_demo_accounts import _password
from scripts.seed_demo_organization import ensure_center, ensure_class_roster

CHILD_NAMES = ("김도윤", "박서아", "이하준", "정예린", "최지우")
TEACHER_EMAIL = "photo-demo.teacher@example.com"
PARENT_EMAILS = tuple(f"photo-demo.parent{i}@example.com" for i in range(1, 6))


def seed(db: Session, *, teacher_password: str, parent_password: str) -> tuple[UUID, list[UUID]]:
    center_id = ensure_center(db, center_code="AIDAM-PHOTO-DEMO", name="합성 사진 시연 어린이집")
    teacher = db.scalar(select(Teacher).join(Account).where(Account.email == TEACHER_EMAIL))
    if teacher is None:
        if auth.account_exists(db, TEACHER_EMAIL):
            raise ValueError("Demo account role conflict")
        teacher = auth.create_teacher_account(
            db,
            email=TEACHER_EMAIL,
            password=teacher_password,
            name="시연 교사",
            center_id=center_id,
        )
    if teacher.center_id != center_id:
        raise ValueError("Demo account center conflict")
    class_id, child_ids = ensure_class_roster(
        db,
        center_id=center_id,
        teacher_id=teacher.id,
        class_name="합성 햇살반",
        age_group="만 4세",
        child_names=CHILD_NAMES,
    )
    for index, (child_id, email) in enumerate(zip(child_ids, PARENT_EMAILS, strict=True)):
        parent = db.scalar(select(Parent).join(Account).where(Account.email == email))
        if parent is None:
            if auth.account_exists(db, email):
                raise ValueError("Demo account role conflict")
            parent = auth.create_parent_account(
                db, email=email, password=parent_password, name=f"시연 보호자 {index + 1}"
            )
        linked = db.scalar(
            select(ParentChildRelation.id).where(
                ParentChildRelation.parent_id == parent.id, ParentChildRelation.child_id == child_id
            )
        )
        if linked is not None:
            continue  # 재실행해도 철회된 동의를 되살리지 않습니다.
        db.add(ParentChildRelation(parent_id=parent.id, child_id=child_id, is_legal_guardian=True))
        kinds = (
            ("personal_info", "activity_media")
            if index == 3
            else ("personal_info", "activity_media", "face_feature")
        )
        for kind in kinds:
            db.add(
                ConsentRecord(
                    child_id=child_id,
                    parent_id=parent.id,
                    consent_type=kind,
                    status="agreed",
                    agreed_at=datetime.now(UTC),
                )
            )
    db.flush()
    return class_id, child_ids


def main() -> None:
    teacher_password = _password("DEMO_TEACHER_PASSWORD", "시연 교사")
    parent_password = _password("DEMO_PARENT_PASSWORD", "시연 보호자")
    with SessionLocal() as db:
        class_id, children = seed(
            db, teacher_password=teacher_password, parent_password=parent_password
        )
        db.commit()
        print(f"photo_demo_ready class_id={class_id} children={len(children)}")
        print("계정별 자녀 연결과 미동의 사례는 backend/README.md의 사진 시연 절을 확인하세요.")


if __name__ == "__main__":
    main()
