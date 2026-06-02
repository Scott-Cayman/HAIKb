from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base


class File(Base):
    __tablename__ = 'files'

    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey('folders.id'), nullable=True)
    original_name = Column(String, index=True, nullable=False)
    stored_name = Column(String, nullable=False)
    file_ext = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    size = Column(Integer, default=0)
    storage_path = Column(String, nullable=False)
    preview_path = Column(String, nullable=True)
    preview_status = Column(String, default='pending')
    summary_status = Column(String, default='pending')
    summary_error = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey('users.id'))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    download_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
