#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from pathlib import Path

from sqlalchemy import or_


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
from app.rag.keyword_store import KeywordStore
from app.rag.pgvector_store import PgVectorStoreAdapter
from app.rag.retriever_optimized import OptimizedSummaryRetrievalPipeline
from app.services.department_scope_service import department_scope_service
from app.services.intent_router_service import intent_router_service
from app.services.resource_access import list_visible_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate permission-derived AI retrieval scope.")
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--query", default="集团请假制度是什么")
    return parser.parse_args()


def first_level_folder(folder: Folder, folder_map: dict[int, Folder], root_id: int) -> Folder:
    current = folder
    visited: set[int] = set()
    while current.parent_id and current.parent_id != root_id and current.parent_id not in visited:
        visited.add(current.parent_id)
        parent = folder_map.get(current.parent_id)
        if parent is None:
            break
        current = parent
    return current


def main() -> int:
    args = parse_args()
    with SessionLocal() as db:
        user = db.query(User).filter(User.id == args.user_id, User.is_active == True).first()
        if user is None:
            raise RuntimeError(f"Active user {args.user_id} was not found.")

        roots = db.query(Folder).filter(Folder.parent_id == None, Folder.is_deleted == False).all()
        if len(roots) != 1:
            raise RuntimeError(f"Expected one active root folder, found {len(roots)}.")
        root = roots[0]

        folders = db.query(Folder).filter(Folder.is_deleted == False).all()
        folder_map = {folder.id: folder for folder in folders}
        candidates = (
            db.query(File)
            .outerjoin(Folder, Folder.id == File.folder_id)
            .filter(File.is_deleted == False, or_(File.folder_id == None, Folder.is_deleted == False))
            .all()
        )
        visible_files = list_visible_files(db, candidates, user)
        visible_ids = sorted(file.id for file in visible_files)

        branch_counts: Counter[str] = Counter()
        for file in visible_files:
            folder = folder_map.get(file.folder_id)
            if folder is None:
                branch_counts["ROOT/UNFILED"] += 1
                continue
            branch = first_level_folder(folder, folder_map, root.id)
            branch_counts[branch.name] += 1

        override = department_scope_service.build_scoped_user(user, "酒水营销策划中心")
        if user.is_admin and not user.is_super_admin:
            assert override.department_name == user.department_name

        route = intent_router_service.route(args.query, user_id=user.id, user_context=user)
        assert route.get("should_short_circuit") is False

    pipeline = OptimizedSummaryRetrievalPipeline(
        index_id=1,
        vector_store=PgVectorStoreAdapter(index_id=1),
        doc_store=None,
        keyword_store=KeywordStore(index_id=1, db_factory=SessionLocal),
        db_factory=SessionLocal,
    )
    started = time.perf_counter()
    results = pipeline.run(
        args.query,
        top_k=12,
        retrieval_mode="hybrid",
        filters={"file_ids": visible_ids},
    )
    elapsed = time.perf_counter() - started
    leaked = sorted({item["file_id"] for item in results} - set(visible_ids))
    if leaked:
        raise RuntimeError(f"AI retrieval leaked inaccessible files: {leaked}")

    print(f"user={user.id}:{user.name} department={user.full_department_path or user.department_name}")
    print(f"root={root.id}:{root.name} visible_files={len(visible_ids)}")
    print("branches=" + ", ".join(f"{name}:{count}" for name, count in branch_counts.most_common()))
    print(f"route={route.get('route_mode')} short_circuit={route.get('should_short_circuit')}")
    print(f"retrieval_elapsed={elapsed:.3f}s result_file_ids={[item['file_id'] for item in results]}")
    print("permission_scope=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
