"""add password reset tokens

Revision ID: b7c1e4d92a35
Revises: e1fdb8462a4f
"""

import sqlalchemy as sa

from alembic import op

revision = "b7c1e4d92a35"
down_revision = "e1fdb8462a4f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("account_id", sa.UUID(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_password_reset_tokens_account_id", "password_reset_tokens", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_account_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
