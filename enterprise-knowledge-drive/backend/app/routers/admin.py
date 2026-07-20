import json
from datetime import datetime, timedelta, timezone
import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func, and_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, Dict, Optional, List
from app.database import get_db
from app.models.user import User
from app.models.folder import Folder
from app.models.file import File
from app.models.agent_message import AgentMessage
from app.models.setting import SystemSetting
from app.models.user_file_view import UserFileView
from app.dependencies.auth import get_current_user, get_current_super_admin, get_current_admin
from app.routers.auth import get_password_hash
from app.services.preset_prompt_service import preset_prompt_service
from app.services.dingtalk_directory import (
    DingTalkDirectoryError,
    get_directory_payload,
    sync_dingtalk_directory,
)

router = APIRouter()
HOME_APPEARANCE_SETTING_KEY = "home_appearance"

class UserCreate(BaseModel):
    name: str
    username: str
    password: str
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    full_department_path: Optional[str] = None
    root_department_name: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    full_department_path: Optional[str] = None
    root_department_name: Optional[str] = None
    is_active: Optional[bool] = None

class RoleUpdate(BaseModel):
    is_admin: Optional[bool] = None
    is_super_admin: Optional[bool] = None


class UserUsageStats(BaseModel):
    id: int
    name: str
    department_name: Optional[str]
    file_view_count: int
    agent_chat_count: int
    last_active: Optional[datetime]


class UsageStatsResponse(BaseModel):
    users: List[UserUsageStats]
    total_users: int


class HomeAppearanceSettingResponse(BaseModel):
    value: Optional[Dict[str, Any]] = None
    updated_at: Optional[datetime] = None


class HomeAppearanceSettingUpdate(BaseModel):
    value: Dict[str, Any]


class PresetPromptListItemResponse(BaseModel):
    id: str
    name: str
    scope_type: str
    department_name: Optional[str] = None
    relative_path: str
    description: Optional[str] = None
    sort_order: int
    updated_at: Optional[datetime] = None
    can_edit: bool


class PresetPromptDetailResponse(PresetPromptListItemResponse):
    content: str


class PresetPromptCreateRequest(BaseModel):
    name: str
    scope_type: str
    department_name: Optional[str] = None
    description: Optional[str] = None
    content: str


class PresetPromptUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None


def _get_user_specific_department(user: User) -> Optional[str]:
    """获取用户的具体部门（优先匹配 跨界营销中心、创意部 等关键部门）"""
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    return user.department_name


def _get_time_filter(time_range: str):
    now = datetime.now(timezone.utc)
    if time_range == "7d":
        return now - timedelta(days=7)
    elif time_range == "30d":
        return now - timedelta(days=30)
    return None


