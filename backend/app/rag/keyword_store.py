from __future__ import annotations

import json
import re
from collections import Counter
from typing import List, Optional

from sqlalchemy import or_

from app.models.rag_index import SummaryChunk


class KeywordStore:
    """SQLite LIKE 版关键词检索，作为混合检索里的稳定兜底。"""

    def __init__(self, index_id: int, db_factory):
        self.index_id = index_id
        self.db_factory = db_factory

    def search(self, query: str, top_k: int = 10, filters: Optional[dict] = None) -> List[dict]:
        keywords = self._extract_keywords(query)
        if not keywords:
            return []

        with self.db_factory() as db:
            conditions = [SummaryChunk.content.like(f"%{keyword}%") for keyword in keywords]
            db_query = db.query(SummaryChunk).filter(SummaryChunk.index_id == self.index_id)
            if conditions:
                db_query = db_query.filter(or_(*conditions))

            allowed_file_ids = (filters or {}).get("file_ids") or (filters or {}).get("allowed_file_ids")
            if allowed_file_ids:
                db_query = db_query.filter(SummaryChunk.file_id.in_(allowed_file_ids))

            chunks = db_query.limit(max(top_k * 4, 20)).all()

        results = []
        for chunk in chunks:
            content = chunk.content or ""
            hits = Counter(keyword for keyword in keywords if keyword in content)
            if not hits:
                continue
            try:
                metadata = json.loads(chunk.metadata_json) if chunk.metadata_json else {}
            except json.JSONDecodeError:
                metadata = {}
            score = sum(hits.values()) / max(len(keywords), 1)
            results.append(
                {
                    "chunk_id": chunk.id,
                    "content": content,
                    "score": round(float(score), 6),
                    "metadata": metadata,
                }
            )

        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:top_k]

    def _extract_keywords(self, query: str) -> List[str]:
        cleaned = (query or "").strip().lower()
        if not cleaned:
            return []

        keywords = set(re.findall(r"[a-z0-9_]{2,}", cleaned))
        for part in re.findall(r"[\u4e00-\u9fff]{2,}", cleaned):
            keywords.add(part)
            keywords.update(part[i : i + 2] for i in range(max(len(part) - 1, 1)))
            keywords.update(part[i : i + 3] for i in range(max(len(part) - 2, 1)))

        stop_words = {"我们", "公司", "一下", "关于", "可以", "相关", "有没有", "哪些", "什么"}
        return [word for word in keywords if word and word not in stop_words][:12]
