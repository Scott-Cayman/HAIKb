from sqlalchemy import Column, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func
from app.database import Base
from app.models.types import AwareDateTime


class RagIndex(Base):
    __tablename__ = 'rag_indices'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    index_type = Column(String, nullable=False, default='summary_file_index')
    config_json = Column(Text, nullable=True)
    status = Column(String, default='active')
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())


class RagSource(Base):
    __tablename__ = 'rag_sources'

    id = Column(String, primary_key=True, index=True)
    index_id = Column(Integer, ForeignKey('rag_indices.id'), nullable=False, index=True)
    summary_id = Column(Integer, ForeignKey('document_summaries.id'), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey('files.id'), nullable=False, index=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=True)
    size = Column(Integer, default=0)
    note_json = Column(Text, nullable=True)
    status = Column(String, default='active')
    created_at = Column(AwareDateTime, server_default=func.now())
    updated_at = Column(AwareDateTime, onupdate=func.now())


class SummaryChunk(Base):
    __tablename__ = 'summary_chunks'

    id = Column(String, primary_key=True, index=True)
    index_id = Column(Integer, ForeignKey('rag_indices.id'), nullable=False, index=True)
    source_id = Column(String, ForeignKey('rag_sources.id'), nullable=False, index=True)
    summary_id = Column(Integer, ForeignKey('document_summaries.id'), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey('files.id'), nullable=False, index=True)
    chunk_index = Column(Integer, default=0)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())


class RagIndexRelation(Base):
    __tablename__ = 'rag_index_relations'

    id = Column(Integer, primary_key=True, autoincrement=True)
    index_id = Column(Integer, ForeignKey('rag_indices.id'), nullable=False, index=True)
    source_id = Column(String, ForeignKey('rag_sources.id'), nullable=False, index=True)
    target_id = Column(String, nullable=False, index=True)
    relation_type = Column(String, nullable=False)
    created_at = Column(AwareDateTime, server_default=func.now())
