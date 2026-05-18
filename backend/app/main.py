from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine
from app.models import (
    AgentMessage,
    AuditLog,
    DocumentSummary,
    File,
    Folder,
    FolderPermission,
    FolderSummary,
    RagIndex,
    RagIndexRelation,
    RagSource,
    SummaryChunk,
    SystemSetting,
    User,
)
from app.rag.index_manager import index_manager
from app.routers import admin, agent, auth, files, folders, rag

Base.metadata.create_all(bind=engine)

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
    index_manager.on_application_startup()


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(folders.router, prefix="/api/folders", tags=["folders"])
app.include_router(files.router, prefix="/api/files", tags=["files"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])


@app.get("/")
def read_root():
    return {"message": "Welcome to Enterprise Knowledge Drive API"}
