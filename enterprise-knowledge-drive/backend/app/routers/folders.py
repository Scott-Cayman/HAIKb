import json
import os
import shutil
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, HTTPException, UploadFile
from sqlalchemy.orm import Session
from typing import List, Optional, Set
from datetime import datetime
from pydantic import BaseModel, Field
from app.config import settings
from app.database import get_db
from app.models.document_summary import DocumentSummary
from app.models.folder import Folder
from app.models.folder_summary import FolderSummary
from app.models.file import File
from app.models.permission import FolderPermission
from app.models.setting import SystemSetting
from app.models.user import User
from app.dependencies.auth import get_current_user
from app.rag.index_manager import index_manager
from app.services.folder_access import (
    FOLDER_MANAGER_PERMISSION_TYPE,
    can_manage_folder_settings,
    can_view_folder,
    get_folder_manager_user_ids,
    get_user_specific_department,
    is_folder_manager,
    list_folder_manager_candidates,
    normalize_manager_user_ids,
)
from app.services.folder_summary_service import folder_summary_service

router = APIRouter()
HOME_PINNED_FOLDERS_SETTING_PREFIX = "home_pinned_folders:"

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None
    description: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cover_url: Optional[str] = None
    display_mode: Optional[str] = None
    icon_key: Optional[str] = None
    icon_bg_from: Optional[str] = None
    icon_bg_to: Optional[str] = None
    icon_color: Optional[str] = None
    card_bg_from: Optional[str] = None
    card_bg_via: Optional[str] = None
    card_bg_to: Optional[str] = None
    card_glow_color: Optional[str] = None

class FolderResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    description: Optional[str]
    created_by: Optional[int]
    cover_url: Optional[str] = None
    display_mode: str = "icon"
    icon_key: Optional[str] = None
    icon_bg_from: Optional[str] = None
    icon_bg_to: Optional[str] = None
    icon_color: Optional[str] = None
    card_bg_from: Optional[str] = None
    card_bg_via: Optional[str] = None
    card_bg_to: Optional[str] = None
    card_glow_color: Optional[str] = None
    sort_order: int = 0
    is_deleted: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    can_manage_settings: bool = False
    
    class Config:
        from_attributes = True


class FolderPermissionUserResponse(BaseModel):
    id: int
    name: str
    department_name: Optional[str] = None


class FolderPermissionContextResponse(BaseModel):
    is_super_admin: bool
    is_creator: bool
    is_manager: bool
    can_manage_settings: bool


class FolderSettingsResponse(BaseModel):
    folder: FolderResponse
    manager_users: List[FolderPermissionUserResponse] = Field(default_factory=list)
    candidate_users: List[FolderPermissionUserResponse] = Field(default_factory=list)
    permission_context: FolderPermissionContextResponse


class FolderSettingsUpdate(BaseModel):
    name: str
    description: Optional[str] = None
    cover_url: Optional[str] = None
    display_mode: str = "icon"
    icon_key: Optional[str] = None
    icon_bg_from: Optional[str] = None
    icon_bg_to: Optional[str] = None
    icon_color: Optional[str] = None
    card_bg_from: Optional[str] = None
    card_bg_via: Optional[str] = None
    card_bg_to: Optional[str] = None
    card_glow_color: Optional[str] = None
    manager_user_ids: List[int] = Field(default_factory=list)


class FolderSummaryResponse(BaseModel):
    folder_id: int
    summary_status: str
    summary_error: Optional[str] = None
    summary: Optional[str] = None
    summary_file_path: Optional[str] = None


class HomeFolderContextResponse(BaseModel):
    enterprise_root: FolderResponse
    center_folder: FolderResponse
    pinned_folders: List[FolderResponse] = Field(default_factory=list)
    pin_candidate_folders: List[FolderResponse] = Field(default_factory=list)


class HomePinnedFoldersUpdate(BaseModel):
    folder_ids: List[int] = Field(default_factory=list)


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


