"""add education plan details

교육 계획 화면(FR-20, FR-21)이 쓰는 요일별 놀이(education_plans.daily_activities)·누리과정
영역(domains)·수정 시각(updated_at)을 더합니다 (docs/api/organization.md §교육 계획).
놀이 목표는 기존 content 컬럼을 그대로 씁니다. 기존 행은 요일별 놀이·영역이 없는 것(빈 객체·
빈 배열)으로, 수정 시각은 만든 시각으로 채웁니다.

Revision ID: 3c7e1a9d4f20
Revises: fa3e9648dc22
Create Date: 2026-10-29 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "3c7e1a9d4f20"
down_revision: str | Sequence[str] | None = "fa3e9648dc22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "education_plans",
        sa.Column("daily_activities", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "education_plans",
        sa.Column("domains", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "education_plans",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE education_plans SET updated_at = created_at")
    op.alter_column("education_plans", "updated_at", nullable=False)


def downgrade() -> None:
    op.drop_column("education_plans", "updated_at")
    op.drop_column("education_plans", "domains")
    op.drop_column("education_plans", "daily_activities")
