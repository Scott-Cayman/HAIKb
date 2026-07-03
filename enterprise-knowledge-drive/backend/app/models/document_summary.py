from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime


class DocumentSummary(Base):
    __tablename__ = 'document_summaries'

    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, ForeignKey('files.id'), nullable=False, unique=True, index=True)
    summary_markdown = Column(Text, nullable=False)
    summary_file_path = Column(String, nullable=True)
    one_line_judgement = Column(Text, nullable=True)
    two_sentence_intro = Column(Text, nullable=True)
    client_type = Column(String, nullable=True)
    project_type = Column(String, nullable=True)
    document_type = Column(String, nullable=True)
    region_tags = Column(Text, nullable=True)
    industry_tags = Column(Text, nullable=True)
    keyword_tags = Column(Text, nullable=True)
    parse_pages = Column(Integer, default=10)
    parse_status = Column(String, default='pending')
    parse_confidence = Column(String, nullable=True)
    parse_error = Column(Text, nullable=True)
    index_status = Column(String, default='pending')
    index_error = Column(Text, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
