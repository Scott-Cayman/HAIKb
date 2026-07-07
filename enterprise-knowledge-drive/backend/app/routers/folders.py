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
    cover_url: Optional[str] = None

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


def _get_user_specific_department(user: User) -> Optional[str]:
    """获取用户的具体部门（优先匹配 跨界营销中心、创意部 等关键部门）"""
    # 从完整部门路径中查找关键部门
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    # 如果找不到关键部门，使用用户的部门名称
    return user.department_name


@router.get("", response_model=List[FolderResponse])
def get_folders(parent_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Folder).filter(Folder.is_deleted == False)
    if parent_id is not None:
        query = query.filter(Folder.parent_id == parent_id)
    else:
        query = query.filter(Folder.parent_id == None)
    
    # 权限检查：
    # 1. 超级管理员可以查看所有文件夹
    # 2. 普通用户只能查看：
    #    - 由超级管理员创建的文件夹（is_super_admin_created=True）
    #    - 同部门用户创建的文件夹（department_name匹配）
    if not current_user.is_super_admin:
        user_department = _get_user_specific_department(current_user)
        from sqlalchemy import or_
        query = query.filter(
            or_(
                Folder.is_super_admin_created == True,
                Folder.department_name == user_department
            )
        )
    
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
    
    # 确定部门信息：
    # 如果是根文件夹（parent_id为None），使用当前用户的具体部门信息
    # 如果是子文件夹，继承父文件夹的部门信息
    department_name = None
    is_super_admin_created = current_user.is_super_admin
    
    if folder.parent_id is None:
        # 一级文件夹：使用当前用户的具体部门
        department_name = _get_user_specific_department(current_user)
    else:
        # 子文件夹：继承父文件夹的部门信息
        if parent_folder:
            department_name = parent_folder.department_name
            is_super_admin_created = parent_folder.is_super_admin_created
    
    db_folder = Folder(
        name=folder.name,
        parent_id=folder.parent_id,
        description=folder.description,
        created_by=current_user.id,
        department_name=department_name,
        is_super_admin_created=is_super_admin_created
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

def _check_folder_permission(folder: Folder, current_user: User) -> bool:
    """检查用户是否有访问文件夹的权限"""
    if current_user.is_super_admin:
        return True
    # 普通用户检查
    user_department = _get_user_specific_department(current_user)
    return folder.is_super_admin_created or folder.department_name == user_department


@router.get("/{folder_id}", response_model=FolderResponse)
def get_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # 权限检查
    if not _check_folder_permission(folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    return folder


@router.get("/{folder_id}/summary", response_model=FolderSummaryResponse)
def get_folder_summary(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # 权限检查
    if not _check_folder_permission(folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")

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
    
    # 权限检查
    if not _check_folder_permission(folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")

    payload_fields = getattr(payload, "model_fields_set", getattr(payload, "__fields_set__", set()))

    if "name" in payload_fields:
        new_name = (payload.name or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name required")
        folder.name = new_name
    if "description" in payload_fields:
        folder.description = payload.description.strip() if payload.description else None
    if "cover_url" in payload_fields:
        folder.cover_url = payload.cover_url.strip() if payload.cover_url else None

    db.commit()
    db.refresh(folder)
    return folder

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # 权限检查
    if not _check_folder_permission(folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    
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
