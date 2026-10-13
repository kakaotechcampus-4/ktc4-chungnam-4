"""add generation jobs

Revision ID: e1822c9dc830
Revises: 50e5f32ff61c
Create Date: 2026-10-04 21:50:01.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e1822c9dc830"
down_revision: str | Sequence[str] | None = "50e5f32ff61c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "generation_jobs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("class_id", sa.UUID(), nullable=False),
        sa.Column("record_date", sa.Date(), nullable=False),
        sa.Column("request_id", sa.String(), nullable=False),
        sa.Column("requested_by_teacher_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("request_id", name="uq_generation_jobs_request_id"),
    )
    # jobs는 아직 만드는 곳이 없어 비어 있다 — 기본값 없이 NOT NULL로 바로 추가한다.
    op.add_column("jobs", sa.Column("generation_job_id", sa.UUID(), nullable=False))
    op.create_index(op.f("ix_jobs_generation_job_id"), "jobs", ["generation_job_id"], unique=False)
    op.create_foreign_key(
        "fk_jobs_generation_job_id_generation_jobs",
        "jobs",
        "generation_jobs",
        ["generation_job_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_jobs_generation_job_id_generation_jobs", "jobs", type_="foreignkey")
    op.drop_index(op.f("ix_jobs_generation_job_id"), table_name="jobs")
    op.drop_column("jobs", "generation_job_id")
    op.drop_table("generation_jobs")
