from __future__ import annotations

import base64
from pathlib import Path
from typing import List, Optional, Union

import httpx

from app.config import settings


class LLMService:
    """OpenAI 兼容接口和 Ollama 接口封装，支持视觉模型。"""

    def is_configured(self) -> bool:
        return bool(settings.effective_llm_base_url and settings.effective_llm_api_key and settings.effective_llm_model)

    def is_vision_configured(self) -> bool:
        """检查视觉模型是否配置（优先检查 Ollama）。"""
        import logging
        logger = logging.getLogger(__name__)
        
        # 优先检查 Ollama
        has_ollama = bool(settings.OLLAMA_BASE_URL and settings.OLLAMA_VISION_MODEL)
        if has_ollama:
            logger.info("Using Ollama for vision model")
            return has_ollama
        
        # 其次检查 ARK
        has_ark = bool(
            settings.effective_llm_base_url 
            and settings.effective_llm_api_key 
            and settings.ARK_IMAGE_MODEL
        )
        if has_ark:
            logger.info("Using ARK for vision model")
        
        return has_ark

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

    def chat_with_image(
        self,
        image_path: Union[str, Path],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 2000
    ) -> str:
        """使用视觉模型识别图片，优先使用 Ollama。"""
        import logging
        logger = logging.getLogger(__name__)

        if not self.is_vision_configured():
            raise RuntimeError("视觉 LLM 未配置")

        # 读取并编码图片
        image_path = Path(image_path)
        if not image_path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")

        logger.info(f"Reading image: {image_path}, size: {image_path.stat().st_size} bytes")

        with open(image_path, "rb") as f:
            image_data = f.read()
        image_base64 = base64.b64encode(image_data).decode("utf-8")

        # 优先尝试 Ollama
        if settings.OLLAMA_BASE_URL and settings.OLLAMA_VISION_MODEL:
            logger.info(f"Trying Ollama with model: {settings.OLLAMA_VISION_MODEL}")
            try:
                return self._chat_with_image_ollama(
                    image_base64, system_prompt, user_prompt, temperature, max_tokens
                )
            except Exception as e:
                logger.exception(f"Ollama failed: {e}")
                # Ollama 失败，尝试 ARK

        # 尝试 ARK
        if settings.ARK_IMAGE_MODEL:
            logger.info(f"Trying ARK with model: {settings.ARK_IMAGE_MODEL}")
            try:
                return self._chat_with_image_ark(
                    image_base64, image_path, system_prompt, user_prompt, temperature, max_tokens
                )
            except Exception as e:
                logger.exception(f"ARK failed: {e}")

        raise RuntimeError("所有视觉模型都失败了")

    def _chat_with_image_ollama(
        self,
        image_base64: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int
    ) -> str:
        """使用 Ollama 视觉模型 API。"""
        import logging
        logger = logging.getLogger(__name__)

        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/generate"
        
        payload = {
            "model": settings.OLLAMA_VISION_MODEL,
            "prompt": f"{system_prompt}\n\n{user_prompt}",
            "images": [image_base64],
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            }
        }

        logger.info(f"Ollama request URL: {url}")
        logger.info(f"Ollama model: {settings.OLLAMA_VISION_MODEL}")

        with httpx.Client(timeout=settings.OLLAMA_TIMEOUT_SECONDS) as client:
            response = client.post(url, json=payload)
            
            logger.info(f"Ollama response status: {response.status_code}")
            
            try:
                response_data = response.json()
                logger.info(f"Ollama response JSON: {response_data}")
            except Exception as e:
                logger.info(f"Ollama response text: {response.text}")
                raise
            
            response.raise_for_status()
            data = response.json()
            
            result = data.get("response") or ""
            if not result:
                raise RuntimeError("Ollama 返回为空")
            
            logger.info(f"Ollama response length: {len(result)}")
            return result.strip()

    def _chat_with_image_ark(
        self,
        image_base64: str,
        image_path: Path,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        max_tokens: int
    ) -> str:
        """使用火山引擎 ARK 视觉模型 API（备用方案）。"""
        import logging
        logger = logging.getLogger(__name__)

        url = settings.effective_llm_base_url.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.effective_llm_api_key}",
            "Content-Type": "application/json",
        }

        image_ext = image_path.suffix.lstrip('.') or 'png'
        
        # 尝试多种 API 格式
        formats = [
            ("Format 1 (OpenAI vision)", {
                "model": settings.ARK_IMAGE_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/{image_ext};base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }),
            ("Format 2 (Simple base64 in message)", {
                "model": settings.ARK_IMAGE_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"{user_prompt}\n\n图片数据: {image_base64}"}
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
            }),
        ]

        last_error = None
        
        for format_name, payload in formats:
            logger.info(f"Trying ARK {format_name}")
            try:
                with httpx.Client(timeout=settings.ARK_TIMEOUT_SECONDS) as client:
                    response = client.post(url, headers=headers, json=payload)
                    
                    logger.info(f"ARK response status: {response.status_code}")
                    
                    try:
                        response_data = response.json()
                        logger.info(f"ARK response JSON: {response_data}")
                    except Exception as e:
                        logger.info(f"ARK response text: {response.text}")
                    
                    if response.status_code == 200:
                        data = response.json()
                        choices = data.get("choices") or []
                        if choices:
                            message = choices[0].get("message") or {}
                            result = (message.get("content") or "").strip()
                            logger.info(f"Success with ARK {format_name}, response length: {len(result)}")
                            return result
            except Exception as e:
                logger.exception(f"Error with ARK {format_name}: {e}")
                last_error = e

        if last_error:
            raise last_error
        raise RuntimeError("所有 ARK 视觉模型 API 格式都失败了")


llm_service = LLMService()
