from __future__ import annotations

import json
import time

import httpx

from app.database import SessionLocal
from app.models.folder_ai_preset import FolderAiPresetQuestion


OLLAMA_URL = "http://192.168.8.151:11434"
MODEL = "dengcao/Qwen3-Reranker-8B:Q8_0"
LLM_MODEL = "qwen3:4b"
QUERIES = [
    "上班时间是什么时候",
    "早上最晚几点到岗",
    "周末也需要打卡吗",
    "忘打卡怎么补救",
]

INSTRUCTION = (
    "Given an enterprise policy question, determine whether the Document explicitly contains enough "
    "factual information to answer the complete Query. Allow ordinary paraphrases and direct logical "
    "conversion: for example, a stated work start time is enough to answer the latest normal on-time arrival. "
    "Topic relevance alone is insufficient. Reject a query that adds an unsupported condition or procedure, "
    "such as weekend, holiday, exception, department, or missed-clock remediation."
)
PREFIX = (
    '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and the '
    'Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n'
    '<|im_start|>user\n'
)
SUFFIX = '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'


def build_prompt(query: str, document: str) -> str:
    pair = f"<Instruct>: {INSTRUCTION}\n<Query>: {query}\n<Document>: {document}"
    return PREFIX + pair + SUFFIX


def main() -> None:
    db = SessionLocal()
    try:
        row = db.query(FolderAiPresetQuestion).filter(FolderAiPresetQuestion.question.contains("考勤制度")).first()
        if row is None:
            raise RuntimeError("attendance preset not found")
        document = row.answer
    finally:
        db.close()

    print(json.dumps({"question": row.question, "answer_chars": len(document)}, ensure_ascii=False))
    atomic_document = next(
        (line.strip() for line in document.splitlines() if "上班时间" in line and "下班时间" in line),
        document,
    )
    with httpx.Client(timeout=120.0) as client:
        print(json.dumps({"benchmark": "reranker", "model": MODEL}, ensure_ascii=False))
        for query in QUERIES:
            started = time.perf_counter()
            response = client.post(
                OLLAMA_URL + "/api/generate",
                json={
                    "model": MODEL,
                    "prompt": build_prompt(query, atomic_document),
                    "stream": False,
                    "keep_alive": "10m",
                    "options": {"temperature": 0, "num_predict": 1},
                },
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
            response.raise_for_status()
            payload = response.json()
            print(
                json.dumps(
                    {
                        "query": query,
                        "answerable": payload.get("response", "").strip(),
                        "wall_ms": round(elapsed_ms, 2),
                        "load_ms": round((payload.get("load_duration") or 0) / 1_000_000, 2),
                        "prompt_eval_ms": round((payload.get("prompt_eval_duration") or 0) / 1_000_000, 2),
                        "eval_ms": round((payload.get("eval_duration") or 0) / 1_000_000, 2),
                    },
                    ensure_ascii=False,
                )
            )

if __name__ == "__main__":
    main()
