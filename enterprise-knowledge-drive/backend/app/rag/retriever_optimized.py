from __future__ import annotations

import json
import logging
import re
from typing import Dict, List, Optional

from sqlalchemy import or_

from app.models.file import File
from app.models.folder import Folder
from app.models.rag_index import SummaryChunk


logger = logging.getLogger(__name__)


def _reciprocal_rank_fusion(result_sets: List[List[dict]], rank_constant: int = 60) -> List[dict]:
    """Combine stores without assuming their raw scores share the same scale."""
    merged: Dict[str, dict] = {}
    for results in result_sets:
        for rank, item in enumerate(results, start=1):
            chunk_id = item["chunk_id"]
            if chunk_id not in merged:
                merged[chunk_id] = dict(item)
                merged[chunk_id]["score"] = 0.0
            merged[chunk_id]["score"] += 1.0 / (rank_constant + rank)
    fused = list(merged.values())
    fused.sort(key=lambda item: item["score"], reverse=True)
    return fused


def _simple_rerank(query: str, results: List[dict]) -> List[dict]:
    cleaned = (query or "").strip().lower()
    query_terms = set(re.findall(r"[a-z0-9_]{2,}", cleaned))
    for part in re.findall(r"[\u4e00-\u9fff]{2,}", cleaned):
        query_terms.add(part)
        query_terms.update(part[index : index + 2] for index in range(max(len(part) - 1, 1)))
    for item in results:
        content = (item.get("content") or "").lower()
        hit_count = sum(1 for term in query_terms if term in content)
        boost = min(hit_count * 0.04, 0.24)
        item["score"] = round(float(item["score"]) * (1.0 + boost), 6)
    results.sort(key=lambda item: item["score"], reverse=True)
    return results


class OptimizedSummaryRetrievalPipeline:
    """优化的检索管道，使用批量查询。"""

    def __init__(self, index_id: int, vector_store, doc_store, keyword_store, db_factory, settings: dict | None = None):
        self.index_id = index_id
        self.vector_store = vector_store
        self.doc_store = doc_store
        self.keyword_store = keyword_store
        self.db_factory = db_factory
        self.settings = settings or {}

    def run(self, query: str, top_k: int = 8, retrieval_mode: str = "hybrid", filters: Optional[dict] = None) -> List[dict]:
        vector_results: List[dict] = []
        keyword_results: List[dict] = []
        candidate_k = min(max(top_k * 4, 40), 100)

        if retrieval_mode in ["vector", "hybrid"]:
            try:
                vector_results = self.vector_store.search(query, top_k=candidate_k, filters=filters)
            except Exception:
                if retrieval_mode == "vector":
                    raise
                logger.exception("Vector retrieval failed; continuing with PostgreSQL lexical retrieval.")
        if retrieval_mode in ["keyword", "hybrid"]:
            try:
                keyword_results = self.keyword_store.search(query, top_k=candidate_k, filters=filters)
            except Exception:
                if retrieval_mode == "keyword" or not vector_results:
                    raise
                logger.exception("Lexical retrieval failed; continuing with vector retrieval.")

        merged = _reciprocal_rank_fusion([vector_results, keyword_results])
        reranked = _simple_rerank(query, merged)

        enriched = self._load_chunks_batch(reranked[:top_k])
        if not enriched:
            return []

        active_file_ids = self._filter_active_files(enriched)
        return [item for item in enriched if item["file_id"] in active_file_ids]

    def _load_chunks_batch(self, items: List[dict]) -> List[dict]:
        """批量加载 chunk，避免 N+1 查询问题。"""
        if not items:
            return []

        chunk_ids = [item["chunk_id"] for item in items]
        with self.db_factory() as db:
            chunks = (
                db.query(SummaryChunk)
                .filter(SummaryChunk.index_id == self.index_id, SummaryChunk.id.in_(chunk_ids))
                .all()
            )

        chunk_map = {chunk.id: chunk for chunk in chunks}
        enriched = []

        for item in items:
            chunk = chunk_map.get(item["chunk_id"])
            if not chunk:
                continue
            metadata = item.get("metadata") or {}
            if not metadata and chunk.metadata_json:
                try:
                    metadata = json.loads(chunk.metadata_json)
                except json.JSONDecodeError:
                    metadata = {}
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
        return enriched

    def _filter_active_files(self, items: List[dict]) -> set:
        """批量检查文件是否有效。"""
        file_ids = list({item["file_id"] for item in items if item.get("file_id") is not None})
        if not file_ids:
            return set()

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
        return {row[0] for row in active_rows}
