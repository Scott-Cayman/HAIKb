from __future__ import annotations

import math
from typing import Iterable, List

import httpx

from app.config import settings


class EmbeddingService:
    """Generate normalized embeddings through Ollama or an OpenAI-compatible API."""

    def is_configured(self) -> bool:
        return bool(settings.effective_embedding_base_url and settings.EMBEDDING_MODEL)

    def embed_documents(self, texts: Iterable[str]) -> List[List[float]]:
        normalized = [(text or '').strip() for text in texts]
        if not normalized:
            return []
        if any(not text for text in normalized):
            raise ValueError('Embedding input must not be empty.')
        return self._embed(normalized)

    def embed_query(self, query: str) -> List[float]:
        query = (query or '').strip()
        if not query:
            return []
        task = (
            'Given a Chinese or English enterprise knowledge-base query, retrieve passages that contain '
            'the information needed to answer it, including synonymous business terms and implicit concepts.'
        )
        instructed_query = f'Instruct: {task}\nQuery: {query}'
        return self._embed([instructed_query])[0]

    def _embed(self, texts: List[str]) -> List[List[float]]:
        provider = settings.EMBEDDING_PROVIDER.strip().lower()
        if provider == 'ollama':
            vectors = self._embed_ollama(texts)
        elif provider in {'openai', 'openai_compatible'}:
            vectors = self._embed_openai_compatible(texts)
        else:
            raise RuntimeError(f'Unsupported embedding provider: {settings.EMBEDDING_PROVIDER}')

        if len(vectors) != len(texts):
            raise RuntimeError(f'Embedding response count mismatch: expected {len(texts)}, got {len(vectors)}.')
        return [self._truncate_and_normalize(vector) for vector in vectors]

    def _embed_ollama(self, texts: List[str]) -> List[List[float]]:
        url = settings.effective_embedding_base_url + '/api/embed'
        payload = {'model': settings.EMBEDDING_MODEL, 'input': texts, 'truncate': True}
        timeout = httpx.Timeout(settings.EMBEDDING_TIMEOUT_SECONDS, connect=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, json=payload)
        if response.status_code >= 400:
            detail = response.text.strip()
            if response.status_code == 501 and '--embeddings' in detail:
                raise RuntimeError(
                    'The Ollama server has embeddings disabled. Restart it with the --embeddings option enabled.'
                )
            response.raise_for_status()
        data = response.json()
        return data.get('embeddings') or []

    def _embed_openai_compatible(self, texts: List[str]) -> List[List[float]]:
        url = settings.effective_embedding_base_url + '/embeddings'
        headers = {'Content-Type': 'application/json'}
        if settings.EMBEDDING_API_KEY:
            headers['Authorization'] = f'Bearer {settings.EMBEDDING_API_KEY}'
        payload = {'model': settings.EMBEDDING_MODEL, 'input': texts}
        timeout = httpx.Timeout(settings.EMBEDDING_TIMEOUT_SECONDS, connect=5.0)
        with httpx.Client(timeout=timeout) as client:
            response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        rows = sorted(response.json().get('data') or [], key=lambda item: item.get('index', 0))
        return [row.get('embedding') or [] for row in rows]

    def _truncate_and_normalize(self, vector: List[float]) -> List[float]:
        target_dimensions = settings.EMBEDDING_DIMENSIONS
        if len(vector) < target_dimensions:
            raise RuntimeError(
                f'Embedding dimension {len(vector)} is smaller than configured target {target_dimensions}.'
            )
        truncated = [float(value) for value in vector[:target_dimensions]]
        norm = math.sqrt(sum(value * value for value in truncated))
        if norm <= 0:
            raise RuntimeError('Embedding model returned a zero vector.')
        return [value / norm for value in truncated]


embedding_service = EmbeddingService()
