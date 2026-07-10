import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import func, and_
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

router = APIRouter()
HOME_APPEARANCE_SETTING_KEY = "home_appearance"

class UserCreate(BaseModel):
    name: str
    username: str
    password: str
    department_name: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    department_name: Optional[str] = None
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
        value=_load_json_setting(setting),
        updated_at=setting.updated_at if setting else None,
    )


@router.put("/settings/home-appearance", response_model=HomeAppearanceSettingResponse)
def update_home_appearance_setting(
    payload: HomeAppearanceSettingUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    serialized_value = json.dumps(payload.value, ensure_ascii=False)
    setting = db.query(SystemSetting).filter(SystemSetting.key == HOME_APPEARANCE_SETTING_KEY).first()

    if setting is None:
        setting = SystemSetting(
            key=HOME_APPEARANCE_SETTING_KEY,
            value=serialized_value,
            description="首页按钮、组件与封面外观配置",
        )
        db.add(setting)
    else:
        setting.value = serialized_value
        setting.description = "首页按钮、组件与封面外观配置"

    db.commit()
    db.refresh(setting)
    return HomeAppearanceSettingResponse(
        value=_load_json_setting(setting),
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
    users = db.query(User).all()
    return {"users": users}

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
        department_name=user_data.department_name,
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
    if user_data.department_name is not None:
        user.department_name = user_data.department_name
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
    
    # 强制删除：先删除所有关联数据
    from app.models import (
        AgentMessage,
        Favorite,
        AuditLog,
    )
    
    # 删除关联的 agent 消息
    db.query(AgentMessage).filter(AgentMessage.user_id == user_id).delete()
    
    # 删除收藏
    db.query(Favorite).filter(Favorite.user_id == user_id).delete()
    
    # 删除审计日志
    db.query(AuditLog).filter(AuditLog.user_id == user_id).delete()
    
    # 对于文件夹和文件，将 created_by/uploaded_by 设置为 null
    from app.models import Folder, File
    db.query(Folder).filter(Folder.created_by == user_id).update({"created_by": None})
    db.query(File).filter(File.uploaded_by == user_id).update({"uploaded_by": None})
    
    # 最后删除用户
    db.delete(user)
    db.commit()
    
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
