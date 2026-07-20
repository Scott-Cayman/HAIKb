from __future__ import annotations

import json
import time

from app.database import SessionLocal
from app.models.folder import Folder
from app.services.folder_ai_preset_service import folder_ai_preset_service


CASES = [
    ("上班时间是什么时候", True),
    ("考勤制度是什么", True),
    ("早上最晚几点到岗", True),
    ("每天早晨什么时候算正式上工", True),
    ("朝九晚六是真的吗", True),
    ("下午六点能走吗", True),
    ("门禁打卡是不是一天两回", True),
    ("晚到十分钟会被记迟到吗", True),
    ("周末也需要打卡吗", False),
    ("忘打卡怎么补救", False),
]


def main() -> None:
    failures = []
    with SessionLocal() as db:
        folder_ids = [row[0] for row in db.query(Folder.id).filter(Folder.is_deleted == False).all()]
        for query, expected in CASES:
            started = time.perf_counter()
            match = folder_ai_preset_service.match(db, query=query, visible_folder_ids=folder_ids)
            payload = match.to_debug()
            payload["query"] = query
            payload["expected"] = expected
            payload["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 2)
            print(json.dumps(payload, ensure_ascii=False))
            if match.matched is not expected:
                failures.append({"query": query, "expected": expected, "actual": match.matched})

        broad_match = folder_ai_preset_service.match(
            db,
            query="考勤制度是什么",
            visible_folder_ids=folder_ids,
        )
        detail_match = folder_ai_preset_service.match(
            db,
            query="上班时间是什么时候",
            visible_folder_ids=folder_ids,
        )
        if not broad_match.matched or detail_match.answer != broad_match.answer:
            failures.append(
                {
                    "query": "预设完整答案一致性",
                    "expected": "细分问法与标准问法返回同一份完整答案",
                    "actual": {
                        "broad_matched": broad_match.matched,
                        "detail_matched": detail_match.matched,
                        "answers_equal": detail_match.answer == broad_match.answer,
                    },
                }
            )
    if failures:
        raise SystemExit("atomic preset validation failed: " + json.dumps(failures, ensure_ascii=False))


if __name__ == "__main__":
    main()
