from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime


class AgentMessage(Base):
    __tablename__ = 'agent_messages'

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(String, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())
