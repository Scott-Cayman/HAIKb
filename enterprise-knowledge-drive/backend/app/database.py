from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from app.config import settings


def _ensure_sqlite_path(database_url: str) -> None:
    if not database_url.startswith('sqlite:///'):
        return

    db_path = database_url.replace('sqlite:///', '', 1)
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_path(settings.effective_database_url)

engine = create_engine(
    settings.effective_database_url,
    connect_args={'check_same_thread': False} if settings.effective_database_url.startswith('sqlite') else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
