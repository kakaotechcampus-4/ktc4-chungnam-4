"""use sentence_id in agents logs and add verification doc_version

Revision ID: 1d4a8b2f7955
Revises: e1822c9dc830
Create Date: 2026-10-11 12:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "1d4a8b2f7955"
down_revision: str | Sequence[str] | None = "e1822c9dc830"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 두 테이블은 초안 생성이 아직 연결되지 않아 비어 있다(배포 서버에서 0건 확인, 10/11).
# 순번을 문자열 id로 옮길 데이터가 없어 컬럼을 바꿔 끼우고, doc_version은 기본값 없이 NOT NULL로 둔다.
def upgrade() -> None:
    # 순번은 교사가 문장을 끼워 넣거나 지우면 밀린다 — sentence_id로 가리킨다 (#75).
    op.drop_constraint("uq_sentence_evidence_ref", "sentence_evidences", type_="unique")
    op.drop_column("sentence_evidences", "sentence_index")
    op.add_column("sentence_evidences", sa.Column("sentence_id", sa.String(), nullable=False))
    op.create_unique_constraint(
        "uq_sentence_evidence_ref",
        "sentence_evidences",
        ["draft_id", "sentence_id", "evidence_id"],
    )

    # 재생성 버전마다 실패 사유를 구분한다 (#91).
    op.drop_column("verification_results", "sentence_index")
    op.add_column("verification_results", sa.Column("sentence_id", sa.String(), nullable=True))
    op.add_column("verification_results", sa.Column("doc_version", sa.Integer(), nullable=False))


# 롤백 때는 AI 문장 id(s1, s2…)를 옛 0부터 센 순번으로 되돌려 데이터를 살린다.
# 순번으로 바꿀 수 없는 id(s+숫자가 아닌 것)의 근거 행은 지우고, 검증 결과는 sentence_index를 NULL로 둔다.
# doc_version은 옛 스키마에 없어 사라진다.
_AI_SENTENCE_ID = "^s[0-9]+$"
_TO_INDEX = "CAST(substring(sentence_id FROM 2) AS INTEGER) - 1"


def downgrade() -> None:
    op.add_column("verification_results", sa.Column("sentence_index", sa.Integer(), nullable=True))
    op.execute(
        f"UPDATE verification_results SET sentence_index = {_TO_INDEX} "
        f"WHERE sentence_id ~ '{_AI_SENTENCE_ID}'"
    )
    op.drop_column("verification_results", "sentence_id")
    op.drop_column("verification_results", "doc_version")

    op.drop_constraint("uq_sentence_evidence_ref", "sentence_evidences", type_="unique")
    op.add_column("sentence_evidences", sa.Column("sentence_index", sa.Integer(), nullable=True))
    op.execute(f"DELETE FROM sentence_evidences WHERE sentence_id !~ '{_AI_SENTENCE_ID}'")
    op.execute(f"UPDATE sentence_evidences SET sentence_index = {_TO_INDEX}")
    op.alter_column("sentence_evidences", "sentence_index", nullable=False)
    op.drop_column("sentence_evidences", "sentence_id")
    op.create_unique_constraint(
        "uq_sentence_evidence_ref",
        "sentence_evidences",
        ["draft_id", "sentence_index", "evidence_id"],
    )
