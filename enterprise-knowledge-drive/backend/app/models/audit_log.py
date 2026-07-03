from sqlalchemy import Column, Integer, String, ForeignKey, Text
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    action = Column(String, nullable=False)
    target_type = Column(String, nullable=True)
    target_id = Column(Integer, nullable=True)
    detail = Column(Text, nullable=True)
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())
