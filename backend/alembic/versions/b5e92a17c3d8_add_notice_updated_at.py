"""add notice updated_at

공지 게시판(FR-11, FR-12)이 수정을 허용하므로 notices.updated_at을 더하고, 반의 공지 목록을
최신순으로 읽는 (class_id, created_at) 인덱스를 만듭니다 (docs/api/notice.md). 기존 행의 수정
시각은 만든 시각으로 채웁니다. notices 테이블 자체는 초기 마이그레이션에 이미 있습니다.

Revision ID: b5e92a17c3d8
Revises: b924e61fd730
Create Date: 2026-11-07 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5e92a17c3d8"
down_revision: str | Sequence[str] | None = "b924e61fd730"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notices",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE notices SET updated_at = created_at")
    op.alter_column("notices", "updated_at", nullable=False)
    op.create_index("ix_notices_class_id_created_at", "notices", ["class_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_notices_class_id_created_at", table_name="notices")
    op.drop_column("notices", "updated_at")
