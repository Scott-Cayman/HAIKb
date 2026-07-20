"""Compatibility entry point for PostgreSQL schema migrations."""

from __future__ import annotations

import subprocess
from pathlib import Path


def main() -> int:
    backend_root = Path(__file__).resolve().parent
    return subprocess.call(
        [str(backend_root / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        cwd=backend_root,
    )


if __name__ == "__main__":
    raise SystemExit(main())
