#!/usr/bin/env python3
"""查看索引失败的错误信息"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.document_summary import DocumentSummary


def check_index_errors():
    db = SessionLocal()
    
    print("=" * 80)
    print("检查索引失败的详细错误")
    print("=" * 80)
    
    failed_summaries = db.query(DocumentSummary).filter(
        DocumentSummary.index_status == "failed"
    ).order_by(DocumentSummary.id.desc()).limit(20).all()
    
    print(f"\n找到 {len(failed_summaries)} 个索引失败的文档摘要")
    
    for s in failed_summaries:
        print(f"\n文档摘要 ID: {s.id}")
        print(f"  文件 ID: {s.file_id}")
        print(f"  索引状态: {s.index_status}")
        print(f"  索引错误: {s.index_error}")
        print(f"  解析状态: {s.parse_status}")
        print(f"  解析错误: {s.parse_error}")
    
    db.close()
    print("\n" + "=" * 80)


if __name__ == "__main__":
    check_index_errors()