def _serialize_folder(folder: Folder, db: Session, current_user: User) -> FolderResponse:
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        description=folder.description,
        created_by=folder.created_by,
        cover_url=folder.cover_url,
        display_mode=folder.display_mode or "icon",
        icon_key=folder.icon_key,
        icon_bg_from=folder.icon_bg_from,
        icon_bg_to=folder.icon_bg_to,
        icon_color=folder.icon_color,
        card_bg_from=folder.card_bg_from,
        card_bg_via=folder.card_bg_via,
        card_bg_to=folder.card_bg_to,
        card_glow_color=folder.card_glow_color,
        sort_order=folder.sort_order,
        is_deleted=folder.is_deleted,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        can_manage_settings=can_manage_folder_settings(db, folder, current_user),
    )


def _serialize_user(user: User) -> FolderPermissionUserResponse:
    return FolderPermissionUserResponse(
        id=user.id,
        name=user.name,
        department_name=user.department_name,
    )


def _get_visible_root_folders(db: Session, current_user: User) -> List[Folder]:
    folders = (
        db.query(Folder)
        .filter(Folder.parent_id == None, Folder.is_deleted == False)
        .order_by(Folder.sort_order.asc(), Folder.id.asc())
        .all()
    )
    return [folder for folder in folders if can_view_folder(db, folder, current_user)]


def _select_home_center_folder(db: Session, current_user: User, visible_root_folders: List[Folder]) -> Optional[Folder]:
    if not visible_root_folders:
        return None

    user_department = get_user_specific_department(current_user)
    for folder in visible_root_folders:
        if folder.department_name == user_department:
            return folder

    for folder in visible_root_folders:
        if folder.created_by and folder.created_by == current_user.id:
            return folder

    return visible_root_folders[0]


def _get_home_pin_candidates(db: Session, center_folder: Folder, current_user: User) -> List[Folder]:
    folders = (
        db.query(Folder)
        .filter(Folder.parent_id == center_folder.id, Folder.is_deleted == False)
        .order_by(Folder.sort_order.asc(), Folder.id.asc())
        .all()
    )
    return [folder for folder in folders if can_view_folder(db, folder, current_user)]


def _load_home_pinned_folder_ids(db: Session, center_folder_id: int) -> List[int]:
    setting = (
        db.query(SystemSetting)
        .filter(SystemSetting.key == f"{HOME_PINNED_FOLDERS_SETTING_PREFIX}{center_folder_id}")
        .first()
    )
    if not setting:
        return []

    try:
        parsed = json.loads(setting.value)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    result: List[int] = []
    seen: Set[int] = set()
    for item in parsed:
        try:
            folder_id = int(item)
        except (TypeError, ValueError):
            continue
        if folder_id in seen:
            continue
        seen.add(folder_id)
        result.append(folder_id)
    return result


def _save_home_pinned_folder_ids(db: Session, center_folder_id: int, folder_ids: List[int]) -> None:
    setting_key = f"{HOME_PINNED_FOLDERS_SETTING_PREFIX}{center_folder_id}"
    setting = db.query(SystemSetting).filter(SystemSetting.key == setting_key).first()
    serialized_value = json.dumps(folder_ids, ensure_ascii=False)

    if setting is None:
        setting = SystemSetting(
            key=setting_key,
            value=serialized_value,
            description=f"首页中心目录 {center_folder_id} 的置顶子目录配置",
        )
        db.add(setting)
    else:
        setting.value = serialized_value
        setting.description = f"首页中心目录 {center_folder_id} 的置顶子目录配置"


def _build_home_folder_context(
    db: Session,
    current_user: User,
    center_folder: Optional[Folder] = None,
) -> HomeFolderContextResponse:
    visible_root_folders = _get_visible_root_folders(db, current_user)
    selected_center_folder = center_folder or _select_home_center_folder(db, current_user, visible_root_folders)
    if not selected_center_folder:
        raise HTTPException(status_code=404, detail="未找到当前用户可访问的首页中心目录")

    pin_candidates = _get_home_pin_candidates(db, selected_center_folder, current_user)
    pin_candidate_map = {folder.id: folder for folder in pin_candidates}
    pinned_folder_ids = _load_home_pinned_folder_ids(db, selected_center_folder.id)
    pinned_folders = [
        pin_candidate_map[folder_id]
        for folder_id in pinned_folder_ids
        if folder_id in pin_candidate_map
    ]

    if not pinned_folders:
        pinned_folders = pin_candidates[:6]

    return HomeFolderContextResponse(
        enterprise_root=_serialize_folder(selected_center_folder, db, current_user),
        center_folder=_serialize_folder(selected_center_folder, db, current_user),
        pinned_folders=[_serialize_folder(folder, db, current_user) for folder in pinned_folders],
        pin_candidate_folders=[_serialize_folder(folder, db, current_user) for folder in pin_candidates],
    )


