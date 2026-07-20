#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.rag_index import SummaryChunk
from app.rag.keyword_store import KeywordStore
from app.rag.pgvector_store import PgVectorStoreAdapter
from app.rag.vector_store_optimized import VectorStoreAdapter


def main() -> int:
    query = '怎么进行项目报销'
    keyword_store = KeywordStore(index_id=1, db_factory=SessionLocal)
    keyword_results = keyword_store.search(query, top_k=20)

    assert keyword_store.search(query, top_k=10, filters={'file_ids': []}) == []
    assert PgVectorStoreAdapter(index_id=1).search(query, top_k=10, filters={'file_ids': []}) == []
    assert VectorStoreAdapter(collection_name='summary_index_1').search(
        query,
        top_k=10,
        filters={'file_ids': []},
    ) == []

    chunk_ids = [item['chunk_id'] for item in keyword_results]
    with SessionLocal() as db:
        rows = (
            db.query(SummaryChunk.id, SummaryChunk.file_id, SummaryChunk.content)
            .filter(SummaryChunk.id.in_(chunk_ids))
            .all()
        )
    chunk_map = {row.id: row for row in rows}

    print('permission_empty_filters=PASS')
    print(f'keyword_results={len(keyword_results)}')
    for item in keyword_results[:10]:
        chunk = chunk_map[item['chunk_id']]
        preview = (chunk.content or '').replace('\n', ' ')[:120]
        print(f"chunk={chunk.id} file={chunk.file_id} score={item['score']:.6f} {preview}")

    if not any(chunk_map[item['chunk_id']].file_id == 450 for item in keyword_results):
        raise RuntimeError('Expected reimbursement reference file 450 was not recalled.')
    print('reimbursement_file_450=PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
