from __future__ import annotations

import time
from dataclasses import dataclass
from typing import List, Optional

import httpx

from app.config import settings


@dataclass
class AnswerabilityResult:
    answerable: Optional[bool]
    method: str
    latency_ms: float = 0.0
    reason: str = ""
    unsupported_qualifiers: Optional[List[str]] = None


class PresetAnswerabilityService:
    """Conservative coverage gate used only after an atomic semantic match."""

    CONDITION_TERMS = (
        "周末",
        "周六",
        "周日",
        "节假日",
        "法定假日",
        "假期",
        "补卡",
        "忘记打卡",
        "忘打卡",
        "漏打卡",
        "补救",
        "特殊情况",
        "例外",
        "加班",
        "居家",
        "远程办公",
        "异地",
        "实习生",
        "试用期",
        "兼职",
    )

    def verify(self, query: str, evidence: str) -> AnswerabilityResult:
        unsupported = [term for term in self.CONDITION_TERMS if term in query and term not in evidence]
        if unsupported:
            return AnswerabilityResult(
                answerable=False,
                method="qualifier_guard",
                reason="问题包含预设证据未覆盖的条件：" + "、".join(unsupported),
                unsupported_qualifiers=unsupported,
            )

        if not settings.PRESET_RERANKER_ENABLED:
            return AnswerabilityResult(
                answerable=None,
                method="disabled",
                reason="答案覆盖校验未启用。",
            )

        prompt = self._build_prompt(query, evidence)
        started = time.perf_counter()
        try:
            with httpx.Client(timeout=settings.PRESET_RERANKER_TIMEOUT_SECONDS) as client:
                response = client.post(
                    settings.effective_embedding_base_url + "/api/generate",
                    json={
                        "model": settings.PRESET_RERANKER_MODEL,
                        "prompt": prompt,
                        "stream": False,
                        "keep_alive": "30m",
                        "options": {"temperature": 0, "num_predict": 1},
                    },
                )
            response.raise_for_status()
            verdict = str(response.json().get("response") or "").strip().lower()
            latency_ms = (time.perf_counter() - started) * 1000
            if verdict == "yes":
                return AnswerabilityResult(
                    answerable=True,
                    method="qwen3_reranker",
                    latency_ms=latency_ms,
                    reason="原子证据足以回答该问法。",
                )
            if verdict == "no":
                return AnswerabilityResult(
                    answerable=False,
                    method="qwen3_reranker",
                    latency_ms=latency_ms,
                    reason="问题与预设相关，但原子证据不足以安全直答。",
                )
            return AnswerabilityResult(
                answerable=None,
                method="qwen3_reranker",
                latency_ms=latency_ms,
                reason=f"覆盖校验返回了无法识别的结果：{verdict[:20]}",
            )
        except Exception as exc:
            return AnswerabilityResult(
                answerable=None,
                method="qwen3_reranker_error",
                latency_ms=(time.perf_counter() - started) * 1000,
                reason=f"覆盖校验暂不可用：{type(exc).__name__}",
            )

    def _build_prompt(self, query: str, evidence: str) -> str:
        instruction = (
            "Given an enterprise policy question, determine whether the Document contains enough factual "
            "information to answer the complete Query. Allow ordinary paraphrases and direct one-step "
            "inference. Topic relevance alone is insufficient; unsupported conditions or procedures must "
            "be rejected."
        )
        pair = f"<Instruct>: {instruction}\n<Query>: {query}\n<Document>: {evidence[:1200]}"
        return (
            '<|im_start|>system\nJudge whether the Document meets the requirements based on the Query and '
            'the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>\n'
            '<|im_start|>user\n'
            + pair
            + '<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n'
        )


preset_answerability_service = PresetAnswerabilityService()
