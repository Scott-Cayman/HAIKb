"""Bind structured preset answers to folders.

Revision ID: 20260715_0003
Revises: 20260715_0002
Create Date: 2026-07-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260715_0003"
down_revision: Union[str, None] = "20260715_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "folder_ai_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("folder_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_content", sa.Text(), nullable=False, server_default=""),
        sa.Column("inherit_to_children", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"]),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_folder_ai_presets_folder_id", "folder_ai_presets", ["folder_id"])
    op.create_index("ix_folder_ai_presets_status", "folder_ai_presets", ["status"])
    op.create_index("ix_folder_ai_presets_is_deleted", "folder_ai_presets", ["is_deleted"])

    op.create_table(
        "folder_ai_preset_questions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("preset_id", sa.Integer(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("normalized_question", sa.String(), nullable=False),
        sa.Column("aliases_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("keywords_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("embedding_json", sa.Text(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["preset_id"], ["folder_ai_presets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("preset_id", "normalized_question", name="uq_folder_ai_preset_question"),
    )
    op.create_index("ix_folder_ai_preset_questions_preset_id", "folder_ai_preset_questions", ["preset_id"])
    op.create_index(
        "ix_folder_ai_preset_questions_normalized_question",
        "folder_ai_preset_questions",
        ["normalized_question"],
    )
    op.create_index("ix_folder_ai_preset_questions_is_enabled", "folder_ai_preset_questions", ["is_enabled"])


def downgrade() -> None:
    op.drop_table("folder_ai_preset_questions")
    op.drop_table("folder_ai_presets")
