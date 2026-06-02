from __future__ import annotations

from typing import Iterable, List

from app.models.rag_index import SummaryChunk


class SummaryDocStore:
    """基于数据库的 summary chunk 文档仓。"""

    def __init__(self, index_id: int, db_factory):
        self.index_id = index_id
        self.db_factory = db_factory

    def get(self, chunk_ids: Iterable[str]) -> List[SummaryChunk]:
        ids = list(chunk_ids)
        if not ids:
            return []
        with self.db_factory() as db:
            return (
                db.query(SummaryChunk)
                .filter(SummaryChunk.index_id == self.index_id, SummaryChunk.id.in_(ids))
                .all()
            )

    def delete(self, chunk_ids: Iterable[str]) -> None:
        ids = list(chunk_ids)
        if not ids:
            return
        with self.db_factory() as db:
            (
                db.query(SummaryChunk)
                .filter(SummaryChunk.index_id == self.index_id, SummaryChunk.id.in_(ids))
                .delete(synchronize_session=False)
            )
            db.commit()