def _load_json_setting(setting: Optional[SystemSetting]) -> Optional[Dict[str, Any]]:
    if not setting:
        return None
    try:
        parsed = json.loads(setting.value)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _sanitize_home_appearance(value: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Return only appearance values that the current Home page consumes."""
    source = value if isinstance(value, dict) else {}

    def pick_strings(section_name: str, allowed_keys: set[str]) -> Dict[str, str]:
        section = source.get(section_name)
        if not isinstance(section, dict):
            return {}
        return {
            key: section[key]
            for key in allowed_keys
            if isinstance(section.get(key), str)
        }

    result: Dict[str, Any] = {
        "searchBox": pick_strings("searchBox", {"bg", "border"}),
        "aiButton": pick_strings("aiButton", {"from", "to", "text"}),
        "keywordButton": pick_strings("keywordButton", {"bg", "text"}),
    }

    folder_card = source.get("folderCard")
    badge = folder_card.get("badge") if isinstance(folder_card, dict) else None
    result["folderCard"] = {
        "badge": {
            key: badge[key]
            for key in {"bg", "text"}
            if isinstance(badge, dict) and isinstance(badge.get(key), str)
        }
    }
    return result

@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), current_admin: User = Depends(get_current_admin)):
    users_count = db.query(User).count()
    folders_count = db.query(Folder).filter(Folder.is_deleted == False).count()
    files_count = db.query(File).filter(File.is_deleted == False).count()
    
    return {
        "users_count": users_count,
        "folders_count": folders_count,
        "files_count": files_count
    }


@router.get("/settings/home-appearance", response_model=HomeAppearanceSettingResponse)
def get_home_appearance_setting(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    setting = db.query(SystemSetting).filter(SystemSetting.key == HOME_APPEARANCE_SETTING_KEY).first()
    return HomeAppearanceSettingResponse(
        value=_sanitize_home_appearance(_load_json_setting(setting)) if setting else None,
        updated_at=setting.updated_at if setting else None,
    )


@router.put("/settings/home-appearance", response_model=HomeAppearanceSettingResponse)
def update_home_appearance_setting(
    payload: HomeAppearanceSettingUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    sanitized_value = _sanitize_home_appearance(payload.value)
    serialized_value = json.dumps(sanitized_value, ensure_ascii=False)
    setting = db.query(SystemSetting).filter(SystemSetting.key == HOME_APPEARANCE_SETTING_KEY).first()

    if setting is None:
        setting = SystemSetting(
            key=HOME_APPEARANCE_SETTING_KEY,
            value=serialized_value,
            description="首页检索区与置顶目录标签外观配置",
        )
        db.add(setting)
    else:
        setting.value = serialized_value
        setting.description = "首页检索区与置顶目录标签外观配置"

    db.commit()
    db.refresh(setting)
    return HomeAppearanceSettingResponse(
        value=_sanitize_home_appearance(_load_json_setting(setting)),
        updated_at=setting.updated_at,
    )


@router.get("/settings/preset-prompts", response_model=List[PresetPromptListItemResponse])
def list_preset_prompts(current_admin: User = Depends(get_current_admin)):
    return preset_prompt_service.list_presets(current_admin)


@router.get("/settings/preset-prompts/{preset_id}", response_model=PresetPromptDetailResponse)
def get_preset_prompt(preset_id: str, current_admin: User = Depends(get_current_admin)):
    try:
        return preset_prompt_service.get_preset(preset_id, current_admin)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.post("/settings/preset-prompts", response_model=PresetPromptDetailResponse)
def create_preset_prompt(
    payload: PresetPromptCreateRequest,
    current_admin: User = Depends(get_current_admin),
):
    try:
        return preset_prompt_service.create_preset(
            user=current_admin,
            name=payload.name,
            scope_type=payload.scope_type,
            department_name=payload.department_name,
            description=payload.description,
            content=payload.content,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


@router.put("/settings/preset-prompts/{preset_id}", response_model=PresetPromptDetailResponse)
def update_preset_prompt(
    preset_id: str,
    payload: PresetPromptUpdateRequest,
    current_admin: User = Depends(get_current_admin),
):
    try:
        return preset_prompt_service.update_preset(
            preset_id=preset_id,
            user=current_admin,
            name=payload.name,
            description=payload.description,
            content=payload.content,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

@router.get("/users")
def get_users(db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    users = (
        db.query(User)
        .order_by(User.is_super_admin.desc(), User.is_admin.desc(), User.name.asc(), User.id.asc())
        .all()
    )
    return {"users": users}


@router.get("/users/directory")
def get_user_directory(
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_super_admin),
):
    return get_directory_payload(db)


@router.post("/users/sync-dingtalk")
def sync_user_directory(
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_super_admin),
):
    try:
        result = sync_dingtalk_directory(db)
    except DingTalkDirectoryError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="连接钉钉通讯录失败，请稍后重试") from exc
    return {**result, **get_directory_payload(db)}

@router.post("/users")
def create_user(user_data: UserCreate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        name=user_data.name,
        username=user_data.username,
        hashed_password=hashed_password,
        department_id=user_data.department_id,
        department_name=user_data.department_name,
        department_paths=(json.dumps([user_data.full_department_path], ensure_ascii=False) if user_data.full_department_path else None),
        full_department_path=user_data.full_department_path,
        root_department_name=user_data.root_department_name,
        department_manually_overridden=bool(user_data.department_id or user_data.full_department_path),
        is_active=True
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"message": "User created", "user": new_user}

@router.put("/users/{user_id}")
def update_user(user_id: int, user_data: UserUpdate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if user_data.name is not None:
        user.name = user_data.name
    department_fields = {"department_id", "department_name", "full_department_path", "root_department_name"}
    if department_fields.intersection(user_data.__fields_set__):
        user.department_id = user_data.department_id
        user.department_name = user_data.department_name
        user.full_department_path = user_data.full_department_path
        user.root_department_name = user_data.root_department_name
        user.department_paths = (
            json.dumps([user_data.full_department_path], ensure_ascii=False)
            if user_data.full_department_path
            else None
        )
        user.department_manually_overridden = True
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    
    db.commit()
    db.refresh(user)
    
    return {"message": "User updated", "user": user}

@router.put("/users/{user_id}/role")
def update_user_role(user_id: int, role_data: RoleUpdate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    if current_admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if role_data.is_admin is not None:
        user.is_admin = role_data.is_admin
    if role_data.is_super_admin is not None:
        user.is_super_admin = role_data.is_super_admin
    
    db.commit()
    db.refresh(user)
    
    return {"message": "Role updated", "user": user}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    if current_admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    # Keep content owned by the account, but remove account-only activity rows.
    # A short lock timeout prevents an admin request from spinning forever when
    # another transaction is holding one of these rows.
    from app.models import (
        AgentMessage,
        Favorite,
        AuditLog,
    )
    from app.models.resource_permission import ResourcePermission

    try:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '15s'"))

        db.query(AgentMessage).filter(AgentMessage.user_id == user_id).delete(synchronize_session=False)
        db.query(Favorite).filter(Favorite.user_id == user_id).delete(synchronize_session=False)
        # Preserve the immutable operation trail after an account is removed.
        # The actor id becomes null while action, target, time, IP and details remain.
        db.query(AuditLog).filter(AuditLog.user_id == user_id).update(
            {AuditLog.user_id: None}, synchronize_session=False
        )
        db.query(UserFileView).filter(UserFileView.user_id == user_id).delete(synchronize_session=False)

        # Ownership/audit metadata must not delete shared company content.
        db.query(Folder).filter(Folder.created_by == user_id).update(
            {Folder.created_by: None}, synchronize_session=False
        )
        db.query(File).filter(File.uploaded_by == user_id).update(
            {File.uploaded_by: None}, synchronize_session=False
        )
        db.query(ResourcePermission).filter(ResourcePermission.created_by == user_id).update(
            {ResourcePermission.created_by: None}, synchronize_session=False
        )

        db.delete(user)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户删除失败：仍有数据被占用，请稍后重试",
        ) from exc

    return {"message": "User deleted"}


@router.get("/usage-stats", response_model=UsageStatsResponse)
def get_usage_stats(
    time_range: str = Query("all", description="时间范围: all, 7d, 30d"),
    db: Session = Depends(get_db), 
    current_admin: User = Depends(get_current_admin)
):
    # 获取目标用户
    query = db.query(User).filter(User.is_active == True)
    
    # 如果是部门管理员，只看同部门的普通用户
    if not current_admin.is_super_admin:
        admin_department = _get_user_specific_department(current_admin)
        query = query.filter(
            User.is_admin == False,
            User.is_super_admin == False
        )
        if admin_department:
            query = query.filter(
                (User.department_name == admin_department) |
                (User.full_department_path.contains(admin_department))
            )
    
    users = query.all()
    
    # 构建时间过滤
    time_filter = _get_time_filter(time_range)
    
    # 预处理数据统计
    user_ids = [user.id for user in users] if users else []
    
    result_users = []
    
    for user in users:
        # 文件浏览统计
        file_view_query = db.query(func.count(UserFileView.id)).filter(UserFileView.user_id == user.id)
        if time_filter:
            file_view_query = file_view_query.filter(UserFileView.created_at >= time_filter)
        file_view_count = file_view_query.scalar() or 0
        
        # Agent对话统计
        agent_chat_query = db.query(func.count(AgentMessage.id)).filter(
            AgentMessage.user_id == user.id,
            AgentMessage.role == 'user'
        )
        if time_filter:
            agent_chat_query = agent_chat_query.filter(AgentMessage.created_at >= time_filter)
        agent_chat_count = agent_chat_query.scalar() or 0
        
        # 最后活跃时间
        last_file_view = db.query(func.max(UserFileView.created_at)).filter(UserFileView.user_id == user.id).scalar()
        last_agent_message = db.query(func.max(AgentMessage.created_at)).filter(AgentMessage.user_id == user.id).scalar()
        
        last_active = user.last_login_at
        if last_file_view and (not last_active or last_file_view > last_active):
            last_active = last_file_view
        if last_agent_message and (not last_active or last_agent_message > last_active):
            last_active = last_agent_message
        
        result_users.append(UserUsageStats(
            id=user.id,
            name=user.name,
            department_name=_get_user_specific_department(user),
            file_view_count=file_view_count,
            agent_chat_count=agent_chat_count,
            last_active=last_active
        ))
    
    # 按浏览量排序
    result_users.sort(key=lambda x: x.file_view_count, reverse=True)
    
    return UsageStatsResponse(
        users=result_users,
        total_users=len(result_users)
    )
