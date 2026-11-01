"""add media uploads and attributed_at

Revision ID: 21171b2bd658
Revises: 1d4a8b2f7955
Create Date: 2026-10-18 14:49:16.555411
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "21171b2bd658"
down_revision: str | Sequence[str] | None = "1d4a8b2f7955"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# #131·#132 모델이 #151로 develop에 들어갔는데 리비전이 빠져 있었다 — 배포 서버에서
# 업로드 URL 발급(media_uploads)과 MediaAsset 조회(attributed_at)가 DB 단계에서 실패한다.
def upgrade() -> None:
    # 업로드 URL 발급 기록 (FR-15, 테크스펙 데이터 모델 ③ MediaUpload)
    op.create_table(
        "media_uploads",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("client_photo_id", sa.UUID(), nullable=False),
        sa.Column("class_id", sa.UUID(), nullable=False),
        sa.Column("teacher_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("declared_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("url_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actual_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("media_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["media_id"], ["media_assets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_photo_id"),
    )
    op.create_index(
        "ix_media_uploads_state_url_expires_at",
        "media_uploads",
        ["state", "url_expires_at"],
        unique=False,
    )
    # 기존 행은 채우지 않는다. 이 리비전 전에는 완료 통지 경로가 없어 media_assets가 비어 있다.
    op.add_column(
        "media_assets", sa.Column("attributed_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("media_assets", "attributed_at")
    op.drop_index("ix_media_uploads_state_url_expires_at", table_name="media_uploads")
    op.drop_table("media_uploads")
