from __future__ import annotations

import hashlib
import json
from typing import Dict, Iterable, List, Optional

from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.services.embedding_service import embedding_service


def _vector_literal(vector: List[float]) -> str:
    return '[' + ','.join(f'{value:.9g}' for value in vector) + ']'


class PgVectorStoreAdapter:
    """PostgreSQL pgvector store used by the summary retrieval pipeline."""

    def __init__(self, index_id: int):
        self.index_id = index_id

    def add_text(self, id: str, text: str, metadata: dict) -> str:
        self.add_texts([{'id': id, 'text': text, 'metadata': metadata}])
        return id

    def add_texts(self, records: Iterable[dict]) -> List[str]:
        rows = list(records)
        if not rows:
            return []
        vectors = embedding_service.embed_documents(row['text'] for row in rows)

        statement = text(
            """
            INSERT INTO rag_chunk_embeddings (
                chunk_id, index_id, file_id, model, dimensions, content_hash, embedding, updated_at
            ) VALUES (
                :chunk_id, :index_id, :file_id, :model, :dimensions, :content_hash,
                CAST(:embedding AS vector), now()
            )
            ON CONFLICT (chunk_id) DO UPDATE SET
                index_id = EXCLUDED.index_id,
                file_id = EXCLUDED.file_id,
                model = EXCLUDED.model,
                dimensions = EXCLUDED.dimensions,
                content_hash = EXCLUDED.content_hash,
                embedding = EXCLUDED.embedding,
                updated_at = now()
            """
        )

        with SessionLocal.begin() as db:
            for row, vector in zip(rows, vectors):
                metadata = row.get('metadata') or {}
                file_id = metadata.get('file_id')
                if file_id is None:
                    raise ValueError(f'Embedding row {row["id"]} is missing file_id metadata.')
                db.execute(
                    statement,
                    {
                        'chunk_id': row['id'],
                        'index_id': self.index_id,
                        'file_id': int(file_id),
                        'model': settings.EMBEDDING_MODEL,
                        'dimensions': settings.EMBEDDING_DIMENSIONS,
                        'content_hash': hashlib.sha256(row['text'].encode('utf-8')).hexdigest(),
                        'embedding': _vector_literal(vector),
                    },
                )
        return [row['id'] for row in rows]

    def search(self, query: str, top_k: int = 10, filters: Optional[dict] = None) -> List[dict]:
        filters = filters or {}
        filter_was_supplied = 'file_ids' in filters or 'allowed_file_ids' in filters
        allowed_file_ids = filters.get('file_ids')
        if allowed_file_ids is None:
            allowed_file_ids = filters.get('allowed_file_ids')
        if filter_was_supplied and not allowed_file_ids:
            return []

        query_vector = embedding_service.embed_query(query)
        if not query_vector:
            return []

        conditions = [
            'e.index_id = :index_id',
            'f.is_deleted = false',
            '(f.folder_id IS NULL OR fo.is_deleted = false)',
        ]
        params: Dict[str, object] = {
            'index_id': self.index_id,
            'embedding': _vector_literal(query_vector),
            'top_k': top_k,
        }
        if allowed_file_ids is not None:
            conditions.append('e.file_id = ANY(:allowed_file_ids)')
            params['allowed_file_ids'] = [int(file_id) for file_id in allowed_file_ids]

        statement = text(
            f"""
            SELECT e.chunk_id, e.file_id,
                   1 - (e.embedding <=> CAST(:embedding AS vector)) AS score
            FROM rag_chunk_embeddings AS e
            JOIN files AS f ON f.id = e.file_id
            LEFT JOIN folders AS fo ON fo.id = f.folder_id
            WHERE {' AND '.join(conditions)}
            ORDER BY e.embedding <=> CAST(:embedding AS vector)
            LIMIT :top_k
            """
        )
        with SessionLocal() as db:
            rows = db.execute(statement, params).mappings().all()
        return [
            {
                'chunk_id': row['chunk_id'],
                'score': round(float(row['score']), 6),
                'metadata': {},
            }
            for row in rows
        ]

    def delete(self, ids: List[str]) -> None:
        if not ids:
            return
        with SessionLocal.begin() as db:
            db.execute(
                text('DELETE FROM rag_chunk_embeddings WHERE index_id = :index_id AND chunk_id = ANY(:chunk_ids)'),
                {'index_id': self.index_id, 'chunk_ids': ids},
            )

    def drop_collection(self) -> None:
        with SessionLocal.begin() as db:
            db.execute(
                text('DELETE FROM rag_chunk_embeddings WHERE index_id = :index_id'),
                {'index_id': self.index_id},
            )

    def count(self) -> int:
        with SessionLocal() as db:
            return int(
                db.execute(
                    text('SELECT count(*) FROM rag_chunk_embeddings WHERE index_id = :index_id'),
                    {'index_id': self.index_id},
                ).scalar_one()
            )
