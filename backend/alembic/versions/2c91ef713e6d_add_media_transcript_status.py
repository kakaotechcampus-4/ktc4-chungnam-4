"""add media transcript status

Revision ID: 2c91ef713e6d
Revises: fa3e9648dc22
Create Date: 2026-10-30 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "2c91ef713e6d"
down_revision: str | Sequence[str] | None = "fa3e9648dc22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 영상·음성의 STT 진행 상태 (파이프라인 1-B, 테크스펙 MediaAsset). 사진은 null이라 nullable이고,
# 이미 올라온 영상·음성도 null로 남아 STT를 다시 돌리지 않습니다.
def upgrade() -> None:
    op.add_column("media_assets", sa.Column("transcript_status", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("media_assets", "transcript_status")
