#!/usr/bin/env python3
"""检查使用规则生成的总结（非 LLM 生成），需要重新生成。"""

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


def is_rule_based_summary(summary: DocumentSummary) -> bool:
    """判断是否是规则生成的总结。"""
    # 规则生成的总结特征
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
    
    # 检查 parse_confidence
    if summary.parse_confidence == "low" and "未识别" in (markdown or ""):
        return True
    
    return False


def main():
    print("\n" + "=" * 80)
    print("  检查使用规则生成总结的文件（需要重新生成）")
    print("=" * 80 + "\n")

    db = SessionLocal()
    try:
        # 查询所有有总结的文件
        summaries = db.query(DocumentSummary).filter(DocumentSummary.is_deleted == False).all()
        
        rule_based_summaries = []
        for summary in summaries:
            if is_rule_based_summary(summary):
                rule_based_summaries.append(summary)
        
        # 获取对应的文件信息
        file_ids = {s.file_id for s in rule_based_summaries}
        files = db.query(File).filter(File.id.in_(file_ids), File.is_deleted == False).all()
        file_map = {f.id: f for f in files}
        
        # 打印统计
        print(f"总总结数: {len(summaries)}")
        print(f"规则生成的总结数: {len(rule_based_summaries)}")
        
        print("\n" + "=" * 80)
        print("  需要重新生成总结的文件详情:")
        print("=" * 80 + "\n")
        
        for summary in sorted(rule_based_summaries, key=lambda s: s.file_id):
            file = file_map.get(summary.file_id)
            if not file:
                continue
            
            print(f"  [ID: {file.id}] {file.original_name}")
            print(f"    - 大小: {file.size} 字节")
            print(f"    - 类型: {file.file_ext}")
            print(f"    - 总结状态: parse_confidence={summary.parse_confidence}")
            print(f"    - 一句话判断: {summary.one_line_judgement[:50]}..." if summary.one_line_judgement else "    - 一句话判断: (无)")
            print(f"    - 两句话简介: {summary.two_sentence_intro[:80]}..." if summary.two_sentence_intro else "    - 两句话简介: (无)")
            print()
        
        # 输出可用于重新生成的 file_id 列表
        print("\n" + "=" * 80)
        print("  可用于重新生成的 File ID 列表:")
        print("=" * 80)
        print("[" + ", ".join(str(s.file_id) for s in rule_based_summaries) + "]")
        
        print("\n" + "=" * 80)
        print("  检查完成!")
        print("=" * 80 + "\n")
        
    finally:
        db.close()


if __name__ == "__main__":
    main()
