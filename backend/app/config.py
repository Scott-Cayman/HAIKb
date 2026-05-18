from pathlib import Path
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BASE_DIR.parent
DEFAULT_DATA_DIR = PROJECT_ROOT / 'data'
DEFAULT_STORAGE_DIR = PROJECT_ROOT / 'storage'
DEFAULT_PREVIEW_DIR = DEFAULT_STORAGE_DIR / 'previews'
DEFAULT_SUMMARY_DIR = DEFAULT_STORAGE_DIR / 'summaries'
DEFAULT_RAG_DIR = DEFAULT_STORAGE_DIR / 'rag'
DEFAULT_RAG_VECTOR_DIR = DEFAULT_RAG_DIR / 'vectors'
DEFAULT_RAG_DOC_DIR = DEFAULT_RAG_DIR / 'docs'
DEFAULT_DATABASE_URL = f"sqlite:///{(DEFAULT_DATA_DIR / 'app.db').resolve()}"


class Settings(BaseSettings):
    AUTH_MOCK: bool = False
    DINGTALK_CLIENT_ID: str = ''
    DINGTALK_CLIENT_SECRET: str = ''
    DINGTALK_CORP_ID: str = ''
    DINGTALK_AGENT_ID: str = ''
    DINGTALK_REDIRECT_URI: str = ''
    DINGTALK_ALLOWED_EMAIL_DOMAINS: str = '@himice.com'
    DINGTALK_OAUTH_STATE_EXPIRE_SECONDS: int = 10 * 60

    JWT_SECRET: str = 'supersecretkey_change_me_in_production'
    ALGORITHM: str = 'HS256'
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    DATABASE_URL: str = DEFAULT_DATABASE_URL
    STORAGE_DIR: str = str(DEFAULT_STORAGE_DIR)
    PREVIEW_DIR: str = str(DEFAULT_PREVIEW_DIR)
    SUMMARY_DIR: str = str(DEFAULT_SUMMARY_DIR)
    RAG_DATA_DIR: str = str(DEFAULT_RAG_DIR)
    RAG_VECTOR_DIR: str = str(DEFAULT_RAG_VECTOR_DIR)
    RAG_DOC_DIR: str = str(DEFAULT_RAG_DOC_DIR)

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
    
    @property
    def effective_llm_base_url(self) -> str:
        return self.ARK_BASE_URL or self.LLM_BASE_URL
    
    @property
    def effective_llm_api_key(self) -> str:
        return self.ARK_API_KEY or self.LLM_API_KEY
    
    @property
    def effective_llm_model(self) -> str:
        return self.ARK_TEXT_MODEL or self.LLM_MODEL
    
    @property
    def effective_llm_timeout(self) -> int:
        return self.ARK_TIMEOUT_SECONDS or self.LLM_TIMEOUT_SECONDS

    VECTOR_STORE: str = 'local'
    VECTOR_COLLECTION_PREFIX: str = 'haikb_summary'
    AGENT_REASONING_MODE: str = 'simple'
    RAG_DEFAULT_TOP_K: int = 8

    class Config:
        env_file = '.env'
        extra = 'ignore'


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
Path(PROJECT_ROOT, 'data').mkdir(parents=True, exist_ok=True)
