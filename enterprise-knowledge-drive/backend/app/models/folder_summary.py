from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base


class FolderSummary(Base):
    __tablename__ = 'folder_summaries'

    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey('folders.id'), nullable=False, unique=True, index=True)
    summary_markdown = Column(Text, nullable=False)
    summary_file_path = Column(String, nullable=True)
    file_count = Column(Integer, default=0)
    subfolder_count = Column(Integer, default=0)
    summary_status = Column(String, default='pending')
    summary_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
