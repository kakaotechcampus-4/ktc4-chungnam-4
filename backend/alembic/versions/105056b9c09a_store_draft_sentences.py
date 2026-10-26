"""store draft sentences

Revision ID: 105056b9c09a
Revises: 21171b2bd658
Create Date: 2026-10-12 17:03:42.693203
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "105056b9c09a"
down_revision: str | Sequence[str] | None = "21171b2bd658"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 초안 본문을 문자열 하나에서 문장 단위로 바꾸고, 문장을 순번이 아니라 sentence_id로 가리킨다
# (#75). 데이터가 있어도 양방향으로 잃지 않게 옮긴다 — agents는 문장을 줄바꿈으로 합쳐
# content에 저장해 왔으므로 줄 단위로 나누면 원래 문장이 된다.
def upgrade() -> None:
    op.create_table(
        "draft_sentences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("draft_id", sa.UUID(), nullable=False),
        sa.Column("sentence_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("is_edited_by_teacher", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["draft_id"], ["draft_documents.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("draft_id", "sentence_id", name="uq_draft_sentence_id"),
        sa.UniqueConstraint("draft_id", "position", name="uq_draft_sentence_position"),
    )
    # 기존 본문을 줄 단위 문장으로 옮긴다. 빈 줄은 문장이 아니라 건너뛰고, 번호는 남은
    # 줄 기준으로 다시 매긴다.
    op.execute(
        r"""
        INSERT INTO draft_sentences
            (id, draft_id, sentence_id, position, text, is_edited_by_teacher,
             created_at, updated_at)
        SELECT gen_random_uuid(), numbered.draft_id, 's' || numbered.n, numbered.n - 1,
               numbered.body, false, now(), now()
        FROM (
            SELECT d.id AS draft_id, line.body,
                   row_number() OVER (PARTITION BY d.id ORDER BY line.ord) AS n
            FROM draft_documents AS d
            CROSS JOIN LATERAL regexp_split_to_table(d.content, E'\n')
                WITH ORDINALITY AS line(body, ord)
            WHERE line.body <> ''
        ) AS numbered
        """
    )
    op.drop_column("draft_documents", "content")

    # 검증을 통과한 초안은 verified(교사 검토 대기)다 (#75·#106). in_review는 더 쓰지 않는다.
    op.execute("UPDATE draft_documents SET status = 'verified' WHERE status = 'in_review'")

    op.add_column("revision_logs", sa.Column("target_sentence_id", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE revision_logs AS r
        SET target_sentence_id = s.sentence_id
        FROM draft_sentences AS s
        WHERE s.draft_id = r.draft_id AND s.position = r.target_sentence_index
        """
    )
    op.drop_column("revision_logs", "target_sentence_index")


def downgrade() -> None:
    op.add_column("revision_logs", sa.Column("target_sentence_index", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE revision_logs AS r
        SET target_sentence_index = s.position
        FROM draft_sentences AS s
        WHERE s.draft_id = r.draft_id AND s.sentence_id = r.target_sentence_id
        """
    )
    op.drop_column("revision_logs", "target_sentence_id")

    op.execute("UPDATE draft_documents SET status = 'in_review' WHERE status = 'verified'")

    # 행이 있어도 NOT NULL 컬럼을 추가할 수 있게 잠시 기본값을 두고, 문장을 합친 뒤 뗀다.
    op.add_column(
        "draft_documents",
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(
        r"""
        UPDATE draft_documents AS d
        SET content = joined.body
        FROM (
            SELECT draft_id, string_agg(text, E'\n' ORDER BY position) AS body
            FROM draft_sentences
            GROUP BY draft_id
        ) AS joined
        WHERE joined.draft_id = d.id
        """
    )
    op.alter_column("draft_documents", "content", server_default=None)
    op.drop_table("draft_sentences")
