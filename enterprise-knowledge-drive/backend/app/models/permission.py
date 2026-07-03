from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime

class FolderPermission(Base):
    __tablename__ = "folder_permissions"

    id = Column(Integer, primary_key=True, index=True)
    folder_id = Column(Integer, ForeignKey("folders.id"))
    permission_type = Column(String, nullable=False) # all, department, user, admin_only
    target_id = Column(String, nullable=True) # department_id or user_id
    created_at = Column(AwareDateTime, server_default=func.now())
