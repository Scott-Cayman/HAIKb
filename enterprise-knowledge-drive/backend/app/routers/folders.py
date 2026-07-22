import json
import io
import os
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from typing import Dict, List, Optional, Set
from datetime import datetime
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError
from app.config import settings
from app.database import get_db
from app.models.document_summary import DocumentSummary
from app.models.folder import Folder
from app.models.folder_summary import FolderSummary
from app.models.file import File
from app.models.permission import FolderPermission
from app.models.resource_permission import ResourcePermission
from app.models.setting import SystemSetting
from app.models.user import User
from app.dependencies.auth import get_current_user
from app.rag.index_manager import index_manager
from app.services.folder_access import (
    FOLDER_MANAGER_PERMISSION_TYPE,
    get_folder_manager_user_ids,
    get_user_specific_department,
    is_folder_manager,
    list_folder_manager_candidates,
    normalize_manager_user_ids,
    user_belongs_to_department,
)
from app.services.resource_access import (
    CAPABILITY_DELETE,
    CAPABILITY_DOWNLOAD,
    CAPABILITY_EDIT,
    CAPABILITY_UPLOAD,
    CAPABILITY_VIEW,
    LEGACY_SUBJECT_TYPE_DEPARTMENT,
    RESOURCE_TYPE_FOLDER,
    SUBJECT_TYPE_ALL,
    SUBJECT_TYPE_ORG,
    SUBJECT_TYPE_USER,
    get_file_capabilities,
    get_folder_capabilities,
    list_visible_folders,
)
from app.services.audit_log_service import record_audit_log
from app.services.folder_summary_service import folder_summary_service
from app.services.resource_move_service import (
    ResourceMoveError,
    build_folder_paths,
    collect_descendant_folder_ids,
    get_folder_root_id,
    move_folder,
    refresh_folder_summaries_after_move,
)
from app.services.upload_folder_service import (
    ensure_upload_folder_parts,
    normalize_upload_folder_parts,
)

router = APIRouter()
HOME_PINNED_FOLDERS_SETTING_PREFIX = "home_pinned_folders:"
MAX_FOLDER_COVER_BYTES = 5 * 1024 * 1024
MAX_FOLDER_COVER_PIXELS = 40_000_000
FOLDER_COVER_EXTENSIONS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
}


def _normalize_folder_name(value: str) -> str:
    name = (value or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")
    if name in {".", ".."} or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="文件夹名称不能包含路径分隔符")
    return name


def _ensure_unique_folder_name(
    db: Session,
    name: str,
    parent_id: Optional[int],
    exclude_folder_id: Optional[int] = None,
) -> None:
    query = db.query(Folder.id).filter(
        Folder.name == name,
        Folder.parent_id == parent_id,
        Folder.is_deleted == False,
    )
    if exclude_folder_id is not None:
        query = query.filter(Folder.id != exclude_folder_id)
    if query.first():
        raise HTTPException(status_code=409, detail="当前目录已存在同名文件夹")

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
    capabilities: Dict[str, bool] = Field(default_factory=dict)
    
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


class ResourcePermissionRulePayload(BaseModel):
    subject_type: str
    subject_value: Optional[str] = None


class ResourcePermissionRuleResponse(BaseModel):
    capability: str
    subject_type: str
    subject_value: Optional[str] = None


class PermissionInheritanceSource(BaseModel):
    folder_id: int
    folder_name: str


class FolderSettingsResponse(BaseModel):
    folder: FolderResponse
    manager_users: List[FolderPermissionUserResponse] = Field(default_factory=list)
    candidate_users: List[FolderPermissionUserResponse] = Field(default_factory=list)
    available_org_units: List[str] = Field(default_factory=list)
    permission_rules: List[ResourcePermissionRuleResponse] = Field(default_factory=list)
    effective_permission_rules: List[ResourcePermissionRuleResponse] = Field(default_factory=list)
    permission_inheritance: Dict[str, Optional[PermissionInheritanceSource]] = Field(default_factory=dict)
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
    view_rules: List[ResourcePermissionRulePayload] = Field(default_factory=list)
    download_rules: List[ResourcePermissionRulePayload] = Field(default_factory=list)
    edit_rules: List[ResourcePermissionRulePayload] = Field(default_factory=list)
    upload_rules: List[ResourcePermissionRulePayload] = Field(default_factory=list)
    delete_rules: List[ResourcePermissionRulePayload] = Field(default_factory=list)


