from __future__ import annotations

import hashlib
import json
import math
import re
import os
from pathlib import Path
from typing import Dict, List, Optional

from app.config import settings


class VectorStoreAdapter:
    """本地 JSON 持久化向量库。

    这里不依赖外部服务，先保证项目能够离线跑通。
    向量使用哈希词袋近似实现，足够支撑 MVP 的 summary 检索。
    """

    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self.persist_path = Path(settings.RAG_VECTOR_DIR) / f"{collection_name}.json"
        self.persist_path.parent.mkdir(parents=True, exist_ok=True)

    def add_text(self, id: str, text: str, metadata: dict) -> str:
        entries = self._load_entries()
        vector = self._embed_text(text)
        entries = [entry for entry in entries if entry["id"] != id]
        entries.append({"id": id, "text": text, "metadata": metadata, "vector": vector})
        self._save_entries(entries)
        return id

    def search(self, query: str, top_k: int = 10, filters: Optional[dict] = None) -> List[dict]:
        query_vector = self._embed_text(query)
        if not query_vector:
            return []

        results = []
        for entry in self._load_entries():
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
        entries = [entry for entry in self._load_entries() if entry["id"] not in id_set]
        self._save_entries(entries)

    def drop_collection(self) -> None:
        if self.persist_path.exists():
            self.persist_path.unlink()

    def _load_entries(self) -> List[dict]:
        if not self.persist_path.exists():
            return []
        try:
            with open(self.persist_path, 'rb') as f:
                content = f.read()
            return json.loads(content.decode('utf-8', errors='replace'))
        except json.JSONDecodeError:
            return []

    def _save_entries(self, entries: List[dict]) -> None:
        temp_path = f"{self.persist_path}.tmp"
        try:
            with open(temp_path, 'wb') as f:
                f.write(json.dumps(entries, ensure_ascii=False).encode('utf-8'))
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
        english_tokens = re.findall(r"[a-z0-9_]+", cleaned)
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
