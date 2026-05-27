from __future__ import annotations

import hashlib
import json
import math
import os
import re
from pathlib import Path
from threading import Lock
from typing import Dict, List, Optional

from app.config import settings


class CachedVectorStoreAdapter:
    """带内存缓存的向量存储，提升性能。"""

    _cache_lock = Lock()
    _instances: Dict[str, "CachedVectorStoreAdapter"] = {}

    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self.persist_path = Path(settings.RAG_VECTOR_DIR) / f"{collection_name}.json"
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)

        self._cache_lock = Lock()
        self._entries_cache: Optional[List[dict]] = None
        self._cache_mtime: Optional[float] = None

    def add_text(self, id: str, text: str, metadata: dict) -> str:
        with self._cache_lock:
            entries = self._load_entries_with_cache()
            vector = self._embed_text(text)
            entries = [entry for entry in entries if entry["id"] != id]
            entries.append({"id": id, "text": text, "metadata": metadata, "vector": vector})
            self._save_entries(entries)
            self._entries_cache = None  # 失效缓存
            return id

    def search(self, query: str, top_k: int = 10, filters: Optional[dict] = None) -> List[dict]:
        query_vector = self._embed_text(query)
        if not query_vector:
            return []

        results = []
        for entry in self._load_entries_with_cache():
            if not self._matches_filters(entry.get("metadata", {}), filters):
                continue
            score = self._cosine_similarity(query_vector, entry.get("vector", {}))
            if score <= 0:
                continue
            results.append(
                {
                    "chunk_id": entry["id"],
                    "content": entry["text"],
                    "score": round(score, 6),
                    "metadata": entry.get("metadata", {}),
                }
            )

        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:top_k]

    def delete(self, ids: List[str]) -> None:
        if not ids:
            return
        id_set = set(ids)
        with self._cache_lock:
            entries = [entry for entry in self._load_entries_with_cache() if entry["id"] not in id_set]
            self._save_entries(entries)
            self._entries_cache = None  # 失效缓存

    def drop_collection(self) -> None:
        if self.persist_path.exists():
            self.persist_path.unlink()
        with self._cache_lock:
            self._entries_cache = None

    def _load_entries_with_cache(self) -> List[dict]:
        """带缓存的加载，检查文件修改时间。"""
        if not self.persist_path.exists():
            return []

        current_mtime = os.path.getmtime(self.persist_path)

        if self._entries_cache is not None and self._cache_mtime == current_mtime:
            return self._entries_cache

        try:
            with open(self.persist_path, "rb") as f:
                content = f.read()
            entries = json.loads(content.decode("utf-8", errors="replace"))
            self._entries_cache = entries
            self._cache_mtime = current_mtime
            return entries
        except json.JSONDecodeError:
            return []

    def _load_entries(self) -> List[dict]:
        if not self.persist_path.exists():
            return []
        try:
            with open(self.persist_path, "rb") as f:
                content = f.read()
            return json.loads(content.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return []

    def _save_entries(self, entries: List[dict]) -> None:
        temp_path = f"{self.persist_path}.tmp"
        try:
            with open(temp_path, "wb") as f:
                f.write(json.dumps(entries, ensure_ascii=False).encode("utf-8"))
            os.replace(temp_path, self.persist_path)
        except Exception:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            raise

    def _matches_filters(self, metadata: dict, filters: Optional[dict]) -> bool:
        if not filters:
            return True

        allowed_file_ids = filters.get("file_ids") or filters.get("allowed_file_ids")
        if allowed_file_ids and metadata.get("file_id") not in allowed_file_ids:
            return False

        summary_ids = filters.get("summary_ids")
        if summary_ids and metadata.get("summary_id") not in summary_ids:
            return False

        return True

    def _embed_text(self, text: str, dims: int = 256) -> Dict[str, float]:
        cleaned = (text or "").strip().lower()
        if not cleaned:
            return {}

        tokens = []
        english_tokens = re.findall(r"[a-z0-9_]{2,}", cleaned)
        chinese_parts = re.findall(r"[\u4e00-\u9fff]{2,}", cleaned)
        tokens.extend(english_tokens)
        for part in chinese_parts:
            tokens.append(part)
            tokens.extend(part[i : i + 2] for i in range(max(len(part) - 1, 1)))
            tokens.extend(part[i : i + 3] for i in range(max(len(part) - 2, 1)))

        if not tokens:
            tokens = [cleaned[i : i + 2] for i in range(max(len(cleaned) - 1, 1))]

        vector: Dict[str, float] = {}
        for token in tokens:
            key = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % dims
            bucket = str(key)
            vector[bucket] = vector.get(bucket, 0.0) + 1.0

        norm = math.sqrt(sum(value * value for value in vector.values())) or 1.0
        return {key: value / norm for key, value in vector.items()}

    def _cosine_similarity(self, left: Dict[str, float], right: Dict[str, float]) -> float:
        if not left or not right:
            return 0.0
        if len(left) > len(right):
            left, right = right, left
        return sum(value * right.get(key, 0.0) for key, value in left.items())


class VectorStoreAdapter(CachedVectorStoreAdapter):
    """向后兼容的名称，使用缓存版。"""
    pass

