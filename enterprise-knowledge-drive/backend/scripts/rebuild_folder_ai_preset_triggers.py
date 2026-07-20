from __future__ import annotations

import json
import time

from app.database import SessionLocal
from app.services.folder_ai_preset_service import folder_ai_preset_service


def main() -> None:
    started = time.perf_counter()
    with SessionLocal() as db:
        result = folder_ai_preset_service.rebuild_all_published_trigger_indexes(db)
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
