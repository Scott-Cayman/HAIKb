from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings


DATABASE_URL = settings.effective_database_url

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args={'application_name': 'haikb-api'},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def verify_database_connection() -> None:
    """Fail fast when PostgreSQL is unavailable or the wrong database is selected."""
    with engine.connect() as connection:
        backend = connection.execute(text("select current_setting('server_version')")).scalar_one()
        if not backend:
            raise RuntimeError('PostgreSQL connection verification failed.')


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
