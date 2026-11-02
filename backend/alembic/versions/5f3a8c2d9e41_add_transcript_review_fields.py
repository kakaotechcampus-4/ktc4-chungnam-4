"""add transcript review fields

교사 발화 확인(FR-14, FR-27)에서 채우는 transcript_segments 4개 컬럼을 더합니다
(테크스펙 TranscriptSegment, 09/30 #83). text는 null이면 raw_text로 읽으므로 기존 행을
채우지 않습니다. excluded는 STT 저장(#219)이 이 컬럼을 넣으므로 server_default로 기존 행도 false입니다.

Revision ID: 5f3a8c2d9e41
Revises: d391719458b8
Create Date: 2026-11-02 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5f3a8c2d9e41"
down_revision: str | Sequence[str] | None = "d391719458b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("transcript_segments", sa.Column("text", sa.String(), nullable=True))
    op.add_column("transcript_segments", sa.Column("speaker", sa.String(), nullable=True))
    op.add_column(
        "transcript_segments",
        sa.Column("excluded", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "transcript_segments",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("transcript_segments", "reviewed_at")
    op.drop_column("transcript_segments", "excluded")
    op.drop_column("transcript_segments", "speaker")
    op.drop_column("transcript_segments", "text")
