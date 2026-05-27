from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional, Set
from datetime import datetime
from pydantic import BaseModel
from app.database import get_db
from app.models.document_summary import DocumentSummary
from app.models.folder import Folder
from app.models.folder_summary import FolderSummary
from app.models.file import File
from app.models.user import User
from app.dependencies.auth import get_current_user
from app.rag.index_manager import index_manager
from app.services.folder_summary_service import folder_summary_service

router = APIRouter()

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    description: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class FolderResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    description: Optional[str]
    created_by: int
    cover_url: Optional[str] = None
    sort_order: int = 0
    is_deleted: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class FolderSummaryResponse(BaseModel):
    folder_id: int
    summary_status: str
    summary_error: Optional[str] = None
    summary: Optional[str] = None
    summary_file_path: Optional[str] = None


def _collect_descendant_folder_ids(db: Session, root_folder_id: int) -> List[int]:
    collected: List[int] = []
    visited: Set[int] = set()
    queue: List[int] = [root_folder_id]

    while queue:
        batch: List[int] = []
        while queue and len(batch) < 100:
            folder_id = queue.pop(0)
            if folder_id in visited:
                continue
            visited.add(folder_id)
            batch.append(folder_id)

        collected.extend(batch)
        child_rows = db.query(Folder.id).filter(Folder.parent_id.in_(batch)).all()
        queue.extend([row[0] for row in child_rows])

    return collected


@router.get("", response_model=List[FolderResponse])
def get_folders(parent_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Folder).filter(Folder.is_deleted == False)
    if parent_id is not None:
        query = query.filter(Folder.parent_id == parent_id)
    else:
        query = query.filter(Folder.parent_id == None)
    return query.all()

@router.post("", response_model=FolderResponse)
def create_folder(
    folder: FolderCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Basic permission check: only admins can create root folders, or everyone can?
    # For MVP, let's allow everyone to create folders, or restrict as needed.
    
    # Check if parent folder is a second-level folder (has its own parent)
    if folder.parent_id is not None:
        parent_folder = db.query(Folder).filter(Folder.id == folder.parent_id, Folder.is_deleted == False).first()
        if parent_folder and parent_folder.parent_id is not None:
            raise HTTPException(status_code=400, detail="Cannot create subfolder in a second-level folder")
    
    db_folder = Folder(
        name=folder.name,
        parent_id=folder.parent_id,
        description=folder.description,
        created_by=current_user.id
    )
    db.add(db_folder)
    db.commit()
    db.refresh(db_folder)
    
    # 只有一级文件夹（parent_id为None）才创建初始总结文档
    if folder.parent_id is None:
        background_tasks.add_task(folder_summary_service.create_initial_folder_summary, db_folder.id)
    else:
        # 如果是二级文件夹，更新父文件夹的总结
        background_tasks.add_task(folder_summary_service.update_folder_summary, folder.parent_id)
    
    return db_folder

@router.get("/{folder_id}", response_model=FolderResponse)
def get_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@router.get("/{folder_id}/summary", response_model=FolderSummaryResponse)
def get_folder_summary(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    summary = (
        db.query(FolderSummary)
        .filter(FolderSummary.folder_id == folder_id, FolderSummary.is_deleted == False)
        .first()
    )
    if not summary:
        return FolderSummaryResponse(folder_id=folder_id, summary_status="pending")

    return FolderSummaryResponse(
        folder_id=folder_id,
        summary_status=summary.summary_status,
        summary_error=summary.summary_error,
        summary=summary.summary_markdown,
        summary_file_path=summary.summary_file_path,
    )


@router.patch("/{folder_id}", response_model=FolderResponse)
def update_folder(folder_id: int, payload: FolderUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name required")
        folder.name = new_name
    if payload.description is not None:
        folder.description = payload.description

    db.commit()
    db.refresh(folder)
    return folder

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    folder_ids = _collect_descendant_folder_ids(db=db, root_folder_id=folder_id)
    db.query(Folder).filter(Folder.id.in_(folder_ids)).update({"is_deleted": True}, synchronize_session=False)
    
    # 标记文件夹总结为已删除
    db.query(FolderSummary).filter(FolderSummary.folder_id.in_(folder_ids), FolderSummary.is_deleted == False).update(
        {"is_deleted": True}, synchronize_session=False
    )

    file_rows = db.query(File.id).filter(File.folder_id.in_(folder_ids), File.is_deleted == False).all()
    file_ids = [row[0] for row in file_rows]
    if file_ids:
        db.query(File).filter(File.id.in_(file_ids)).update({"is_deleted": True}, synchronize_session=False)
        db.query(DocumentSummary).filter(DocumentSummary.file_id.in_(file_ids), DocumentSummary.is_deleted == False).update(
            {"is_deleted": True}, synchronize_session=False
        )

        summary_rows = db.query(DocumentSummary.id).filter(DocumentSummary.file_id.in_(file_ids)).all()
        summary_ids = [row[0] for row in summary_rows]
        if summary_ids:
            index = index_manager.get_default_index()
            pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
            for summary_id in summary_ids:
                pipeline.delete_existing(db, summary_id)

    db.commit()
    return {"message": "Folder deleted successfully", "deleted_folders": len(folder_ids), "deleted_files": len(file_ids)}

# In MVP we skip full permission validation per folder.
