#!/usr/bin/env python3
"""
添加数据库索引以提升查询性能。
"""
import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import Index, text
from app.database import engine, Base, SessionLocal
from app.models.rag_index import SummaryChunk, RagSource, RagIndexRelation
from app.models.file import File
from app.models.folder import Folder
from app.models.agent_message import AgentMessage


def create_indexes():
    """创建必要的数据库索引。"""
    print("正在创建数据库索引...")

    # SummaryChunk 表的索引
    indexes = [
        Index("idx_summary_chunk_index_id", SummaryChunk.index_id),
        Index("idx_summary_chunk_file_id", SummaryChunk.file_id),
        Index("idx_summary_chunk_summary_id", SummaryChunk.summary_id),
        Index("idx_summary_chunk_index_file", SummaryChunk.index_id, SummaryChunk.file_id),
        # RagSource 表的索引
        Index("idx_rag_source_index_id", RagSource.index_id),
        Index("idx_rag_source_file_id", RagSource.file_id),
        Index("idx_rag_source_summary_id", RagSource.summary_id),
        # RagIndexRelation 表的索引
        Index("idx_rag_relation_index_id", RagIndexRelation.index_id),
        Index("idx_rag_relation_source_id", RagIndexRelation.source_id),
        # File 表的索引
        Index("idx_file_folder_id", File.folder_id),
        Index("idx_file_is_deleted", File.is_deleted),
        Index("idx_file_folder_deleted", File.folder_id, File.is_deleted),
        # Folder 表的索引
        Index("idx_folder_parent_id", Folder.parent_id),
        Index("idx_folder_is_deleted", Folder.is_deleted),
        # AgentMessage 表的索引
        Index("idx_agent_message_conv_id", AgentMessage.conversation_id),
        Index("idx_agent_message_user_id", AgentMessage.user_id),
    ]

    with engine.connect() as conn:
        for index in indexes:
            try:
                index.create(conn, checkfirst=True)
                print(f"  ✓ 创建索引: {index.name}")
            except Exception as e:
                print(f"  ✗ 索引 {index.name} 创建失败: {e}")

        conn.commit()

    print("\n索引创建完成！")


def analyze_database():
    """分析数据库以帮助查询优化器。"""
    print("\n正在分析数据库...")
    try:
        with engine.connect() as conn:
            if "sqlite" in str(engine.url):
                conn.execute(text("ANALYZE"))
            else:
                conn.execute(text("ANALYZE"))
            conn.commit()
        print("数据库分析完成！")
    except Exception as e:
        print(f"数据库分析失败: {e}")


if __name__ == "__main__":
    create_indexes()
    analyze_database()

