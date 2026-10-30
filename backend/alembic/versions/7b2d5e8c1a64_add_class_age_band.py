"""add class age band

반 만들기(FR-25)가 받는 연령 구분 코드(classes.age_band)를 더합니다. 에이전트가 이 값으로
교육과정(표준보육과정·누리과정)을 고릅니다 (docs/api/organization.md §공통 모양 ClassSummary).
이미 있는 반은 표시용 age_group이 "만 0"·"만 1"·"만 2"로 시작하면 infant, 그 밖은 preschool로
채웁니다.

Revision ID: 7b2d5e8c1a64
Revises: fa3e9648dc22
Create Date: 2026-10-29 16:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7b2d5e8c1a64"
down_revision: str | Sequence[str] | None = "fa3e9648dc22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "classes",
        sa.Column("age_band", sa.String(), nullable=False, server_default="preschool"),
    )
    op.execute(
        "UPDATE classes SET age_band = 'infant' "
        "WHERE age_group LIKE '만 0%' OR age_group LIKE '만 1%' OR age_group LIKE '만 2%'"
    )


def downgrade() -> None:
    op.drop_column("classes", "age_band")