class FolderSummaryResponse(BaseModel):
    folder_id: int
    summary_status: str
    summary_error: Optional[str] = None
    summary: Optional[str] = None
    summary_file_path: Optional[str] = None


class HomeFolderContextResponse(BaseModel):
    root_folders: List[FolderResponse] = Field(default_factory=list)
    enterprise_root: FolderResponse
    center_folder: FolderResponse
    pinned_folders: List[FolderResponse] = Field(default_factory=list)
    pin_candidate_folders: List[FolderResponse] = Field(default_factory=list)


class HomePinnedFoldersUpdate(BaseModel):
    folder_ids: List[int] = Field(default_factory=list)


class EnsureUploadFolderPathsPayload(BaseModel):
    parent_id: int
    paths: List[str] = Field(default_factory=list)


class EnsureUploadFolderPathsResponse(BaseModel):
    created_folder_ids: List[int] = Field(default_factory=list)
    reused_folder_ids: List[int] = Field(default_factory=list)
    folder_ids_by_path: Dict[str, int] = Field(default_factory=dict)


class ResourceMoveRequest(BaseModel):
    target_folder_id: int


class ResourceMoveResponse(BaseModel):
    resource_type: str
    resource_id: int
    old_parent_id: int
    target_folder_id: int
    target_path: str


class MoveTargetResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int]
    path: str
    depth: int
    can_select: bool
    disabled_reason: Optional[str] = None


class MoveTargetsResponse(BaseModel):
    root_folder_id: int
    targets: List[MoveTargetResponse] = Field(default_factory=list)


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
    capabilities = get_folder_capabilities(db, folder, current_user)
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
        can_manage_settings=capabilities.can_manage_settings,
        capabilities=capabilities.to_dict(),
    )


def _serialize_user(user: User) -> FolderPermissionUserResponse:
    return FolderPermissionUserResponse(
        id=user.id,
        name=user.name,
        department_name=user.department_name,
    )


def _collect_available_org_units(db: Session) -> List[str]:
    directory_setting = db.query(SystemSetting).filter(SystemSetting.key == "dingtalk_directory_tree").first()
    if directory_setting:
        try:
            payload = json.loads(directory_setting.value)
        except (TypeError, json.JSONDecodeError):
            payload = {}
        units = set()
        for item in payload.get("departments", []) if isinstance(payload, dict) else []:
            if not isinstance(item, dict) or item.get("parent_id") is None:
                continue
            scope_path = (item.get("scope_path") or "").strip()
            if not scope_path:
                full_path = (item.get("path") or "").strip()
                scope_path = full_path.split("/", 1)[1] if "/" in full_path else (item.get("name") or "").strip()
            if scope_path:
                units.add(scope_path)
        if units:
            return sorted(units)

    rows = (
        db.query(User.full_department_path)
        .filter(User.is_active == True, User.full_department_path != None)
        .all()
    )
    units: Set[str] = set()
    for row in rows:
        path_value = row[0] or ""
        parts = [part.strip() for part in path_value.split("/") if part.strip()]
        prefix: List[str] = []
        for part in parts:
            prefix.append(part)
            units.add("/".join(prefix))
            units.add(part)
    return sorted(units)


def _normalize_permission_rules(
    rules: List[ResourcePermissionRulePayload],
    capability: str,
) -> List[ResourcePermission]:
    normalized_rules: List[ResourcePermission] = []
    seen: Set[tuple[str, Optional[str]]] = set()
    for rule in rules:
        subject_type = (rule.subject_type or "").strip()
        subject_value = rule.subject_value.strip() if rule.subject_value else None
        if subject_type not in {SUBJECT_TYPE_ALL, SUBJECT_TYPE_ORG, SUBJECT_TYPE_USER}:
            raise HTTPException(status_code=400, detail="包含不支持的权限主体类型")
        if subject_type == SUBJECT_TYPE_ALL:
            subject_value = None
        elif not subject_value:
            raise HTTPException(status_code=400, detail="权限主体缺少 subject_value")
        dedupe_key = (subject_type, subject_value)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        normalized_rules.append(
            ResourcePermission(
                resource_type=RESOURCE_TYPE_FOLDER,
                resource_id=0,
                action=capability,
                capability=capability,
                subject_type=subject_type,
                subject_value=subject_value,
                inherit_to_children=True,
            )
        )
    return normalized_rules


