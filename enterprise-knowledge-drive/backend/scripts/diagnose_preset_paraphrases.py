from __future__ import annotations

import json
import time
from collections import defaultdict
from difflib import SequenceMatcher

from app.database import SessionLocal
from app.models.folder import Folder
from app.models.folder_ai_preset import FolderAiPreset, FolderAiPresetQuestion
from app.services.embedding_service import embedding_service
from app.services.folder_ai_preset_service import (
    DIRECT_SEMANTIC_MARGIN,
    DIRECT_SEMANTIC_THRESHOLD,
    folder_ai_preset_service,
)


TEST_QUERIES = [
    "上班时间是什么时候",
    "考勤制度是什么",
    "早上最晚几点到岗",
    "每天早晨什么时候算正式上工",
    "朝九晚六是真的吗",
    "下午六点能走吗",
    "门禁打卡是不是一天两回",
    "晚到十分钟会被记迟到吗",
    "忘打卡怎么补救",
    "周末也需要打卡吗",
]


# These are deliberately atomic: one embedding represents one fact/intention.
# They are only used for an in-memory benchmark and are not written to the DB.
ATOMIC_TRIGGERS = {
    "attendance_general": [
        "公司考勤制度",
        "考勤规定",
        "考勤管理办法",
    ],
    "work_start": [
        "几点上班",
        "上班时间",
        "公司开始办公时间",
        "早晨到岗时间",
        "朝九晚六",
    ],
    "work_end": [
        "几点下班",
        "下班时间",
        "公司结束办公时间",
        "晚上离岗时间",
    ],
    "clock_count": [
        "一天打卡几次",
        "每天打卡次数",
        "上下班都要打卡",
        "考勤打卡要求",
    ],
    "late": [
        "迟到怎么计算",
        "迟到早退规定",
        "晚到几分钟算迟到",
    ],
}


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def normalize(value: str) -> str:
    return folder_ai_preset_service.normalize_question(value)


def char_similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, normalize(left), normalize(right)).ratio()


