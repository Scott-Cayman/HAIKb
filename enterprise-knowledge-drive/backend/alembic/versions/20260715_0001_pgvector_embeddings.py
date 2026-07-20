"""Enable pgvector and add the chunk embedding store.

Revision ID: 20260715_0001
Revises: None
Create Date: 2026-07-15
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20260715_0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    op.execute(
        """
        CREATE TABLE rag_chunk_embeddings (
            chunk_id VARCHAR PRIMARY KEY REFERENCES summary_chunks(id) ON DELETE CASCADE,
            index_id INTEGER NOT NULL REFERENCES rag_indices(id) ON DELETE CASCADE,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            model VARCHAR(255) NOT NULL,
            dimensions INTEGER NOT NULL DEFAULT 1024,
            content_hash VARCHAR(64) NOT NULL,
            embedding vector(1024) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute('CREATE INDEX idx_rag_chunk_embedding_index_file ON rag_chunk_embeddings (index_id, file_id)')
    op.execute('CREATE INDEX idx_rag_chunk_embedding_content_hash ON rag_chunk_embeddings (content_hash)')
    op.execute(
        """
        CREATE INDEX idx_rag_chunk_embedding_hnsw
        ON rag_chunk_embeddings USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 96)
        """
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS rag_chunk_embeddings')
