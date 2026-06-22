"""
添加 user_file_views 表的迁移脚本
"""

from app.database import Base, engine
from app.models.user_file_view import UserFileView  # noqa: F401


def migrate():
    print("正在创建 user_file_views 表...")
    # 这会创建所有不存在的表
    Base.metadata.create_all(bind=engine, checkfirst=True)
    print("迁移完成！")


if __name__ == "__main__":
    migrate()
