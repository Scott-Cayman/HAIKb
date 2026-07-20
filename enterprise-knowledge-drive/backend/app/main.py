from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine, verify_database_connection
from app.models import (
    AgentMessage,
    AuditLog,
    DocumentSummary,
    File,
    Favorite,
    Folder,
    FolderPermission,
    FolderSummary,
    RagIndex,
    RagIndexRelation,
    ResourcePermission,
    RagSource,
    SummaryChunk,
    SystemSetting,
    User,
    UserFileView,
    FolderAiPreset,
    FolderAiPresetQuestion,
    FolderAiPresetTrigger,
)
from app.rag.index_manager import index_manager
from app.routers import admin, agent, auth, favorites, files, folders, folder_ai_presets, rag
from app.services.file_preview_service import recover_interrupted_thumbnail_jobs
from app.schema_patches import (
    ensure_file_preview_columns,
    ensure_folder_visual_columns,
    ensure_resource_permission_columns,
    ensure_user_department_paths_column,
)

verify_database_connection()
Base.metadata.create_all(bind=engine)
ensure_folder_visual_columns(engine)
ensure_resource_permission_columns(engine)
ensure_user_department_paths_column(engine)
ensure_file_preview_columns(engine)

app = FastAPI(title="Enterprise Knowledge Drive")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    recover_interrupted_thumbnail_jobs()
    index_manager.on_application_startup()


Path(settings.STORAGE_DIR, "covers").mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=Path(settings.STORAGE_DIR, "covers")), name="covers")


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(folders.router, prefix="/api/folders", tags=["folders"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(favorites.router, prefix="/api/favorites", tags=["favorites"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(folder_ai_presets.router, prefix="/api/admin/folders", tags=["folder-ai-presets"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])


@app.get("/")
def read_root():
    return {"message": "Welcome to Enterprise Knowledge Drive API"}


@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "enterprise-knowledge-drive"}
