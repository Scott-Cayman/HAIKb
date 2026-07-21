from __future__ import annotations

import json
import time

from app.database import SessionLocal
from app.models.folder import Folder
from app.services.folder_ai_preset_service import folder_ai_preset_service


CASES = [
    ("上班时间是什么时候", True),
    ("考勤时间", True),
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
    source = """### 工作制度

1. 上班时间 9:00，下班时间 18:00，每天两次上下班人脸识别打卡，考勤以钉钉记录为准。
2. 考勤统计周期以一个月为周期，每个月最后一天为考勤核算日。
3. 每天打卡迟到超过 10 分钟计为迟到，每月迟到三次视为缺勤一天。
4. 单个工作日在规定下班时间未打卡、未请假擅自离岗，视为早退，每月三次视为缺勤。
5. 未在工作日按时出勤且无请假手续，视为缺勤，扣除一天全额工资。
6. 2 天以上（含两天）无假条的缺勤，视为旷工，旷工扣除双倍全额工资。
7. 旷工五天以上视为自动离职。
8. 调休、外出、出差需提前告知团队长并申请，不得先斩后奏，外出申请需当天提交有效。"""
    chunks = folder_ai_preset_service._split_source(source)
    if len(chunks) != 8:
        failures.append({"query": "编号制度预拆分", "expected": 8, "actual": len(chunks)})

    schedule = folder_ai_preset_service._sanitize_questions(
        [
            {
                "question": "上班时间和下班时间是什么？",
                "aliases": ["上下班时间"],
                "answer": "上班时间 9:00，下班时间 18:00。",
                "keywords": ["上班时间", "下班时间"],
                "priority": 90,
            }
        ]
    )[0]
    if "考勤时间" not in schedule["aliases"]:
        failures.append({"query": "考勤时间别名补全", "expected": True, "actual": schedule["aliases"]})

    merged_schedule = folder_ai_preset_service._merge_daily_schedule_questions(
        [
            {
                "question": "上班时间是什么时候？",
                "aliases": ["几点上班"],
                "answer": "上班时间为 9:00。",
                "keywords": ["上班时间"],
                "priority": 90,
                "is_enabled": True,
            },
            {
                "question": "下班时间是什么时候？",
                "aliases": ["几点下班"],
                "answer": "下班时间为 18:00。",
                "keywords": ["下班时间"],
                "priority": 90,
                "is_enabled": True,
            },
        ]
    )
    if len(merged_schedule) != 1 or "上班时间" not in merged_schedule[0]["answer"] or "下班时间" not in merged_schedule[0]["answer"]:
        failures.append(
            {
                "query": "上下班时间完整合并",
                "expected": "一条包含上下班时间的完整答案",
                "actual": merged_schedule,
            }
        )

    cycle = folder_ai_preset_service._sanitize_questions(
        [
            {
                "question": "考勤统计周期是多久？",
                "aliases": ["考勤时间", "考勤周期"],
                "answer": "考勤统计周期以一个月为周期。",
                "keywords": ["考勤周期"],
                "priority": 80,
            }
        ]
    )[0]
    if "考勤时间" in cycle["aliases"]:
        failures.append({"query": "考勤周期别名隔离", "expected": False, "actual": cycle["aliases"]})

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
