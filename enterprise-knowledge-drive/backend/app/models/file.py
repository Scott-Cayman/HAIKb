from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime


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
    preview_kind = Column(String, nullable=True)
    preview_pages_path = Column(String, nullable=True)
    preview_page_count = Column(Integer, default=0)
    preview_error = Column(Text, nullable=True)
    thumbnail_path = Column(String, nullable=True)
    thumbnail_status = Column(String, default='pending')
    summary_status = Column(String, default='pending')
    summary_error = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey('users.id'))
    # 部门信息
    department_name = Column(String, nullable=True)  # 创建者的部门名称（或继承自文件夹）
    is_super_admin_created = Column(Boolean, default=False)  # 是否由超级管理员创建
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
    download_count = Column(Integer, default=0)
    view_count = Column(Integer, default=0)
