#!/usr/bin/env python3
"""查看特定文件的总结内容。"""

import sys
from pathlib import Path

# 添加项目根目录
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.file import File
from app.models.document_summary import DocumentSummary


def check_summary(file_id):
    print("\n" + "=" * 80)
    print(f"  查看文件 ID: {file_id} 的总结")
    print("=" * 80 + "\n")
    
    with SessionLocal() as db:
        file = db.query(File).filter(File.id == file_id).first()
        summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
        
        if not file:
            print("❌ 文件不存在")
            return
        
        print(f"📄 文件名: {file.original_name}")
        print(f"📝 总结状态: {file.summary_status}")
        print()
        
        if not summary:
            print("❌ 该文件没有总结")
            return
        
        print(f"✅ 一句话判断: {summary.one_line_judgement}")
        print()
        print(f"📝 两句话简介: {summary.two_sentence_intro}")
        print()
        print(f"🏷️  客户类型: {summary.client_type}")
        print(f"🏷️  项目类型: {summary.project_type}")
        print(f"🏷️  文档类型: {summary.document_type}")
        print(f"🎯 置信度: {summary.parse_confidence}")
        print()
        print("=" * 80)
        print("  完整总结内容:")
        print("=" * 80)
        print(summary.summary_markdown)
        print("=" * 80 + "\n")


def main():
    if len(sys.argv) < 2:
        print("用法: python3 check_summary.py <file_id>")
        return 1
    
    try:
        file_id = int(sys.argv[1])
        check_summary(file_id)
        return 0
    except ValueError:
        print("请提供有效的文件 ID 数字")
        return 1


if __name__ == "__main__":
    sys.exit(main())
