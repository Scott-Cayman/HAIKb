#!/usr/bin/env python3
"""批量重新生成所有使用规则生成的总结。"""

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


# 需要重新生成的文件 ID 列表（来自之前的检查）
FILE_IDS_TO_REBUILD = [
    331, 329, 245, 496, 497, 28, 19, 20, 27, 23, 29, 30, 34, 35, 
    252, 276, 278, 297, 318, 215, 225, 227, 338, 377, 213, 383, 
    450, 217, 336, 220, 221, 223, 229, 339, 255, 233, 340, 251, 
    234, 235, 410, 238, 347, 411, 414, 267, 413, 415, 271, 416, 
    343, 274, 344, 346, 422, 281, 280, 283, 436, 282, 285, 349, 
    351, 434, 287, 372, 296, 353, 298, 304, 310, 305, 306, 309, 
    313, 325, 367, 326, 373, 376, 400, 403, 406, 392, 404, 401, 
    402, 405, 409, 417, 426, 429, 430, 428, 431, 435, 224
]


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


def rebuild_summaries(file_ids, batch_size=5, delay=2):
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
    current_rule_ids = get_rule_based_summaries()
    print(f"  当前有 {len(current_rule_ids)} 个使用规则生成的总结")
    
    # 使用数据库中实际找到的列表，或者使用预定义列表
    file_ids = current_rule_ids if current_rule_ids else FILE_IDS_TO_REBUILD
    
    if not file_ids:
        print("✅ 没有需要重新生成的总结")
        return 0
    
    print(f"  准备处理 {len(file_ids)} 个文件")
    
    # 询问是否继续
    print("\n是否继续? (y/n)")
    try:
        answer = input().strip().lower()
        if answer not in ["y", "yes", ""]:
            print("已取消")
            return 0
    except EOFError:
        # 如果是在非交互式环境，直接继续
        pass
    
    return rebuild_summaries(file_ids, batch_size=5, delay=1)[0]


if __name__ == "__main__":
    sys.exit(main())
