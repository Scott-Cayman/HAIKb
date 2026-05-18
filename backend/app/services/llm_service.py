from __future__ import annotations

from typing import List

import httpx

from app.config import settings


class LLMService:
    """OpenAI 兼容接口封装。"""

    def is_configured(self) -> bool:
        return bool(settings.effective_llm_base_url and settings.effective_llm_api_key and settings.effective_llm_model)

    def chat(self, messages: List[dict], temperature: float = 0.2, max_tokens: int = 1800) -> str:
        if not self.is_configured():
            raise RuntimeError("LLM 未配置")

        url = settings.effective_llm_base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.effective_llm_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": settings.effective_llm_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        with httpx.Client(timeout=settings.effective_llm_timeout) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("LLM 返回为空")

        message = choices[0].get("message") or {}
        return (message.get("content") or "").strip()


llm_service = LLMService()