@router.get("", response_model=List[FolderResponse])
def get_folders(parent_id: Optional[int] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Folder).filter(Folder.is_deleted == False)
    if parent_id is not None:
        query = query.filter(Folder.parent_id == parent_id)
    else:
        query = query.filter(Folder.parent_id == None)

    folders = query.order_by(Folder.sort_order.asc(), Folder.id.desc()).all()
    return [
        _serialize_folder(folder, db, current_user)
        for folder in folders
        if can_view_folder(db, folder, current_user)
    ]

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
        department_name = get_user_specific_department(current_user)
    else:
        # 子文件夹：继承父文件夹的部门信息
        if parent_folder:
            department_name = parent_folder.department_name
            is_super_admin_created = parent_folder.is_super_admin_created
    
    db_folder = Folder(
        name=folder.name,
        parent_id=folder.parent_id,
        description=folder.description,
        display_mode="icon",
        icon_key="book-open",
        icon_bg_from="#8cf3d5",
        icon_bg_to="#44d7cc",
        icon_color="#ffffff",
        card_bg_from="#ebfff7",
        card_bg_via="#d8fff3",
        card_bg_to="#c1f7ec",
        card_glow_color="#ffffff",
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
    
    return _serialize_folder(db_folder, db, current_user)


@router.get("/home-context", response_model=HomeFolderContextResponse)
def get_home_folder_context(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_home_folder_context(db, current_user)


@router.put("/{folder_id}/home-pinned-folders", response_model=HomeFolderContextResponse)
def update_home_pinned_folders(
    folder_id: int,
    payload: HomePinnedFoldersUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    center_folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not center_folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not can_manage_folder_settings(db, center_folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    pin_candidates = _get_home_pin_candidates(db, center_folder, current_user)
    pin_candidate_ids = {folder.id for folder in pin_candidates}
    next_folder_ids = [folder_id for folder_id in payload.folder_ids if folder_id in pin_candidate_ids]
    _save_home_pinned_folder_ids(db, center_folder.id, next_folder_ids)
    db.commit()
    return _build_home_folder_context(db, current_user, center_folder=center_folder)


@router.get("/{folder_id}", response_model=FolderResponse)
def get_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # 权限检查
    if not can_view_folder(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    return _serialize_folder(folder, db, current_user)


@router.get("/{folder_id}/summary", response_model=FolderSummaryResponse)
def get_folder_summary(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # 权限检查
    if not can_view_folder(db, folder, current_user):
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


@router.get("/{folder_id}/settings", response_model=FolderSettingsResponse)
def get_folder_settings(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not can_manage_folder_settings(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    manager_user_ids = get_folder_manager_user_ids(db, folder.id)
    manager_users = (
        db.query(User)
        .filter(User.id.in_(manager_user_ids), User.is_active == True)
        .order_by(User.name.asc())
        .all()
        if manager_user_ids
        else []
    )
    candidate_users = list_folder_manager_candidates(db, folder, current_user)

    return FolderSettingsResponse(
        folder=_serialize_folder(folder, db, current_user),
        manager_users=[_serialize_user(user) for user in manager_users],
        candidate_users=[_serialize_user(user) for user in candidate_users],
        permission_context=FolderPermissionContextResponse(
            is_super_admin=current_user.is_super_admin,
            is_creator=bool(folder.created_by and folder.created_by == current_user.id),
            is_manager=is_folder_manager(db, folder.id, current_user.id),
            can_manage_settings=True,
        ),
    )


@router.put("/{folder_id}/settings", response_model=FolderSettingsResponse)
def update_folder_settings(
    folder_id: int,
    payload: FolderSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not can_manage_folder_settings(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    next_name = payload.name.strip()
    if not next_name:
        raise HTTPException(status_code=400, detail="name required")

    candidate_users = list_folder_manager_candidates(db, folder, current_user)
    candidate_user_ids = {user.id for user in candidate_users}
    next_manager_ids = normalize_manager_user_ids(payload.manager_user_ids, folder.created_by)
    invalid_user_ids = [user_id for user_id in next_manager_ids if user_id not in candidate_user_ids]
    if invalid_user_ids:
        raise HTTPException(status_code=400, detail="包含不可分配的文件夹管理者")

    folder.name = next_name
    folder.description = payload.description.strip() if payload.description else None
    folder.cover_url = payload.cover_url.strip() if payload.cover_url else None
    folder.display_mode = (payload.display_mode or "icon").strip() or "icon"
    folder.icon_key = (payload.icon_key or "book-open").strip() or "book-open"
    folder.icon_bg_from = (payload.icon_bg_from or "#8cf3d5").strip() or "#8cf3d5"
    folder.icon_bg_to = (payload.icon_bg_to or "#44d7cc").strip() or "#44d7cc"
    folder.icon_color = (payload.icon_color or "#ffffff").strip() or "#ffffff"
    folder.card_bg_from = (payload.card_bg_from or "#ebfff7").strip() or "#ebfff7"
    folder.card_bg_via = (payload.card_bg_via or "#d8fff3").strip() or "#d8fff3"
    folder.card_bg_to = (payload.card_bg_to or "#c1f7ec").strip() or "#c1f7ec"
    folder.card_glow_color = (payload.card_glow_color or "#ffffff").strip() or "#ffffff"

    db.query(FolderPermission).filter(
        FolderPermission.folder_id == folder.id,
        FolderPermission.permission_type == FOLDER_MANAGER_PERMISSION_TYPE,
    ).delete(synchronize_session=False)

    for user_id in next_manager_ids:
        db.add(
            FolderPermission(
                folder_id=folder.id,
                permission_type=FOLDER_MANAGER_PERMISSION_TYPE,
                target_id=str(user_id),
            )
        )

    db.commit()
    db.refresh(folder)
    return get_folder_settings(folder_id=folder.id, db=db, current_user=current_user)


@router.post("/{folder_id}/cover-upload")
async def upload_folder_cover(
    folder_id: int,
    file: UploadFile = FastAPIFile(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not can_manage_folder_settings(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    content_type = file.content_type or ""
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持上传图片文件")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    stored_name = f"folder-cover-{folder_id}-{uuid.uuid4().hex}{ext}"
    cover_dir = os.path.join(settings.STORAGE_DIR, "covers")
    os.makedirs(cover_dir, exist_ok=True)
    storage_path = os.path.join(cover_dir, stored_name)

    with open(storage_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    folder.cover_url = f"/covers/{stored_name}"
    folder.display_mode = "cover"
    db.commit()
    db.refresh(folder)
    return {
        "cover_url": folder.cover_url,
        "display_mode": folder.display_mode,
    }


@router.patch("/{folder_id}", response_model=FolderResponse)
def update_folder(folder_id: int, payload: FolderUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # 权限检查
    if not can_manage_folder_settings(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

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
    if "display_mode" in payload_fields:
        folder.display_mode = (payload.display_mode or "icon").strip() or "icon"
    if "icon_key" in payload_fields:
        folder.icon_key = (payload.icon_key or "book-open").strip() or "book-open"
    if "icon_bg_from" in payload_fields:
        folder.icon_bg_from = (payload.icon_bg_from or "#8cf3d5").strip() or "#8cf3d5"
    if "icon_bg_to" in payload_fields:
        folder.icon_bg_to = (payload.icon_bg_to or "#44d7cc").strip() or "#44d7cc"
    if "icon_color" in payload_fields:
        folder.icon_color = (payload.icon_color or "#ffffff").strip() or "#ffffff"
    if "card_bg_from" in payload_fields:
        folder.card_bg_from = (payload.card_bg_from or "#ebfff7").strip() or "#ebfff7"
    if "card_bg_via" in payload_fields:
        folder.card_bg_via = (payload.card_bg_via or "#d8fff3").strip() or "#d8fff3"
    if "card_bg_to" in payload_fields:
        folder.card_bg_to = (payload.card_bg_to or "#c1f7ec").strip() or "#c1f7ec"
    if "card_glow_color" in payload_fields:
        folder.card_glow_color = (payload.card_glow_color or "#ffffff").strip() or "#ffffff"

    db.commit()
    db.refresh(folder)
    return _serialize_folder(folder, db, current_user)

@router.delete("/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # 权限检查
    if not can_manage_folder_settings(db, folder, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")
    
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
