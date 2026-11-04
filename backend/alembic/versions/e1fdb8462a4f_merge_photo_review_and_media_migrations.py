"""Merge photo review and media migrations

Revision ID: e1fdb8462a4f
Revises: c8f4a21d6b90, a827d54c901e
Create Date: 2026-11-02 11:02:40.662928
"""

from collections.abc import Sequence

revision: str = "e1fdb8462a4f"
down_revision: str | Sequence[str] | None = ("c8f4a21d6b90", "a827d54c901e")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
