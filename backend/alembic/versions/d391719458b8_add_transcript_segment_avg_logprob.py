"""add transcript segment avg_logprob

Revision ID: d391719458b8
Revises: 2c91ef713e6d
Create Date: 2026-10-31 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d391719458b8"
down_revision: str | Sequence[str] | None = "2c91ef713e6d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Whisper 구간 확신도 (테크스펙 TranscriptSegment, #218 리뷰). 이미 저장된 발화는 값이 없어 nullable입니다.
def upgrade() -> None:
    op.add_column("transcript_segments", sa.Column("avg_logprob", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("transcript_segments", "avg_logprob")
