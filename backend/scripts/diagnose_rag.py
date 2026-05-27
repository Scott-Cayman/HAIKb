#!/usr/bin/env python3
"""诊断 RAG 索引问题的脚本"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.models.file import File
from app.models.document_summary import DocumentSummary
from app.models.rag_index import RagIndex, RagSource, SummaryChunk
from app.config import settings


def diagnose():
    print("=" * 80)
    print("HAIKb RAG 诊断工具")
    print("=" * 80)
    
    print(f"\n[1] 检查配置")
    print(f"  RAG 向量目录: {settings.RAG_VECTOR_DIR}")
    print(f"  数据库 URL: {settings.effective_database_url}")
    
    db = SessionLocal()
    
    print(f"\n[2] 检查最近上传的文件")
    recent_files = db.query(File).filter(File.is_deleted == False).order_by(File.created_at.desc()).limit(10).all()
    
    if not recent_files:
        print("  没有找到文件！")
    else:
        print(f"  最近 {len(recent_files)} 个文件:")
        for f in recent_files:
            print(f"    - ID: {f.id}, 名称: {f.original_name}, 摘要状态: {f.summary_status}")
    
    print(f"\n[3] 检查 RagIndex")
    indices = db.query(RagIndex).all()
    print(f"  找到 {len(indices)} 个索引:")
    for idx in indices:
        print(f"    - ID: {idx.id}, 名称: {idx.name}, 类型: {idx.index_type}, 状态: {idx.status}")
    
    if indices:
        index_id = indices[0].id
        print(f"\n[4] 检查索引 {index_id} 的数据")
        
        sources = db.query(RagSource).filter(RagSource.index_id == index_id).all()
        chunks = db.query(SummaryChunk).filter(SummaryChunk.index_id == index_id).all()
        
        print(f"  RagSource 数量: {len(sources)}")
        print(f"  SummaryChunk 数量: {len(chunks)}")
        
        if sources:
            print(f"\n  最近的 5 个 RagSource:")
            for s in sorted(sources, key=lambda x: x.created_at, reverse=True)[:5]:
                print(f"    - ID: {s.id}, 文件: {s.name}, 文件ID: {s.file_id}")
        
        if chunks:
            print(f"\n  最近的 5 个 SummaryChunk:")
            for c in sorted(chunks, key=lambda x: x.created_at, reverse=True)[:5]:
                print(f"    - ID: {c.id}, 文件ID: {c.file_id}, 内容预览: {c.content[:60] if c.content else '空'}...")
    
    print(f"\n[5] 检查 DocumentSummary")
    summaries = db.query(DocumentSummary).order_by(DocumentSummary.id.desc()).limit(10).all()
    print(f"  找到 {len(summaries)} 个文档摘要:")
    for s in summaries:
        print(f"    - ID: {s.id}, 文件ID: {s.file_id}, 索引状态: {s.index_status}")
    
    print(f"\n[6] 检查向量存储文件")
    vector_dir = Path(settings.RAG_VECTOR_DIR)
    if vector_dir.exists():
        vector_files = list(vector_dir.glob("*.json"))
        print(f"  找到 {len(vector_files)} 个向量文件:")
        for vf in vector_files:
            stat = vf.stat()
            print(f"    - {vf.name}, 大小: {stat.st_size} 字节, 修改时间: {stat.st_mtime}")
            
            if vf.stat().st_size > 0:
                try:
                    with open(vf, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    print(f"      包含 {len(data)} 条向量记录")
                except Exception as e:
                    print(f"      读取失败: {e}")
    else:
        print(f"  向量目录不存在: {vector_dir}")
    
    print("\n" + "=" * 80)
    print("诊断完成")
    print("=" * 80)
    
    db.close()


if __name__ == "__main__":
    diagnose()
