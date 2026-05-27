#!/usr/bin/env python3
"""补跑历史失败、缺失或处理中断的文件总结。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import or_

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.services.document_parser import SUPPORTED_PARSE_EXTS
from app.services.summary_index_service import summary_index_service


ACTIONABLE_STATUSES = {"failed", "pending", "processing"}
DEFAULT_SKIP_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def build_candidate_query(db, skip_extensions):
    allowed_extensions = sorted(set(SUPPORTED_PARSE_EXTS) - set(skip_extensions))
    return (
        db.query(File.id, File.original_name, File.file_ext, File.summary_status)
        .outerjoin(DocumentSummary, DocumentSummary.file_id == File.id)
        .filter(File.is_deleted == False)
        .filter(File.file_ext.in_(allowed_extensions))
        .filter(
            or_(
                File.summary_status.in_(ACTIONABLE_STATUSES),
                DocumentSummary.id == None,
            )
        )
        .order_by(File.id.asc())
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="补跑历史失败或缺失的文件总结")
    parser.add_argument("--limit", type=int, default=50, help="最多处理多少个文件，默认 50")
    parser.add_argument("--dry-run", action="store_true", help="只打印待处理文件，不实际执行")
    parser.add_argument("--file-id", type=int, action="append", dest="file_ids", help="仅处理指定 file_id，可重复传入")
    parser.add_argument("--include-images", action="store_true", help="包含图片文件；需要环境已安装 pytesseract")
    args = parser.parse_args()

    skip_extensions = set(DEFAULT_SKIP_EXTENSIONS)
    if args.include_images:
        skip_extensions -= {".jpg", ".jpeg", ".png", ".webp", ".gif"}

    with SessionLocal() as db:
        query = build_candidate_query(db, skip_extensions)
        if args.file_ids:
            query = query.filter(File.id.in_(args.file_ids))
        candidates = query.limit(max(args.limit, 1)).all()

    print("=" * 80)
    print("历史总结补跑工具")
    print("=" * 80)
    print(f"候选文件数: {len(candidates)}")

    if not candidates:
        print("没有可处理的文件。")
        return

    for row in candidates:
        print(f"- file_id={row.id} | status={row.summary_status} | ext={row.file_ext} | name={row.original_name}")

    if args.dry_run:
        print("\n当前为 dry-run，未执行实际补跑。")
        return

    success_count = 0
    failed_count = 0

    for row in candidates:
        print(f"\n[处理中] file_id={row.id} | {row.original_name}")
        try:
            result = summary_index_service.summarize_file(file_id=row.id, reindex=True)
            print(f"  ✓ 成功: {result}")
            success_count += 1
        except Exception as exc:
            print(f"  ✗ 失败: {exc}")
            failed_count += 1

    print("\n" + "=" * 80)
    print(f"补跑完成: 成功 {success_count}，失败 {failed_count}")
    print("=" * 80)


if __name__ == "__main__":
    main()
