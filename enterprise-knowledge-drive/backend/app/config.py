from pathlib import Path
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BASE_DIR.parent
DEFAULT_STORAGE_DIR = PROJECT_ROOT / 'storage'
DEFAULT_PREVIEW_DIR = DEFAULT_STORAGE_DIR / 'previews'
DEFAULT_SUMMARY_DIR = DEFAULT_STORAGE_DIR / 'summaries'
DEFAULT_RAG_DIR = DEFAULT_STORAGE_DIR / 'rag'
DEFAULT_RAG_VECTOR_DIR = DEFAULT_RAG_DIR / 'vectors'
DEFAULT_RAG_DOC_DIR = DEFAULT_RAG_DIR / 'docs'


class Settings(BaseSettings):
    AUTH_MOCK: bool = False
    DINGTALK_CLIENT_ID: str = ''
    DINGTALK_CLIENT_SECRET: str = ''
    DINGTALK_CORP_ID: str = ''
    DINGTALK_AGENT_ID: str = ''
    DINGTALK_REDIRECT_URI: str = ''
    DINGTALK_ALLOWED_EMAIL_DOMAINS: str = '@himice.com'
    DINGTALK_OAUTH_STATE_EXPIRE_SECONDS: int = 10 * 60
    SUPER_ADMIN_EMAILS: str = ''
    ADMIN_EMAILS: str = ''

    JWT_SECRET: str = 'supersecretkey_change_me_in_production'
    ALGORITHM: str = 'HS256'
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    POSTGRES_USER: str = ''
    POSTGRES_PASSWORD: str = ''
    POSTGRES_HOST: str = ''
    POSTGRES_PORT: str = ''
    POSTGRES_DB: str = ''
    POSTGRES_URL: str = ''
    # PostgreSQL is the only supported runtime database. DATABASE_URL remains
    # as a compatibility input for deployment platforms, but SQLite URLs are
    # rejected by effective_database_url.
    DATABASE_URL: str = ''

    STORAGE_DIR: str = str(DEFAULT_STORAGE_DIR)
    PREVIEW_DIR: str = str(DEFAULT_PREVIEW_DIR)
    SUMMARY_DIR: str = str(DEFAULT_SUMMARY_DIR)
    RAG_DATA_DIR: str = str(DEFAULT_RAG_DIR)
    RAG_VECTOR_DIR: str = str(DEFAULT_RAG_VECTOR_DIR)
    RAG_DOC_DIR: str = str(DEFAULT_RAG_DOC_DIR)
    # Keep this aligned with Nginx client_max_body_size.  A backend-side limit
    # also protects direct LAN/Vite uploads that do not pass through Nginx.
    MAX_UPLOAD_SIZE_MB: int = 2048

    LLM_BASE_URL: str = ''
    LLM_API_KEY: str = ''
    LLM_MODEL: str = 'gpt-4.1-mini'
    LLM_EMBEDDING_MODEL: str = 'text-embedding-3-small'
    LLM_TIMEOUT_SECONDS: int = 60

    ARK_API_KEY: str = ''
    ARK_BASE_URL: str = ''
    ARK_TEXT_MODEL: str = ''
    ARK_IMAGE_MODEL: str = ''
    ARK_TIMEOUT_SECONDS: int = 60
    QWEN_AGENT_ENABLED: bool = False
    
    OLLAMA_BASE_URL: str = 'http://localhost:11434'
    OLLAMA_VISION_MODEL: str = 'gemma4:e4b'
    OLLAMA_TIMEOUT_SECONDS: int = 60

    EMBEDDING_PROVIDER: str = 'ollama'
    EMBEDDING_BASE_URL: str = ''
    EMBEDDING_API_KEY: str = ''
    EMBEDDING_MODEL: str = 'dengcao/Qwen3-Embedding-8B:Q8_0'
    EMBEDDING_SOURCE_DIMENSIONS: int = 4096
    EMBEDDING_DIMENSIONS: int = 1024
    EMBEDDING_BATCH_SIZE: int = 8
    EMBEDDING_TIMEOUT_SECONDS: int = 180

    # Summary generation and embedding share the same local model server.
    # Keep one file in flight per backend process to avoid model timeouts.
    SUMMARY_WORKER_CONCURRENCY: int = 1
    SUMMARY_BATCH_BASE_TIMEOUT_SECONDS: int = 300
    SUMMARY_BATCH_PER_FILE_TIMEOUT_SECONDS: int = 300
    SUMMARY_BATCH_MAX_TIMEOUT_SECONDS: int = 6 * 60 * 60

    PRESET_RERANKER_ENABLED: bool = False
    PRESET_RERANKER_MODEL: str = 'dengcao/Qwen3-Reranker-8B:Q8_0'
    PRESET_RERANKER_TIMEOUT_SECONDS: int = 8
    PRESET_SEMANTIC_THRESHOLD: float = 0.68
    PRESET_SEMANTIC_MARGIN: float = 0.04

    PREVIEW_WORKER_CONCURRENCY: int = 2
    THUMBNAIL_PROCESSING_STALE_SECONDS: int = 30 * 60
    THUMBNAIL_FAILED_RETRY_SECONDS: int = 15 * 60

    VECTOR_STORE: str = 'local'
    VECTOR_COLLECTION_PREFIX: str = 'haikb_summary'
    AGENT_REASONING_MODE: str = 'simple'
    RAG_DEFAULT_TOP_K: int = 8

    class Config:
        env_file = '.env'
        extra = 'ignore'

    @property
    def effective_database_url(self):
        candidate = (self.POSTGRES_URL or self.DATABASE_URL or '').strip()
        if candidate:
            if not candidate.startswith(('postgresql://', 'postgresql+psycopg2://', 'postgresql+psycopg://')):
                raise RuntimeError('HAIKB requires PostgreSQL; SQLite and other database backends are disabled.')
            return candidate

        if self.POSTGRES_USER and self.POSTGRES_DB:
            username = quote_plus(self.POSTGRES_USER)
            password = quote_plus(self.POSTGRES_PASSWORD)
            host = self.POSTGRES_HOST or '127.0.0.1'
            port = self.POSTGRES_PORT or '5432'
            database = quote_plus(self.POSTGRES_DB)
            return f"postgresql+psycopg2://{username}:{password}@{host}:{port}/{database}"

        raise RuntimeError(
            'PostgreSQL is not configured. Set POSTGRES_URL, DATABASE_URL with a PostgreSQL URL, '
            'or the POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_HOST/POSTGRES_PORT/POSTGRES_DB fields.'
        )

    @property
    def effective_llm_base_url(self):
        return self.ARK_BASE_URL or self.LLM_BASE_URL

    @property
    def effective_llm_api_key(self):
        return self.ARK_API_KEY or self.LLM_API_KEY

    @property
    def effective_llm_model(self):
        return self.ARK_TEXT_MODEL or self.LLM_MODEL

    @property
    def effective_llm_timeout(self):
        return self.ARK_TIMEOUT_SECONDS or self.LLM_TIMEOUT_SECONDS

    @property
    def effective_embedding_base_url(self):
        return (self.EMBEDDING_BASE_URL or self.OLLAMA_BASE_URL).rstrip('/')


settings = Settings()

for path_str in [
    settings.STORAGE_DIR,
    settings.PREVIEW_DIR,
    settings.SUMMARY_DIR,
    settings.RAG_DATA_DIR,
    settings.RAG_VECTOR_DIR,
    settings.RAG_DOC_DIR,
]:
    Path(path_str).mkdir(parents=True, exist_ok=True)

Path(settings.STORAGE_DIR, 'originals').mkdir(parents=True, exist_ok=True)
