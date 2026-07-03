from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime

class Folder(Base):
    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    parent_id = Column(Integer, ForeignKey("folders.id"), nullable=True)
    name = Column(String, index=True, nullable=False)
    description = Column(String, nullable=True)
    cover_url = Column(String, nullable=True)
    sort_order = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"))
    # 部门信息
    department_name = Column(String, nullable=True)  # 创建者的部门名称
    is_super_admin_created = Column(Boolean, default=False)  # 是否由超级管理员创建
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
