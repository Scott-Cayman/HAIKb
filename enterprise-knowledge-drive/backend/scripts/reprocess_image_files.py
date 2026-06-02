#!/usr/bin/env python3
"""使用视觉 LLM 重新处理图片文件生成 AI 总结。"""

import sys
import time
from pathlib import Path
from typing import List

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
from app.services.summary_index_service import summary_index_service


def get_missing_image_files() -> List[int]:
    """获取缺少总结的图片文件 ID。"""
    db = SessionLocal()
    try:
        all_files = db.query(File).filter(File.is_deleted == False).all()
        summarised_file_ids = {s.file_id for s in db.query(DocumentSummary).filter(DocumentSummary.is_deleted == False).all()}
        
        image_extensions = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}
        missing = []
        for f in all_files:
            ext = (f.file_ext or '').lower()
            if ext in image_extensions and f.id not in summarised_file_ids:
                missing.append(f.id)
        
        return sorted(missing)
    finally:
        db.close()


def main():
    print("\n" + "=" * 80)
    print("  使用视觉 LLM 重新处理图片文件")
    print("=" * 80 + "\n")

    file_ids = get_missing_image_files()
    
    print(f"找到 {len(file_ids)} 个缺少总结的图片文件")
    print(f"文件 ID: {file_ids}\n")
    
    if not file_ids:
        print("没有需要处理的文件")
        return

    success_count = 0
    failed_count = 0
    
    for i, file_id in enumerate(file_ids, 1):
        print(f"\n[{i}/{len(file_ids)}] 处理文件 ID: {file_id}")
        print("-" * 60)
        
        try:
            result = summary_index_service.summarize_file(file_id=file_id, reindex=True)
            print(f"✅ 成功! 结果: {result}")
            success_count += 1
        except Exception as e:
            print(f"❌ 失败! 错误: {str(e)}")
            import traceback
            traceback.print_exc()
            failed_count += 1
        
        # 稍微延迟一下，避免过快请求
        time.sleep(0.5)
    
    print("\n" + "=" * 80)
    print("  处理完成!")
    print("=" * 80)
    print(f"  总数: {len(file_ids)}")
    print(f"  成功: {success_count}")
    print(f"  失败: {failed_count}")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
