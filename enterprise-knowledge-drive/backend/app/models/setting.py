from sqlalchemy import Column, Integer, String
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime

class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String, unique=True, index=True, nullable=False)
    value = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())
