from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base
from app.models.types import AwareDateTime, Vector1024


class FolderAiPreset(Base):
    """A published or draft AI answer set owned by a knowledge-base folder."""

    __tablename__ = "folder_ai_presets"

    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey("folders.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    source_content = Column(Text, nullable=False, default="")
    inherit_to_children = Column(Boolean, nullable=False, default=True)
    status = Column(String, nullable=False, default="draft", index=True)
    version = Column(Integer, nullable=False, default=1)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, server_default=func.now(), onupdate=func.now())
    is_deleted = Column(Boolean, nullable=False, default=False, index=True)


class FolderAiPresetQuestion(Base):
    """Structured fast-path question generated from administrator-authored text."""

    __tablename__ = "folder_ai_preset_questions"
    __table_args__ = (
        UniqueConstraint("preset_id", "normalized_question", name="uq_folder_ai_preset_question"),
    )

    id = Column(Integer, primary_key=True, index=True)
    preset_id = Column(Integer, ForeignKey("folder_ai_presets.id", ondelete="CASCADE"), nullable=False, index=True)
    question = Column(Text, nullable=False)
    normalized_question = Column(String, nullable=False, index=True)
    aliases_json = Column(Text, nullable=False, default="[]")
    answer = Column(Text, nullable=False)
    keywords_json = Column(Text, nullable=False, default="[]")
    embedding_json = Column(Text, nullable=True)
    priority = Column(Integer, nullable=False, default=100)
    is_enabled = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, server_default=func.now(), onupdate=func.now())


class FolderAiPresetTrigger(Base):
    """Atomic user phrasing or answer fact used by the preset fast-path index."""

    __tablename__ = "folder_ai_preset_triggers"
    __table_args__ = (
        UniqueConstraint("question_id", "normalized_trigger", name="uq_folder_ai_preset_trigger"),
    )

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(
        Integer,
        ForeignKey("folder_ai_preset_questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    preset_id = Column(
        Integer,
        ForeignKey("folder_ai_presets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trigger_text = Column(Text, nullable=False)
    normalized_trigger = Column(String, nullable=False, index=True)
    trigger_type = Column(String, nullable=False, default="alias")
    evidence_text = Column(Text, nullable=False)
    evidence_hash = Column(String(64), nullable=False, index=True)
    embedding_model = Column(String, nullable=False)
    dimensions = Column(Integer, nullable=False, default=1024)
    embedding = Column(Vector1024(), nullable=False)
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, server_default=func.now(), onupdate=func.now())
