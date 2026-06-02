from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, select, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite-url", required=True)
    parser.add_argument("--postgres-url", required=True)
    parser.add_argument("--truncate-first", action="store_true")
    return parser.parse_args()


def truncate_all_tables(postgres_engine) -> None:
    inspector = inspect(postgres_engine)
    table_names = inspector.get_table_names(schema="public")
    if not table_names:
        return

    quoted = ", ".join([f'"public"."{name}"' for name in table_names])
    with postgres_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE"))


def reset_serial_sequences(postgres_engine) -> None:
    inspector = inspect(postgres_engine)
    for table_name in inspector.get_table_names(schema="public"):
        pk = inspector.get_pk_constraint(table_name, schema="public") or {}
        pk_cols = pk.get("constrained_columns") or []
        if pk_cols != ["id"]:
            continue

        columns = {col["name"]: col for col in inspector.get_columns(table_name, schema="public")}
        id_col = columns.get("id")
        if not id_col:
            continue

        if str(id_col.get("type", "")).lower() not in {"integer", "bigint"}:
            continue

        with postgres_engine.begin() as conn:
            quoted_table = f'"public"."{table_name}"'
            conn.execute(
                text(
                    f"""
                    SELECT setval(
                      pg_get_serial_sequence(:table_name, 'id'),
                      COALESCE((SELECT MAX(id) FROM {quoted_table}), 1),
                      true
                    )
                    """
                ),
                {"table_name": f"public.{table_name}"},
            )


def main() -> int:
    args = parse_args()

    sqlite_engine = create_engine(args.sqlite_url, connect_args={"check_same_thread": False})
    postgres_engine = create_engine(args.postgres_url)

    from app.database import Base
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=postgres_engine)

    if args.truncate_first:
        truncate_all_tables(postgres_engine)

    for table in Base.metadata.sorted_tables:
        with sqlite_engine.connect() as src:
            rows = src.execute(select(table)).mappings().all()
        if not rows:
            continue
        with postgres_engine.begin() as dst:
            dst.execute(table.insert(), rows)

    reset_serial_sequences(postgres_engine)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