def load_json_list(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except (TypeError, json.JSONDecodeError):
        return []
    return [str(item) for item in value] if isinstance(value, list) else []


def main() -> None:
    db = SessionLocal()
    try:
        rows = (
            db.query(FolderAiPresetQuestion, FolderAiPreset, Folder)
            .join(FolderAiPreset, FolderAiPreset.id == FolderAiPresetQuestion.preset_id)
            .join(Folder, Folder.id == FolderAiPreset.folder_id)
            .filter(
                FolderAiPreset.status == "published",
                FolderAiPreset.is_deleted == False,
                FolderAiPresetQuestion.is_enabled == True,
                Folder.is_deleted == False,
            )
            .all()
        )
        current: list[tuple[FolderAiPresetQuestion, FolderAiPreset, Folder, list[float]]] = []
        for question, preset, folder in rows:
            try:
                vector = [float(item) for item in json.loads(question.embedding_json or "[]")]
            except (TypeError, ValueError, json.JSONDecodeError):
                vector = []
            if vector:
                current.append((question, preset, folder, vector))

        trigger_rows = [
            (intent, trigger)
            for intent, triggers in ATOMIC_TRIGGERS.items()
            for trigger in triggers
        ]
        started = time.perf_counter()
        trigger_vectors = embedding_service.embed_documents([trigger for _, trigger in trigger_rows])
        trigger_embedding_ms = (time.perf_counter() - started) * 1000

        print(
            json.dumps(
                {
                    "published_questions": len(rows),
                    "vectorized_questions": len(current),
                    "atomic_trigger_count": len(trigger_rows),
                    "atomic_publish_time_embedding_ms": round(trigger_embedding_ms, 2),
                    "note": "atomic trigger embedding is publish-time only, not query-time",
                },
                ensure_ascii=False,
            )
        )

        for query in TEST_QUERIES:
            started = time.perf_counter()
            query_vector = embedding_service.embed_query(query)
            query_embedding_ms = (time.perf_counter() - started) * 1000

            current_scores = []
            for question, preset, folder, vector in current:
                current_scores.append(
                    {
                        "score": dot(query_vector, vector),
                        "question": question.question,
                        "aliases": load_json_list(question.aliases_json),
                        "folder": folder.name,
                        "preset": preset.name,
                    }
                )
            current_scores.sort(key=lambda item: item["score"], reverse=True)
            current_top = current_scores[:3]
            current_best = current_top[0]["score"] if current_top else 0.0
            current_second = current_top[1]["score"] if len(current_top) > 1 else 0.0
            current_margin = current_best - current_second
            current_decision = (
                current_best >= DIRECT_SEMANTIC_THRESHOLD
                and current_margin >= DIRECT_SEMANTIC_MARGIN
            )

            scoring_started = time.perf_counter()
            proposed_by_intent: dict[str, dict] = defaultdict(
                lambda: {"semantic": -1.0, "semantic_trigger": "", "lexical": -1.0, "lexical_trigger": ""}
            )
            for (intent, trigger), vector in zip(trigger_rows, trigger_vectors):
                semantic = dot(query_vector, vector)
                lexical = char_similarity(query, trigger)
                normalized_query = normalize(query)
                normalized_trigger = normalize(trigger)
                if (
                    min(len(normalized_query), len(normalized_trigger)) >= 4
                    and (normalized_query in normalized_trigger or normalized_trigger in normalized_query)
                ):
                    lexical = 1.0
                bucket = proposed_by_intent[intent]
                if semantic > bucket["semantic"]:
                    bucket["semantic"] = semantic
                    bucket["semantic_trigger"] = trigger
                if lexical > bucket["lexical"]:
                    bucket["lexical"] = lexical
                    bucket["lexical_trigger"] = trigger

            proposed = [dict(intent=intent, **values) for intent, values in proposed_by_intent.items()]
            proposed.sort(key=lambda item: max(item["semantic"], item["lexical"]), reverse=True)
            local_scoring_ms = (time.perf_counter() - scoring_started) * 1000

            lexical_winner = max(proposed, key=lambda item: item["lexical"])
            semantic_order = sorted(proposed, key=lambda item: item["semantic"], reverse=True)
            semantic_best = semantic_order[0]
            semantic_second = semantic_order[1]
            proposed_decision = "fallback"
            if lexical_winner["lexical"] >= 0.78:
                proposed_decision = f"preset_lexical:{lexical_winner['intent']}"
            elif semantic_best["semantic"] >= 0.68 and semantic_best["semantic"] - semantic_second["semantic"] >= 0.04:
                proposed_decision = f"preset_semantic:{semantic_best['intent']}"

            print(
                json.dumps(
                    {
                        "query": query,
                        "query_embedding_ms": round(query_embedding_ms, 2),
                        "current": {
                            "decision": current_decision,
                            "best": round(current_best, 4),
                            "margin": round(current_margin, 4),
                            "top3": [
                                {
                                    "score": round(item["score"], 4),
                                    "question": item["question"],
                                    "folder": item["folder"],
                                }
                                for item in current_top
                            ],
                        },
                        "atomic_trigger_simulation": {
                            "decision": proposed_decision,
                            "local_scoring_ms": round(local_scoring_ms, 3),
                            "semantic_margin": round(semantic_best["semantic"] - semantic_second["semantic"], 4),
                            "top_intents": [
                                {
                                    "intent": item["intent"],
                                    "semantic": round(item["semantic"], 4),
                                    "semantic_trigger": item["semantic_trigger"],
                                    "lexical": round(item["lexical"], 4),
                                    "lexical_trigger": item["lexical_trigger"],
                                }
                                for item in proposed[:3]
                            ]
                        },
                    },
                    ensure_ascii=False,
                )
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
