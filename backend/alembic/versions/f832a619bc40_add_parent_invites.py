"""add parent invites

Revision ID: f832a619bc40
Revises: d391719458b8
"""

import sqlalchemy as sa

from alembic import op

revision = "f832a619bc40"
down_revision = "d391719458b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "parent_invites",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("child_id", sa.UUID(), nullable=False),
        sa.Column("created_by_teacher_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_parent_invites_child_id", "parent_invites", ["child_id"])


def downgrade() -> None:
    op.drop_index("ix_parent_invites_child_id", table_name="parent_invites")
    op.drop_table("parent_invites")
