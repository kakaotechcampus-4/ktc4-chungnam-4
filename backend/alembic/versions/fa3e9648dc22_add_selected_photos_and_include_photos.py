"""add selected photos and include_photos

교사가 알림장에 고른 사진(draft_documents.selected_media_ids)과 게시할 때 "사진도 함께
보내기"(document_publications.include_photos)를 저장합니다 (FR-08, docs/api/documents.md).
기존 행은 사진을 고르지 않은 것(빈 배열)과 글만 보낸 것(false)으로 채웁니다 — 둘 다
학부모에게 사진을 내보내지 않는 쪽이라 안전합니다.

Revision ID: fa3e9648dc22
Revises: 105056b9c09a
Create Date: 2026-10-27 15:56:49.163275
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "fa3e9648dc22"
down_revision: str | Sequence[str] | None = "105056b9c09a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "draft_documents",
        sa.Column("selected_media_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "document_publications",
        sa.Column("include_photos", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("document_publications", "include_photos")
    op.drop_column("draft_documents", "selected_media_ids")
