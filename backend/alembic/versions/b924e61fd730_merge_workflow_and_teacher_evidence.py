"""멀티에이전트와 교사 메모 migration을 하나의 배포 head로 연결한다.

FR-05·FR-06: 이미 적용된 두 revision의 이력을 유지하며 새 DDL은 실행하지 않는다.
"""

revision = "b924e61fd730"
down_revision = ("ab61c93e20d4", "3b7c1d9e5a42")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
