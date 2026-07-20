from __future__ import annotations

import json
import re
from collections import Counter
from typing import List, Optional

from sqlalchemy import case, func, or_

from app.models.file import File
from app.models.folder import Folder
from app.models.rag_index import SummaryChunk


class KeywordStore:
    """PostgreSQL lexical retrieval used as the stable hybrid-search fallback."""

    def __init__(self, index_id: int, db_factory):
        self.index_id = index_id
        self.db_factory = db_factory

    def search(self, query: str, top_k: int = 10, filters: Optional[dict] = None) -> List[dict]:
        keywords = self._extract_keywords(query)
        if not keywords:
            return []

        filters = filters or {}
        file_filter_supplied = "file_ids" in filters or "allowed_file_ids" in filters
        allowed_file_ids = filters.get("file_ids")
        if allowed_file_ids is None:
            allowed_file_ids = filters.get("allowed_file_ids")
        if file_filter_supplied and not allowed_file_ids:
            return []

        with self.db_factory() as db:
            lowered_content = func.lower(SummaryChunk.content)
            lowered_name = func.lower(File.original_name)
            conditions = [
                or_(lowered_content.contains(keyword), lowered_name.contains(keyword))
                for keyword in keywords
            ]
            hit_expressions = [
                case((lowered_name.contains(keyword), 3), else_=0)
                + case((lowered_content.contains(keyword), 1), else_=0)
                for keyword in keywords
            ]
            hit_count = hit_expressions[0]
            for expression in hit_expressions[1:]:
                hit_count = hit_count + expression

            db_query = (
                db.query(SummaryChunk, File.original_name, hit_count.label("hit_count"))
                .join(File, File.id == SummaryChunk.file_id)
                .outerjoin(Folder, Folder.id == File.folder_id)
                .filter(
                    SummaryChunk.index_id == self.index_id,
                    File.is_deleted == False,
                    or_(File.folder_id == None, Folder.is_deleted == False),
                )
            )
            if conditions:
                db_query = db_query.filter(or_(*conditions))

            if allowed_file_ids is not None:
                db_query = db_query.filter(SummaryChunk.file_id.in_(allowed_file_ids))

            rows = db_query.order_by(hit_count.desc(), SummaryChunk.id.asc()).limit(max(top_k * 12, 100)).all()

        results = []
        keyword_weights = {keyword: min(max(len(keyword), 1), 6) for keyword in keywords}
        max_score = sum(keyword_weights.values()) or 1
        for chunk, original_name, _ in rows:
            content = chunk.content or ""
            lowered = content.lower()
            lowered_original_name = (original_name or "").lower()
            content_hits = Counter(keyword for keyword in keywords if keyword in lowered)
            name_hits = Counter(keyword for keyword in keywords if keyword in lowered_original_name)
            if not content_hits and not name_hits:
                continue
            try:
                metadata = json.loads(chunk.metadata_json) if chunk.metadata_json else {}
            except json.JSONDecodeError:
                metadata = {}
            content_score = sum(keyword_weights[keyword] for keyword in content_hits)
            name_score = sum(keyword_weights[keyword] for keyword in name_hits)
            score = min((content_score + (name_score * 3)) / max_score, 1.0)
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
        synonym_groups = (
            {"报销", "报账", "费用申请", "费用审批", "oa审批", "票据"},
            {"入职", "新人", "新员工", "岗前培训"},
            {"芯片", "半导体", "集成电路", "ic"},
        )
        for group in synonym_groups:
            if any(term in cleaned for term in group):
                keywords.update(group)

        return sorted(
            [word for word in keywords if word and word not in stop_words],
            key=lambda word: (-len(word), word),
        )[:20]
