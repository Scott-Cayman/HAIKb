from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator, UserDefinedType


class AwareDateTime(TypeDecorator):
    """Normalize legacy naive timestamps to timezone-aware UTC values."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class Vector1024(UserDefinedType):
    """Minimal pgvector type used by ORM metadata without another runtime dependency."""

    cache_ok = True

    def get_col_spec(self, **_kw):
        return "vector(1024)"
