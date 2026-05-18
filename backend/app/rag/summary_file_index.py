from __future__ import annotations

from app.database import SessionLocal
from app.rag.base_index import BaseIndex
from app.rag.doc_store import SummaryDocStore
from app.rag.keyword_store import KeywordStore
from app.rag.pipelines import SummaryIndexingPipeline
from app.rag.retriever import SummaryRetrievalPipeline
from app.rag.vector_store import VectorStoreAdapter


class SummaryFileIndex(BaseIndex):
    """只管理总结文档索引，不碰原文件全文。"""

    def on_create(self) -> None:
        pass

    def on_start(self) -> None:
        collection_name = f"summary_index_{self.id}"
        self.vector_store = VectorStoreAdapter(collection_name=collection_name)
        self.doc_store = SummaryDocStore(index_id=self.id, db_factory=SessionLocal)
        self.keyword_store = KeywordStore(index_id=self.id, db_factory=SessionLocal)

    def get_indexing_pipeline(self, settings: dict, user_id=None):
        return SummaryIndexingPipeline(
            index_id=self.id,
            vector_store=self.vector_store,
            doc_store=self.doc_store,
            keyword_store=self.keyword_store,
            db_factory=SessionLocal,
            settings=settings,
        )

    def get_retriever_pipeline(self, settings: dict, user_id=None):
        return SummaryRetrievalPipeline(
            index_id=self.id,
            vector_store=self.vector_store,
            doc_store=self.doc_store,
            keyword_store=self.keyword_store,
            db_factory=SessionLocal,
            settings=settings,
        )