def _load_folder_permission_rules(db: Session, folder_id: int) -> List[ResourcePermissionRuleResponse]:
    rows = (
        db.query(ResourcePermission)
        .filter(
            ResourcePermission.resource_type == RESOURCE_TYPE_FOLDER,
            ResourcePermission.resource_id == folder_id,
        )
        .order_by(ResourcePermission.capability.asc(), ResourcePermission.subject_type.asc(), ResourcePermission.id.asc())
        .all()
    )
    return [
        ResourcePermissionRuleResponse(
            capability=row.capability,
            subject_type=(
                SUBJECT_TYPE_ORG
                if row.subject_type == LEGACY_SUBJECT_TYPE_DEPARTMENT
                else row.subject_type
            ),
            subject_value=row.subject_value,
        )
        for row in rows
    ]


def _load_effective_folder_permission_rules(
    db: Session,
    folder: Folder,
) -> tuple[List[ResourcePermissionRuleResponse], Dict[str, Optional[PermissionInheritanceSource]]]:
    effective: List[ResourcePermissionRuleResponse] = []
    inheritance: Dict[str, Optional[PermissionInheritanceSource]] = {}
    ancestors = list(reversed(_collect_folder_ancestors(db, folder)))

    for capability in (
        CAPABILITY_VIEW,
        CAPABILITY_DOWNLOAD,
        CAPABILITY_EDIT,
        CAPABILITY_UPLOAD,
        CAPABILITY_DELETE,
    ):
        source_folder: Optional[Folder] = None
        rows = (
            db.query(ResourcePermission)
            .filter(
                ResourcePermission.resource_type == RESOURCE_TYPE_FOLDER,
                ResourcePermission.resource_id == folder.id,
                ResourcePermission.capability == capability,
            )
            .all()
        )
        if rows:
            source_folder = folder
        else:
            for ancestor in ancestors:
                rows = (
                    db.query(ResourcePermission)
                    .filter(
                        ResourcePermission.resource_type == RESOURCE_TYPE_FOLDER,
                        ResourcePermission.resource_id == ancestor.id,
                        ResourcePermission.capability == capability,
                        ResourcePermission.inherit_to_children == True,
                    )
                    .all()
                )
                if rows:
                    source_folder = ancestor
                    break

        inheritance[capability] = (
            None
            if source_folder is None or source_folder.id == folder.id
            else PermissionInheritanceSource(folder_id=source_folder.id, folder_name=source_folder.name)
        )
        for row in rows:
            effective.append(
                ResourcePermissionRuleResponse(
                    capability=row.capability,
                    subject_type=(SUBJECT_TYPE_ORG if row.subject_type == LEGACY_SUBJECT_TYPE_DEPARTMENT else row.subject_type),
                    subject_value=row.subject_value,
                )
            )

    return effective, inheritance


def _get_visible_root_folders(db: Session, current_user: User) -> List[Folder]:
    folders = (
        db.query(Folder)
        .filter(Folder.parent_id == None, Folder.is_deleted == False)
        .order_by(Folder.sort_order.asc(), Folder.id.asc())
        .all()
    )
    return list_visible_folders(db, folders, current_user)


def _select_home_center_folder(db: Session, current_user: User, visible_root_folders: List[Folder]) -> Optional[Folder]:
    if not visible_root_folders:
        return None

    # Department centers live directly below the enterprise root. Select a
    # visible department center before considering stand-alone root folders;
    # otherwise stale department metadata on a shared root (for example the
    # company policy library) can send the user to the wrong home directory.
    direct_children = (
        db.query(Folder)
        .filter(
            Folder.parent_id.in_([folder.id for folder in visible_root_folders]),
            Folder.is_deleted == False,
        )
        .order_by(Folder.sort_order.asc(), Folder.id.asc())
        .all()
    )
    visible_children = list_visible_folders(db, direct_children, current_user)
    for folder in visible_children:
        if user_belongs_to_department(current_user, folder.department_name):
            return folder
    if len(visible_children) == 1:
        return visible_children[0]

    user_department = get_user_specific_department(current_user)
    for folder in visible_root_folders:
        if folder.department_name == user_department:
            return folder

    for folder in visible_root_folders:
        if folder.created_by and folder.created_by == current_user.id:
            return folder

    return visible_root_folders[0]


