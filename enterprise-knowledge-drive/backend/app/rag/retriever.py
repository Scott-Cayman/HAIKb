from __future__ import annotations

import json
from typing import Dict, List, Optional

from sqlalchemy import or_

from app.models.file import File
from app.models.folder import Folder
from app.models.rag_index import SummaryChunk


def _merge_and_deduplicate(results: List[dict]) -> List[dict]:
    merged: Dict[str, dict] = {}
    for item in results:
        chunk_id = item["chunk_id"]
        if chunk_id not in merged or item["score"] > merged[chunk_id]["score"]:
            merged[chunk_id] = item
    return list(merged.values())


def _simple_rerank(query: str, results: List[dict]) -> List[dict]:
    query_terms = [term for term in query.lower().split() if term]
    for item in results:
        content = (item.get("content") or "").lower()
        boost = 0.0
        for term in query_terms:
            if term in content:
                boost += 0.05
        item["score"] = round(float(item["score"]) + boost, 6)
    results.sort(key=lambda item: item["score"], reverse=True)
    return results


class SummaryRetrievalPipeline:
    """只从 AI_DOCUMENT_SUMMARY 切片里检索。"""

    def __init__(self, index_id: int, vector_store, doc_store, keyword_store, db_factory, settings: dict | None = None):
        self.index_id = index_id
        self.vector_store = vector_store
        self.doc_store = doc_store
        self.keyword_store = keyword_store
        self.db_factory = db_factory
        self.settings = settings or {}

    def _load_chunk(self, chunk_id: str) -> Optional[SummaryChunk]:
        with self.db_factory() as db:
            return (
                db.query(SummaryChunk)
                .filter(SummaryChunk.index_id == self.index_id, SummaryChunk.id == chunk_id)
                .first()
            )

    def run(self, query: str, top_k: int = 8, retrieval_mode: str = "hybrid", filters: Optional[dict] = None) -> List[dict]:
        vector_results: List[dict] = []
        keyword_results: List[dict] = []

        if retrieval_mode in ["vector", "hybrid"]:
            vector_results = self.vector_store.search(query, top_k=top_k, filters=filters)
        if retrieval_mode in ["keyword", "hybrid"]:
            keyword_results = self.keyword_store.search(query, top_k=top_k, filters=filters)

        merged = _merge_and_deduplicate(vector_results + keyword_results)
        reranked = _simple_rerank(query, merged)

        enriched = []
        for item in reranked[:top_k]:
            chunk = self._load_chunk(item["chunk_id"])
            if not chunk:
                continue
            metadata = item.get("metadata") or {}
            if not metadata and chunk.metadata_json:
                metadata = json.loads(chunk.metadata_json)
            enriched.append(
                {
                    "chunk_id": chunk.id,
                    "summary_id": chunk.summary_id,
                    "file_id": chunk.file_id,
                    "content": chunk.content,
                    "score": item["score"],
                    "metadata": metadata,
                }
            )
        if not enriched:
            return []

        file_ids = list({item["file_id"] for item in enriched if item.get("file_id") is not None})
        if not file_ids:
            return []

        with self.db_factory() as db:
            active_rows = (
                db.query(File.id)
                .outerjoin(Folder, Folder.id == File.folder_id)
                .filter(
                    File.id.in_(file_ids),
                    File.is_deleted == False,
                    or_(File.folder_id == None, Folder.is_deleted == False),
                )
                .all()
            )
        active_file_ids = {row[0] for row in active_rows}
        return [item for item in enriched if item["file_id"] in active_file_ids]
