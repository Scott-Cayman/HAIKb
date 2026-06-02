from dataclasses import dataclass
from app.config import settings


@dataclass(frozen=True)
class RagRuntimeSettings:
    collection_prefix: str = settings.VECTOR_COLLECTION_PREFIX
    default_top_k: int = settings.RAG_DEFAULT_TOP_K
    vector_dir: str = settings.RAG_VECTOR_DIR
    summary_dir: str = settings.SUMMARY_DIR


rag_settings = RagRuntimeSettings()
