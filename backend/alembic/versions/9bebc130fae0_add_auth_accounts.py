"""add auth accounts

교사·학부모 로그인 테이블(accounts·teachers·parents)을 만듭니다 (FR-13). 모델은 #78에서
들어왔지만 alembic/env.py에 auth가 등록되지 않아 초기 마이그레이션에서 빠졌습니다.
teachers.center_id는 모델대로 FK 없이 둡니다 — 가입 코드로 소속을 확정하기 전에는 비어
있습니다 (FR-23·FR-24, domains/auth/models.py).

Revision ID: 9bebc130fae0
Revises: 21171b2bd658
Create Date: 2026-10-14 16:23:13.834236
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9bebc130fae0"
down_revision: str | Sequence[str] | None = "21171b2bd658"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("account_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "parents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("phone", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
    )
    op.create_table(
        "teachers",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("center_id", sa.UUID(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id"),
    )


def downgrade() -> None:
    op.drop_table("teachers")
    op.drop_table("parents")
    op.drop_table("accounts")
