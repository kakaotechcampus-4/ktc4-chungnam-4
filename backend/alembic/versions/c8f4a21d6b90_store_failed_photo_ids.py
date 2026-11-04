"""Keep excluded photo IDs for teacher draft review (#231, #155)."""

import sqlalchemy as sa

from alembic import op

revision = "c8f4a21d6b90"
down_revision = "a6d3b920e105"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "evidence_bundles",
        sa.Column("failed_photo_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("evidence_bundles", "failed_photo_ids")
