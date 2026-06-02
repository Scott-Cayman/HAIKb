#!/usr/bin/env python3
"""列出没有生成 AI 总结的文件。"""

import sys
from pathlib import Path

# 添加项目根目录
sys.path.insert(0, str(Path(__file__).parent.parent))

import logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

from app.database import SessionLocal
from app.models.file import File
from app.models.document_summary import DocumentSummary
from sqlalchemy import or_, and_


def main():
    print("\n" + "=" * 80)
    print("  查询没有生成 AI 总结的文件")
    print("=" * 80 + "\n")

    db = SessionLocal()
    try:
        # 查询所有文件
        all_files = db.query(File).filter(File.is_deleted == False).all()
        
        # 查询有总结的文件 ID
        summarised_file_ids = {s.file_id for s in db.query(DocumentSummary).filter(DocumentSummary.is_deleted == False).all()}
        
        # 找出没有总结的文件
        missing_summaries = [f for f in all_files if f.id not in summarised_file_ids]
        
        # 按类型分类
        files_by_type = {}
        for f in missing_summaries:
            ext = f.file_ext.lower() if f.file_ext else "unknown"
            if ext not in files_by_type:
                files_by_type[ext] = []
            files_by_type[ext].append(f)
        
        # 打印统计
        print(f"总文件数: {len(all_files)}")
        print(f"有总结的文件数: {len(summarised_file_ids)}")
        print(f"缺少总结的文件数: {len(missing_summaries)}")
        print("\n按文件类型统计:")
        for ext in sorted(files_by_type.keys()):
            print(f"  {ext}: {len(files_by_type[ext])} 个文件")
        
        print("\n" + "=" * 80)
        print("  缺少总结的文件详情:")
        print("=" * 80 + "\n")
        
        for ext in sorted(files_by_type.keys()):
            print(f"\n## {ext.upper()} 文件 ({len(files_by_type[ext])} 个)\n")
            for f in files_by_type[ext]:
                print(f"  [ID: {f.id}] {f.original_name}")
                print(f"    - 大小: {f.size} 字节")
                print(f"    - 路径: {f.storage_path}")
                print(f"    - 状态: summary_status={f.summary_status}")
                if f.summary_error:
                    print(f"    - 错误: {f.summary_error}")
                print()
        
        print("\n" + "=" * 80)
        print("  查询完成!")
        print("=" * 80 + "\n")
        
    finally:
        db.close()


if __name__ == "__main__":
    main()
