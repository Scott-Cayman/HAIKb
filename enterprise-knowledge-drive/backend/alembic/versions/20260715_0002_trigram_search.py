"""Add PostgreSQL trigram indexes for lexical retrieval.

Revision ID: 20260715_0002
Revises: 20260715_0001
Create Date: 2026-07-15
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20260715_0002'
down_revision: Union[str, None] = '20260715_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    op.execute(
        """
        CREATE INDEX idx_summary_chunks_content_trgm
        ON summary_chunks USING gin (lower(content) gin_trgm_ops)
        """
    )
    op.execute(
        """
        CREATE INDEX idx_files_original_name_trgm
        ON files USING gin (lower(original_name) gin_trgm_ops)
        """
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS idx_files_original_name_trgm')
    op.execute('DROP INDEX IF EXISTS idx_summary_chunks_content_trgm')
