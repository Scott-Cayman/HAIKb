from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.sql import func
from app.database import Base


class UserFileView(Base):
    __tablename__ = 'user_file_views'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    file_id = Column(Integer, ForeignKey('files.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
