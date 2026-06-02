#!/usr/bin/env python3
"""批量重新生成所有使用规则生成的总结（非交互式版本）。"""

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


def is_rule_based_summary(summary: DocumentSummary) -> bool:
    """判断是否是规则生成的总结。"""
    if not summary.summary_markdown:
        return True
    
    markdown = summary.summary_markdown
    
    # 检查是否有规则生成的典型模式
    rule_patterns = [
        "可用于企业知识检索与项目复用判断",
        "适合用于快速判断项目背景",
        "可作为后续检索",
        "以未识别客户为主",
    ]
    
    for pattern in rule_patterns:
        if pattern in markdown:
            return True
    
    # 检查是否有大量"未识别"且内容较短
    if "未识别" in markdown and len(markdown) < 2000:
        return True
    
    if summary.parse_confidence == "low" and "未识别" in (markdown or ""):
        return True
    
    return False


def get_rule_based_summaries():
    """获取所有使用规则生成的总结的文件 ID。"""
    with SessionLocal() as db:
        summaries = db.query(DocumentSummary).filter(DocumentSummary.is_deleted == False).all()
        
        rule_based_ids = []
        for summary in summaries:
            if is_rule_based_summary(summary):
                rule_based_ids.append(summary.file_id)
        
        return sorted(rule_based_ids)


def rebuild_summaries(file_ids, batch_size=5, delay=1):
    """批量重新生成总结。"""
    print("\n" + "=" * 80)
    print(f"  开始重新生成 {len(file_ids)} 个文件的总结")
    print("=" * 80 + "\n")
    
    success_count = 0
    failed_count = 0
    failed_files = []
    skipped_count = 0
    
    for i, file_id in enumerate(file_ids, 1):
        print(f"[{i}/{len(file_ids)}] 处理文件 ID: {file_id}")
        
        try:
            # 先检查文件是否存在
            with SessionLocal() as db:
                file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
                if not file:
                    print(f"  ⚠️  文件不存在，跳过")
                    skipped_count += 1
                    continue
                
                # 检查是否已经是好的总结
                summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
                if summary and not is_rule_based_summary(summary) and summary.parse_confidence == "high":
                    print(f"  ✅ 总结已经很好，跳过")
                    skipped_count += 1
                    continue
                
                print(f"  📄 文件: {file.original_name}")
                print(f"  📝 当前状态: summary_status={file.summary_status}, parse_confidence={summary.parse_confidence if summary else 'N/A'}")
            
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
    print(f"  跳过: {skipped_count}")
    
    if failed_files:
        print("\n  失败文件列表:")
        for file_id, error in failed_files:
            print(f"    - ID: {file_id}, 错误: {error}")
    
    print("=" * 80 + "\n")
    
    return success_count, failed_count, failed_files, skipped_count


def main():
    # 先获取当前所有规则生成的总结
    print("🔍 正在检查当前数据库...")
    file_ids = get_rule_based_summaries()
    print(f"  找到 {len(file_ids)} 个使用规则生成的总结")
    
    if not file_ids:
        print("✅ 没有需要重新生成的总结")
        return 0
    
    print(f"  准备处理 {len(file_ids)} 个文件\n")
    
    success_count, failed_count, failed_files, skipped_count = rebuild_summaries(file_ids, batch_size=5, delay=1)
    
    return 0 if failed_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
