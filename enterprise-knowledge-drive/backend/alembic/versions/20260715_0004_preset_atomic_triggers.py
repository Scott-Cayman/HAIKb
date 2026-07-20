"""Add atomic trigger index for folder AI presets.

Revision ID: 20260715_0004
Revises: 20260715_0003
Create Date: 2026-07-15
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260715_0004"
down_revision: Union[str, None] = "20260715_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE folder_ai_preset_triggers (
            id BIGSERIAL PRIMARY KEY,
            question_id INTEGER NOT NULL REFERENCES folder_ai_preset_questions(id) ON DELETE CASCADE,
            preset_id INTEGER NOT NULL REFERENCES folder_ai_presets(id) ON DELETE CASCADE,
            trigger_text TEXT NOT NULL,
            normalized_trigger VARCHAR NOT NULL,
            trigger_type VARCHAR NOT NULL DEFAULT 'alias',
            evidence_text TEXT NOT NULL,
            evidence_hash VARCHAR(64) NOT NULL,
            embedding_model VARCHAR NOT NULL,
            dimensions INTEGER NOT NULL DEFAULT 1024,
            embedding vector(1024) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_folder_ai_preset_trigger UNIQUE (question_id, normalized_trigger)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_folder_ai_preset_triggers_question_id "
        "ON folder_ai_preset_triggers (question_id)"
    )
    op.execute(
        "CREATE INDEX ix_folder_ai_preset_triggers_preset_id "
        "ON folder_ai_preset_triggers (preset_id)"
    )
    op.execute(
        "CREATE INDEX ix_folder_ai_preset_triggers_normalized "
        "ON folder_ai_preset_triggers (normalized_trigger)"
    )
    op.execute(
        "CREATE INDEX ix_folder_ai_preset_triggers_evidence_hash "
        "ON folder_ai_preset_triggers (evidence_hash)"
    )
    op.execute(
        "CREATE INDEX ix_folder_ai_preset_triggers_hnsw "
        "ON folder_ai_preset_triggers USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 96)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS folder_ai_preset_triggers")
