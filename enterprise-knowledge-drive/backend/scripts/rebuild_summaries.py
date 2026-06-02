#!/usr/bin/env python3
"""批量重新生成文件的 AI 总结。"""

import sys
import time
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
from app.services.summary_index_service import summary_index_service


def rebuild_summaries(file_ids, batch_size=5, delay=2):
    """批量重新生成总结。"""
    print("\n" + "=" * 80)
    print(f"  开始重新生成 {len(file_ids)} 个文件的总结")
    print("=" * 80 + "\n")
    
    success_count = 0
    failed_count = 0
    failed_files = []
    
    for i, file_id in enumerate(file_ids, 1):
        print(f"[{i}/{len(file_ids)}] 处理文件 ID: {file_id}")
        
        try:
            # 先检查文件是否存在
            with SessionLocal() as db:
                file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
                if not file:
                    print(f"  ⚠️  文件不存在，跳过")
                    failed_count += 1
                    failed_files.append((file_id, "文件不存在"))
                    continue
                
                print(f"  📄 文件: {file.original_name}")
                print(f"  📝 当前状态: summary_status={file.summary_status}")
            
            # 重新生成总结
            print(f"  🔄 正在重新生成总结...")
            summary_index_service.summarize_file(file_id=file_id, reindex=True)
            
            # 验证结果
            with SessionLocal() as db:
                file = db.query(File).filter(File.id == file_id).first()
                summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
                
                if file and file.summary_status == "success" and summary:
                    print(f"  ✅ 成功! parse_confidence={summary.parse_confidence}")
                    success_count += 1
                else:
                    print(f"  ❌ 失败! summary_status={file.summary_status if file else 'N/A'}")
                    failed_count += 1
                    failed_files.append((file_id, f"summary_status={file.summary_status if file else 'N/A'}"))
            
        except Exception as exc:
            print(f"  ❌ 错误: {exc}")
            failed_count += 1
            failed_files.append((file_id, str(exc)))
        
        print()
        
        # 批量延迟，避免过载
        if i % batch_size == 0 and i < len(file_ids):
            print(f"⏳ 等待 {delay} 秒后继续...")
            time.sleep(delay)
    
    # 打印总结
    print("\n" + "=" * 80)
    print("  重新生成完成")
    print("=" * 80)
    print(f"  总数: {len(file_ids)}")
    print(f"  成功: {success_count}")
    print(f"  失败: {failed_count}")
    
    if failed_files:
        print("\n  失败文件列表:")
        for file_id, error in failed_files:
            print(f"    - ID: {file_id}, 错误: {error}")
    
    print("=" * 80 + "\n")
    
    return success_count, failed_count, failed_files


def main():
    # 从命令行参数获取 file_ids，或者使用默认列表
    if len(sys.argv) > 1:
        try:
            file_ids = [int(arg) for arg in sys.argv[1:] if arg.strip()]
        except ValueError:
            print("❌ 请提供有效的文件 ID 数字列表")
            return 1
    else:
        # 默认：先处理 pending 的 txt 文件，再处理一些规则生成的
        file_ids = [468]  # 先处理那个 pending 的 txt 文件
    
    if not file_ids:
        print("❌ 没有需要处理的文件")
        return 1
    
    return rebuild_summaries(file_ids)


if __name__ == "__main__":
    sys.exit(main())
