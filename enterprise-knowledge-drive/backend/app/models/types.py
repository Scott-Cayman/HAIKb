from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class AwareDateTime(TypeDecorator):
    """让 SQLite 的 naive UTC 时间自动带上 UTC 时区信息。

    SQLite 的 CURRENT_TIMESTAMP 始终返回 UTC，但 Python 读取时
    得到的是 naive datetime（无时区）。此类型在读取时自动附加
    UTC 时区，使 FastAPI/Pydantic 序列化出带时区的 ISO 字符串
    （如 2026-07-03T02:39:39+00:00），前端 new Date() 即可正确
    解析为本地时间。
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