def _get_home_pin_candidates(db: Session, center_folder: Folder, current_user: User) -> List[Folder]:
    ancestors = _collect_folder_ancestors(db, center_folder)
    if len(ancestors) > 1:
        return []
    folders = (
        db.query(Folder)
        .filter(Folder.parent_id == center_folder.id, Folder.is_deleted == False)
        .order_by(Folder.sort_order.asc(), Folder.id.asc())
        .all()
    )
    return list_visible_folders(db, folders, current_user)


def _collect_folder_ancestors(db: Session, folder: Folder) -> List[Folder]:
    ancestors: List[Folder] = []
    current_parent_id = folder.parent_id
    visited: Set[int] = set()

    while current_parent_id and current_parent_id not in visited:
        visited.add(current_parent_id)
        parent_folder = (
            db.query(Folder)
            .filter(Folder.id == current_parent_id, Folder.is_deleted == False)
            .first()
        )
        if not parent_folder:
            break
        ancestors.append(parent_folder)
        current_parent_id = parent_folder.parent_id

    ancestors.reverse()
    return ancestors


def _is_home_pin_scope_folder(db: Session, folder: Folder) -> bool:
    return len(_collect_folder_ancestors(db, folder)) <= 1


def _resolve_home_pin_scope_folder(db: Session, folder: Folder) -> Folder:
    ancestors = _collect_folder_ancestors(db, folder)
    if len(ancestors) <= 1:
        return folder
    return ancestors[1]


def _resolve_enterprise_root_folder(db: Session, folder: Folder) -> Folder:
    ancestors = _collect_folder_ancestors(db, folder)
    if not ancestors:
        return folder
    return ancestors[0]


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
    root_folder_id: Optional[int] = None,
) -> HomeFolderContextResponse:
    visible_root_folders = _get_visible_root_folders(db, current_user)
    if center_folder is not None:
        selected_center_folder = center_folder
    elif root_folder_id is not None:
        selected_center_folder = next((folder for folder in visible_root_folders if folder.id == root_folder_id), None)
        if selected_center_folder is None:
            raise HTTPException(status_code=404, detail="未找到可访问的根目录")
    else:
        selected_center_folder = _select_home_center_folder(db, current_user, visible_root_folders)
    if not selected_center_folder:
        raise HTTPException(status_code=404, detail="未找到当前用户可访问的首页中心目录")

    # The pin scope is always the enterprise root or its direct child. Deeper
    # folders inherit the direct center's pinned configuration.
    selected_center_folder = _resolve_home_pin_scope_folder(db, selected_center_folder)

    pin_candidates = _get_home_pin_candidates(db, selected_center_folder, current_user)
    pin_candidate_map = {folder.id: folder for folder in pin_candidates}
    pinned_folder_ids = _load_home_pinned_folder_ids(db, selected_center_folder.id)
    if selected_center_folder.parent_id is None and not pinned_folder_ids:
        pinned_folder_ids = [folder.id for folder in pin_candidates]
    pinned_folders = [
        pin_candidate_map[folder_id]
        for folder_id in pinned_folder_ids
        if folder_id in pin_candidate_map
    ]

    enterprise_root_folder = _resolve_enterprise_root_folder(db, selected_center_folder)

    return HomeFolderContextResponse(
        root_folders=[_serialize_folder(folder, db, current_user) for folder in visible_root_folders],
        enterprise_root=_serialize_folder(enterprise_root_folder, db, current_user),
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
        if get_folder_capabilities(db, folder, current_user).can_view
    ]

