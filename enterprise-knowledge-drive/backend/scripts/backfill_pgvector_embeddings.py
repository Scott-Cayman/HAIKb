#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

from sqlalchemy import or_, text


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import settings
from app.database import SessionLocal
from app.models.file import File
from app.models.folder import Folder
from app.models.rag_index import SummaryChunk
from app.rag.pgvector_store import PgVectorStoreAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Backfill semantic embeddings into PostgreSQL pgvector.')
    parser.add_argument('--index-id', type=int, default=1)
    parser.add_argument('--batch-size', type=int, default=settings.EMBEDDING_BATCH_SIZE)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--dry-run', action='store_true')
    return parser.parse_args()


def load_existing(index_id: int) -> dict[str, tuple[str, str, int]]:
    with SessionLocal() as db:
        rows = db.execute(
            text(
                """
                SELECT chunk_id, content_hash, model, dimensions
                FROM rag_chunk_embeddings
                WHERE index_id = :index_id
                """
            ),
            {'index_id': index_id},
        ).all()
    return {row[0]: (row[1], row[2], row[3]) for row in rows}


def load_active_chunks(index_id: int) -> list[SummaryChunk]:
    with SessionLocal() as db:
        return (
            db.query(SummaryChunk)
            .join(File, File.id == SummaryChunk.file_id)
            .outerjoin(Folder, Folder.id == File.folder_id)
            .filter(
                SummaryChunk.index_id == index_id,
                File.is_deleted == False,
                or_(File.folder_id == None, Folder.is_deleted == False),
            )
            .order_by(SummaryChunk.file_id.asc(), SummaryChunk.chunk_index.asc())
            .all()
        )


def main() -> int:
    args = parse_args()
    if args.batch_size < 1:
        raise SystemExit('--batch-size must be at least 1')

    existing = load_existing(args.index_id)
    pending: list[SummaryChunk] = []
    for chunk in load_active_chunks(args.index_id):
        digest = hashlib.sha256((chunk.content or '').encode('utf-8')).hexdigest()
        current = existing.get(chunk.id)
        if current == (digest, settings.EMBEDDING_MODEL, settings.EMBEDDING_DIMENSIONS):
            continue
        pending.append(chunk)

    if args.limit > 0:
        pending = pending[: args.limit]

    print(
        f'index={args.index_id} model={settings.EMBEDDING_MODEL} '
        f'dimensions={settings.EMBEDDING_DIMENSIONS} pending={len(pending)} dry_run={args.dry_run}'
    )
    if args.dry_run or not pending:
        return 0

    store = PgVectorStoreAdapter(index_id=args.index_id)
    completed = 0
    for start in range(0, len(pending), args.batch_size):
        batch = pending[start : start + args.batch_size]
        store.add_texts(
            {
                'id': chunk.id,
                'text': chunk.content,
                'metadata': {'file_id': chunk.file_id},
            }
            for chunk in batch
        )
        completed += len(batch)
        print(f'embedded={completed}/{len(pending)}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
