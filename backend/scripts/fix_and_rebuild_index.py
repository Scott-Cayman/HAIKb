#!/usr/bin/env python3
"""检查并删除损坏的向量文件，然后重建索引"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.rag.index_manager import index_manager
from app.config import settings


def fix_and_rebuild():
    print("=" * 80)
    print("修复 RAG 索引问题")
    print("=" * 80)
    
    vector_path = Path(settings.RAG_VECTOR_DIR) / "summary_index_1.json"
    print(f"\n[1] 检查向量文件: {vector_path}")
    
    if vector_path.exists():
        print(f"  文件存在，大小: {vector_path.stat().st_size} 字节")
        
        # 尝试备份和删除
        backup_path = f"{vector_path}.bak"
        print(f"  备份到: {backup_path}")
        try:
            os.rename(vector_path, backup_path)
            print("  备份成功！")
        except Exception as e:
            print(f"  备份失败，尝试直接删除: {e}")
            try:
                os.remove(vector_path)
                print("  删除成功！")
            except Exception as e2:
                print(f"  删除也失败了: {e2}")
                return
    else:
        print("  文件不存在")
    
    db = SessionLocal()
    
    print(f"\n[2] 清理数据库中的旧索引数据")
    from app.models.rag_index import RagSource, SummaryChunk, RagIndexRelation
    index_id = 1
    
    # 删除旧数据
    deleted_relations = db.query(RagIndexRelation).filter(RagIndexRelation.index_id == index_id).delete()
    deleted_chunks = db.query(SummaryChunk).filter(SummaryChunk.index_id == index_id).delete()
    deleted_sources = db.query(RagSource).filter(RagSource.index_id == index_id).delete()
    
    print(f"  已删除: {deleted_relations} 个关系, {deleted_chunks} 个块, {deleted_sources} 个源")
    
    # 重置所有失败的文档摘要
    failed_summaries = db.query(DocumentSummary).filter(
        DocumentSummary.index_status == "failed"
    ).all()
    
    for s in failed_summaries:
        s.index_status = "pending"
        s.index_error = None
    
    db.commit()
    print(f"  已重置 {len(failed_summaries)} 个文档摘要的索引状态")
    
    print(f"\n[3] 重建索引")
    
    # 获取需要重新索引的文档摘要
    summaries_to_index = db.query(DocumentSummary).filter(
        DocumentSummary.parse_status == "success"
    ).all()
    
    print(f"  找到 {len(summaries_to_index)} 个需要索引的文档摘要")
    
    index = index_manager.get_default_index()
    pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
    
    success_count = 0
    fail_count = 0
    
    for summary in summaries_to_index:
        try:
            pipeline.run(summary.id, reindex=False)
            success_count += 1
            print(f"  ✓ 文件 ID {summary.file_id} 索引成功")
        except Exception as e:
            fail_count += 1
            print(f"  ✗ 文件 ID {summary.file_id} 索引失败: {e}")
            summary.index_status = "failed"
            summary.index_error = str(e)
    
    db.commit()
    
    print(f"\n[4] 完成！")
    print(f"  成功: {success_count}")
    print(f"  失败: {fail_count}")
    
    db.close()
    print("\n" + "=" * 80)


if __name__ == "__main__":
    fix_and_rebuild()