@router.post("", response_model=FolderResponse)
def create_folder(
    folder: FolderCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder_name = _normalize_folder_name(folder.name)
    parent_folder: Optional[Folder] = None

    if folder.parent_id is not None:
        parent_folder = db.query(Folder).filter(Folder.id == folder.parent_id, Folder.is_deleted == False).first()
        if not parent_folder:
            raise HTTPException(status_code=404, detail="父文件夹不存在")
        if not get_folder_capabilities(db, parent_folder, current_user).can_upload:
            raise HTTPException(status_code=403, detail="您没有在此目录中新建文件夹的权限")
    elif not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以新建根目录")

    _ensure_unique_folder_name(db, folder_name, folder.parent_id)
    
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
        name=folder_name,
        parent_id=folder.parent_id,
        description=folder.description,
        display_mode="icon",
        icon_key="folder",
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
    db.flush()
    record_audit_log(
        db,
        current_user,
        "folder.create",
        "folder",
        db_folder.id,
        request=request,
        detail={"name": db_folder.name, "parent_id": db_folder.parent_id},
    )
    db.commit()
    db.refresh(db_folder)
    
    # 只有一级文件夹（parent_id为None）才创建初始总结文档
    if folder.parent_id is None:
        background_tasks.add_task(folder_summary_service.create_initial_folder_summary, db_folder.id)
    else:
        # 如果是二级文件夹，更新父文件夹的总结
        background_tasks.add_task(folder_summary_service.update_folder_summary, folder.parent_id)
    
    return _serialize_folder(db_folder, db, current_user)


@router.post("/ensure-upload-paths", response_model=EnsureUploadFolderPathsResponse)
def ensure_upload_folder_paths(
    payload: EnsureUploadFolderPathsPayload,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(payload.paths) > 1000:
        raise HTTPException(status_code=400, detail="单次最多创建 1000 个上传目录")

    normalized_paths: Dict[str, List[str]] = {}
    for path in payload.paths:
        folder_parts = normalize_upload_folder_parts(path, includes_filename=False)
        if folder_parts:
            normalized_path = "/".join(folder_parts)
            normalized_paths[normalized_path] = folder_parts

    ordered_paths = sorted(
        normalized_paths.items(),
        key=lambda item: (len(item[1]), item[0]),
    )
    created_folder_ids: Set[int] = set()
    reused_folder_ids: Set[int] = set()
    folder_ids_by_path: Dict[str, int] = {}

    try:
        for normalized_path, folder_parts in ordered_paths:
            result = ensure_upload_folder_parts(
                folder_parts,
                payload.parent_id,
                db,
                current_user,
                request=request,
                audit_source="folder_upload",
            )
            created_folder_ids.update(result.created_folder_ids)
            reused_folder_ids.update(result.reused_folder_ids)
            if result.folder_id is not None:
                folder_ids_by_path[normalized_path] = result.folder_id
        db.commit()
    except Exception:
        db.rollback()
        raise

    if created_folder_ids:
        background_tasks.add_task(folder_summary_service.update_folder_summary, payload.parent_id)

    return EnsureUploadFolderPathsResponse(
        created_folder_ids=sorted(created_folder_ids),
        reused_folder_ids=sorted(reused_folder_ids - created_folder_ids),
        folder_ids_by_path=folder_ids_by_path,
    )


@router.get("/home-context", response_model=HomeFolderContextResponse)
def get_home_folder_context(
    root_folder_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _build_home_folder_context(db, current_user, root_folder_id=root_folder_id)


@router.get("/move-targets", response_model=MoveTargetsResponse)
def get_move_targets(
    resource_type: str,
    resource_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if resource_type not in {"file", "folder"}:
        raise HTTPException(status_code=400, detail="resource_type 必须是 file 或 folder")

    excluded_folder_ids: Set[int] = set()
    if resource_type == "folder":
        resource_folder = db.query(Folder).filter(
            Folder.id == resource_id,
            Folder.is_deleted == False,
        ).first()
        if not resource_folder:
            raise HTTPException(status_code=404, detail="文件夹不存在")
        if resource_folder.parent_id is None:
            raise HTTPException(status_code=400, detail="根目录不能移动")
        if not get_folder_capabilities(db, resource_folder, current_user).can_move:
            raise HTTPException(status_code=403, detail="您没有移动此文件夹的权限")
        source_folder = resource_folder
        current_parent_id = resource_folder.parent_id
        excluded_folder_ids = set(collect_descendant_folder_ids(db, resource_folder.id))
    else:
        resource_file = db.query(File).filter(
            File.id == resource_id,
            File.is_deleted == False,
        ).first()
        if not resource_file:
            raise HTTPException(status_code=404, detail="文件不存在")
        if not get_file_capabilities(db, resource_file, current_user).can_move:
            raise HTTPException(status_code=403, detail="您没有移动此文件的权限")
        if resource_file.folder_id is None:
            raise HTTPException(status_code=400, detail="未归属目录的文件暂不支持移动")
        source_folder = db.query(Folder).filter(
            Folder.id == resource_file.folder_id,
            Folder.is_deleted == False,
        ).first()
        if not source_folder:
            raise HTTPException(status_code=409, detail="文件的原目录不存在")
        current_parent_id = resource_file.folder_id

    try:
        root_folder_id = get_folder_root_id(db, source_folder)
    except ResourceMoveError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    active_folders = db.query(Folder).filter(Folder.is_deleted == False).all()
    same_root_folders: List[Folder] = []
    for target in active_folders:
        try:
            if get_folder_root_id(db, target) == root_folder_id:
                same_root_folders.append(target)
        except ResourceMoveError:
            continue

    paths = build_folder_paths(db, same_root_folders)
    targets: List[MoveTargetResponse] = []
    for target in same_root_folders:
        capabilities = get_folder_capabilities(db, target, current_user)
        if not capabilities.can_view:
            continue
        disabled_reason: Optional[str] = None
        if target.id == current_parent_id:
            disabled_reason = "当前所在目录"
        elif target.id in excluded_folder_ids:
            disabled_reason = "不能移动到自身或子目录"
        elif not capabilities.can_upload:
            disabled_reason = "没有写入权限"
        targets.append(
            MoveTargetResponse(
                id=target.id,
                name=target.name,
                parent_id=target.parent_id,
                path=paths[target.id],
                depth=max(0, paths[target.id].count(" / ")),
                can_select=disabled_reason is None,
                disabled_reason=disabled_reason,
            )
        )

    targets.sort(key=lambda item: (item.path.casefold(), item.id))
    return MoveTargetsResponse(root_folder_id=root_folder_id, targets=targets)


@router.get("/{folder_id}/home-pinned-folders-context", response_model=HomeFolderContextResponse)
def get_folder_home_pinned_context(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not get_folder_capabilities(db, folder, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    return _build_home_folder_context(db, current_user, center_folder=folder)


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
    if not _is_home_pin_scope_folder(db, center_folder):
        raise HTTPException(status_code=400, detail="Only enterprise root and first-level folders can configure pinned folders")
    if not get_folder_capabilities(db, center_folder, current_user).can_manage_settings:
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
    if not get_folder_capabilities(db, folder, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    return _serialize_folder(folder, db, current_user)


@router.get("/{folder_id}/summary", response_model=FolderSummaryResponse)
def get_folder_summary(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    # 权限检查
    if not get_folder_capabilities(db, folder, current_user).can_view:
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
    if not get_folder_capabilities(db, folder, current_user).can_manage_settings:
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
    available_org_units = _collect_available_org_units(db)
    effective_rules, permission_inheritance = _load_effective_folder_permission_rules(db, folder)

    return FolderSettingsResponse(
        folder=_serialize_folder(folder, db, current_user),
        manager_users=[_serialize_user(user) for user in manager_users],
        candidate_users=[_serialize_user(user) for user in candidate_users],
        available_org_units=available_org_units,
        permission_rules=_load_folder_permission_rules(db, folder.id),
        effective_permission_rules=effective_rules,
        permission_inheritance=permission_inheritance,
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
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if not get_folder_capabilities(db, folder, current_user).can_manage_settings:
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    next_name = _normalize_folder_name(payload.name)
    _ensure_unique_folder_name(db, next_name, folder.parent_id, exclude_folder_id=folder.id)

    candidate_users = list_folder_manager_candidates(db, folder, current_user)
    candidate_user_ids = {user.id for user in candidate_users}
    next_manager_ids = normalize_manager_user_ids(payload.manager_user_ids, folder.created_by)
    invalid_user_ids = [user_id for user_id in next_manager_ids if user_id not in candidate_user_ids]
    if invalid_user_ids:
        raise HTTPException(status_code=400, detail="包含不可分配的文件夹管理者")

    for rule in (
        payload.view_rules
        + payload.download_rules
        + payload.edit_rules
        + payload.upload_rules
        + payload.delete_rules
    ):
        if (rule.subject_type or "").strip() == SUBJECT_TYPE_USER:
            try:
                subject_user_id = int(rule.subject_value or "0")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="用户权限规则格式不正确") from exc
            if subject_user_id not in candidate_user_ids:
                raise HTTPException(status_code=400, detail="包含不可分配的用户权限对象")

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

    db.query(ResourcePermission).filter(
        ResourcePermission.resource_type == RESOURCE_TYPE_FOLDER,
        ResourcePermission.resource_id == folder.id,
    ).delete(synchronize_session=False)

    permission_rules = (
        _normalize_permission_rules(payload.view_rules, CAPABILITY_VIEW)
        + _normalize_permission_rules(payload.download_rules, CAPABILITY_DOWNLOAD)
        + _normalize_permission_rules(payload.edit_rules, CAPABILITY_EDIT)
        + _normalize_permission_rules(payload.upload_rules, CAPABILITY_UPLOAD)
        + _normalize_permission_rules(payload.delete_rules, CAPABILITY_DELETE)
    )
    for rule in permission_rules:
        rule.resource_id = folder.id
        rule.created_by = current_user.id
        db.add(rule)

    record_audit_log(
        db,
        current_user,
        "folder.permissions.update",
        "folder",
        folder.id,
        request=request,
        detail={
            "view_rules": len(payload.view_rules),
            "download_rules": len(payload.download_rules),
            "edit_rules": len(payload.edit_rules),
            "upload_rules": len(payload.upload_rules),
            "delete_rules": len(payload.delete_rules),
        },
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
    if not get_folder_capabilities(db, folder, current_user).can_manage_settings:
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    content = await file.read(MAX_FOLDER_COVER_BYTES + 1)
    if len(content) > MAX_FOLDER_COVER_BYTES:
        raise HTTPException(status_code=413, detail="文件夹封面不能超过 5 MB")

    try:
        with Image.open(io.BytesIO(content)) as image:
            image_format = (image.format or "").upper()
            width, height = image.size
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="封面文件不是有效图片") from exc

    ext = FOLDER_COVER_EXTENSIONS.get(image_format)
    if not ext:
        raise HTTPException(status_code=400, detail="封面仅支持 JPG、PNG、WEBP 或 GIF")
    if width <= 0 or height <= 0 or width * height > MAX_FOLDER_COVER_PIXELS:
        raise HTTPException(status_code=400, detail="封面图片尺寸过大")

    stored_name = f"folder-cover-{folder_id}-{uuid.uuid4().hex}{ext}"
    cover_dir = os.path.join(settings.STORAGE_DIR, "covers")
    os.makedirs(cover_dir, exist_ok=True)
    storage_path = os.path.join(cover_dir, stored_name)

    with open(storage_path, "wb") as buffer:
        buffer.write(content)

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
    if not get_folder_capabilities(db, folder, current_user).can_edit:
        raise HTTPException(status_code=403, detail="You don't have permission to manage this folder")

    payload_fields = getattr(payload, "model_fields_set", getattr(payload, "__fields_set__", set()))

    if "name" in payload_fields:
        new_name = _normalize_folder_name(payload.name or "")
        _ensure_unique_folder_name(db, new_name, folder.parent_id, exclude_folder_id=folder.id)
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


@router.post("/{folder_id}/move", response_model=ResourceMoveResponse)
def move_folder_endpoint(
    folder_id: int,
    payload: ResourceMoveRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(
        Folder.id == folder_id,
        Folder.is_deleted == False,
    ).with_for_update().first()
    target_folder = db.query(Folder).filter(
        Folder.id == payload.target_folder_id,
        Folder.is_deleted == False,
    ).with_for_update().first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")
    if not target_folder:
        raise HTTPException(status_code=404, detail="目标文件夹不存在")
    if not get_folder_capabilities(db, folder, current_user).can_move:
        raise HTTPException(status_code=403, detail="您没有移动此文件夹的权限")
    if not get_folder_capabilities(db, target_folder, current_user).can_upload:
        raise HTTPException(status_code=403, detail="您没有向目标目录移动内容的权限")

    try:
        result = move_folder(db, folder, target_folder)
        record_audit_log(
            db,
            current_user,
            "folder.move",
            "folder",
            folder.id,
            request=request,
            detail={
                "name": folder.name,
                "old_parent_id": result.old_parent_id,
                "target_folder_id": result.target_folder_id,
                "target_path": result.target_path,
            },
        )
        db.commit()
    except ResourceMoveError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception:
        db.rollback()
        raise

    background_tasks.add_task(
        refresh_folder_summaries_after_move,
        result.old_parent_id,
        result.target_folder_id,
    )
    return ResourceMoveResponse(**result.__dict__)

@router.delete("/{folder_id}")
def delete_folder(
    folder_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # 权限检查
    if not get_folder_capabilities(db, folder, current_user).can_delete:
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

    record_audit_log(
        db,
        current_user,
        "folder.delete",
        "folder",
        folder.id,
        request=request,
        detail={
            "name": folder.name,
            "deleted_folders": len(folder_ids),
            "deleted_files": len(file_ids),
        },
    )
    db.commit()
    return {"message": "Folder deleted successfully", "deleted_folders": len(folder_ids), "deleted_files": len(file_ids)}

# In MVP we skip full permission validation per folder.
