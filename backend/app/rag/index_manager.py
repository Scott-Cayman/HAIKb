from __future__ import annotations

import json
from typing import Dict, Optional, Type

from app.database import SessionLocal
from app.models.rag_index import RagIndex
from app.rag.base_index import BaseIndex
from app.rag.summary_file_index import SummaryFileIndex


class IndexManager:
    """管理 HAIKb 的 summary index 生命周期。"""

    def __init__(self):
        self.indices: Dict[int, BaseIndex] = {}
        self.index_types: Dict[str, Type[BaseIndex]] = {
            "summary_file_index": SummaryFileIndex,
        }

    def build_index(self, name: str, config: dict, index_type: str = "summary_file_index") -> BaseIndex:
        if index_type not in self.index_types:
            raise ValueError(f"不支持的索引类型: {index_type}")

        with SessionLocal() as db:
            record = RagIndex(
                name=name,
                index_type=index_type,
                config_json=json.dumps(config or {}, ensure_ascii=False),
                status="active",
            )
            db.add(record)
            db.commit()
            db.refresh(record)

        index = self.start_index(record)
        index.on_create()
        return index

    def start_index(self, index_record: RagIndex) -> BaseIndex:
        if index_record.id in self.indices:
            return self.indices[index_record.id]

        index_cls = self.index_types.get(index_record.index_type)
        if not index_cls:
            raise ValueError(f"未知索引类型: {index_record.index_type}")

        config = json.loads(index_record.config_json) if index_record.config_json else {}
        index = index_cls(id=index_record.id, name=index_record.name, config=config)
        index.on_start()
        self.indices[index_record.id] = index
        return index

    def delete_index(self, index_id: int) -> None:
        index = self.indices.pop(index_id, None)
        with SessionLocal() as db:
            record = db.query(RagIndex).filter(RagIndex.id == index_id).first()
            if record:
                db.delete(record)
                db.commit()
        if index:
            index.on_delete()

    def ensure_default_index(self) -> RagIndex:
        with SessionLocal() as db:
            record = db.query(RagIndex).filter(RagIndex.status == "active").order_by(RagIndex.id.asc()).first()
            if record:
                return record

            record = RagIndex(
                name="HAIKb Summary RAG Index",
                index_type="summary_file_index",
                config_json=json.dumps({"retrieval_mode": "hybrid"}, ensure_ascii=False),
                status="active",
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            return record

    def on_application_startup(self) -> None:
        self.indices = {}
        self.start_index(self.ensure_default_index())
        with SessionLocal() as db:
            records = db.query(RagIndex).filter(RagIndex.status == "active").all()
            for record in records:
                self.start_index(record)

    def get_default_index(self) -> Optional[BaseIndex]:
        if self.indices:
            first_key = sorted(self.indices.keys())[0]
            return self.indices[first_key]

        record = self.ensure_default_index()
        return self.start_index(record)


index_manager = IndexManager()
