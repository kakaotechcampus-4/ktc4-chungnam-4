"""Persist teacher transcript review fields.

Revision ID: a827d54c901e
Revises: f832a619bc40
"""

import sqlalchemy as sa

from alembic import op

revision = "a827d54c901e"
down_revision = "f832a619bc40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transcript_segments", sa.Column("text", sa.String(), nullable=True))
    op.add_column("transcript_segments", sa.Column("speaker", sa.String(), nullable=True))
    op.add_column(
        "transcript_segments",
        sa.Column("excluded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "transcript_segments", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    for name in ("reviewed_at", "excluded", "speaker", "text"):
        op.drop_column("transcript_segments", name)
