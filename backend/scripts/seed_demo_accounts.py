"""시연용 교사·학부모 계정을 만듭니다. backend에서 python -m scripts.seed_demo_accounts로 실행합니다.

가입 API(POST /api/v1/accounts)가 생기기 전까지 FE를 실서버에 붙여 보기 위한 것입니다
(docs/api/auth.md "데모 계정은 시드 데이터로").

- 비밀번호는 인자로 받지 않고 환경변수(DEMO_TEACHER_PASSWORD, DEMO_PARENT_PASSWORD)나
  입력 프롬프트로 받습니다 — 셸 히스토리·프로세스 목록에 남지 않게 하기 위함입니다.
- 이미 있는 이메일은 건드리지 않고 건너뜁니다(비밀번호도 바꾸지 않음). 여러 번 돌려도 같습니다.
- 출력에는 계정 종류와 ID만 남깁니다. 이메일·이름·비밀번호는 찍지 않습니다 (H-4).
- 실제 원아·학부모 정보를 넣지 않습니다. 팀원 본인이나 합성 값만 씁니다.
"""

from __future__ import annotations

import argparse
import getpass
import os
import uuid

from core.database import SessionLocal
from domains.auth import service


def _password(env_name: str, label: str) -> str:
    value = os.environ.get(env_name)
    if value:
        return value
    value = getpass.getpass(f"{label} 비밀번호: ")
    if not value:
        raise SystemExit(f"{label} 비밀번호가 비어 있습니다 ({env_name}).")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--teacher-email", required=True)
    parser.add_argument("--teacher-name", required=True)
    parser.add_argument(
        "--center-id",
        type=uuid.UUID,
        default=None,
        help="교사의 소속 어린이집 ID. 없으면 소속 확정 전 교사로 만듭니다(반 목록이 비어 보임).",
    )
    parser.add_argument("--parent-email")
    parser.add_argument("--parent-name")
    args = parser.parse_args()
    if bool(args.parent_email) != bool(args.parent_name):
        parser.error("--parent-email과 --parent-name은 함께 넘겨야 합니다.")

    with SessionLocal() as db:
        if service.account_exists(db, args.teacher_email):
            print("teacher: 이미 있어 건너뜁니다")
        else:
            teacher = service.create_teacher_account(
                db,
                email=args.teacher_email,
                password=_password("DEMO_TEACHER_PASSWORD", "교사"),
                name=args.teacher_name,
                center_id=args.center_id,
            )
            print(f"teacher: 만들었습니다 teacher_id={teacher.id}")

        if args.parent_email:
            if service.account_exists(db, args.parent_email):
                print("parent: 이미 있어 건너뜁니다")
            else:
                parent = service.create_parent_account(
                    db,
                    email=args.parent_email,
                    password=_password("DEMO_PARENT_PASSWORD", "학부모"),
                    name=args.parent_name,
                )
                print(f"parent: 만들었습니다 parent_id={parent.id}")
        db.commit()


if __name__ == "__main__":
    main()
