"""add teacher evidences

교사가 아이·날짜별로 직접 남기는 관찰 메모(추가 근거)를 저장합니다 (FR-05,
docs/api/agents.md §추가 근거). 아이·날짜당 1건이라 (child_id, record_date)를 UNIQUE로
둡니다. 새 테이블이라 기존 행에는 영향이 없습니다.

Revision ID: 3b7c1d9e5a42
Revises: e1fdb8462a4f
Create Date: 2026-11-07 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "3b7c1d9e5a42"
down_revision: str | Sequence[str] | None = "e1fdb8462a4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "teacher_evidences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("child_id", sa.UUID(), nullable=False),
        sa.Column("record_date", sa.Date(), nullable=False),
        sa.Column("activity_time", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("author_teacher_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("child_id", "record_date", name="uq_teacher_evidences_child_date"),
    )


def downgrade() -> None:
    op.drop_table("teacher_evidences")
