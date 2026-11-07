"""멀티에이전트 실행·월별 관찰일지의 근거 연결(FR-06·FR-07·FR-27)."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "ab61c93e20d4"
down_revision = "e1fdb8462a4f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "generation_jobs",
        sa.Column("doc_type", sa.String(), nullable=False, server_default="parent_note"),
    )
    op.add_column("jobs", sa.Column("stage", sa.String(), nullable=True))
    op.add_column("jobs", sa.Column("agent_trace", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("evidence_bundles", sa.Column("daily_routine", sa.JSON(), nullable=True))
    op.add_column(
        "sentence_evidences",
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("draft_sentences", sa.Column("section", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("draft_sentences", "section")
    op.drop_column("sentence_evidences", "source_document_id")
    op.drop_column("evidence_bundles", "daily_routine")
    op.drop_column("jobs", "agent_trace")
    op.drop_column("jobs", "stage")
    op.drop_column("generation_jobs", "doc_type")
