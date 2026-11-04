"""#196: 기존 기록을 보존하고 생성 실패를 원아·날짜에 연결한다."""

import sqlalchemy as sa

from alembic import op

revision = "a6d3b920e105"
down_revision = "7b2d5e8c1a64"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("error_code", sa.String(), nullable=True))
    op.add_column("jobs", sa.Column("unclassified_reason", sa.String(), nullable=True))
    op.add_column("unclassified_items", sa.Column("child_id", sa.Uuid(), nullable=True))
    op.add_column("unclassified_items", sa.Column("record_date", sa.Date(), nullable=True))
    op.execute("UPDATE unclassified_items SET status = 'open' WHERE status = 'pending'")
    op.create_index(
        "uq_unclassified_open_child_date",
        "unclassified_items",
        ["child_id", "record_date"],
        unique=True,
        postgresql_where=sa.text("status = 'open'"),
        sqlite_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_column("jobs", "unclassified_reason")
    op.drop_column("jobs", "error_code")
    op.drop_index("uq_unclassified_open_child_date", table_name="unclassified_items")
    op.execute("UPDATE unclassified_items SET status = 'pending' WHERE status = 'open'")
    op.drop_column("unclassified_items", "record_date")
    op.drop_column("unclassified_items", "child_id")
