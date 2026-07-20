import json
from typing import Iterable, List, Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.folder import Folder
from app.models.permission import FolderPermission
from app.models.setting import SystemSetting
from app.models.user import User

FOLDER_MANAGER_PERMISSION_TYPE = "manager"
HOME_PINNED_FOLDERS_SETTING_PREFIX = "home_pinned_folders:"


def get_user_specific_department(user: User) -> Optional[str]:
    """获取用户的具体部门（优先匹配跨界营销中心、创意部等关键部门）。"""
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    return user.department_name


def get_user_department_tokens(user: User) -> Set[str]:
    tokens: Set[str] = set()
    for value in (user.department_name, user.root_department_name, get_user_specific_department(user)):
        normalized = (value or "").strip()
        if normalized:
            tokens.add(normalized)

    paths = [user.full_department_path] if user.full_department_path else []
    try:
        stored_paths = json.loads(user.department_paths or "[]")
    except (TypeError, json.JSONDecodeError):
        stored_paths = []
    if isinstance(stored_paths, list):
        paths.extend(str(path) for path in stored_paths if path)
    for path in paths:
        parts = [part.strip() for part in path.split("/") if part.strip()]
        for start in range(len(parts)):
            prefix: List[str] = []
            for part in parts[start:]:
                tokens.add(part)
                prefix.append(part)
                tokens.add("/".join(prefix))
    return tokens


def user_belongs_to_department(user: User, department_name: Optional[str]) -> bool:
    normalized = (department_name or "").strip()
    if not normalized:
        return False
    if normalized in get_user_department_tokens(user):
        return True
    full_path = (user.full_department_path or "").strip()
    return bool(
        full_path == normalized
        or full_path.startswith(f"{normalized}/")
        or full_path.endswith(f"/{normalized}")
        or f"/{normalized}/" in full_path
    )


def _load_home_pinned_folder_ids(db: Session) -> Set[int]:
    settings = (
        db.query(SystemSetting.value)
        .filter(SystemSetting.key.like(f"{HOME_PINNED_FOLDERS_SETTING_PREFIX}%"))
        .all()
    )
    folder_ids: Set[int] = set()
    for row in settings:
        try:
            values = json.loads(row[0])
        except (TypeError, json.JSONDecodeError):
            continue
        if not isinstance(values, list):
            continue
        for value in values:
            try:
                folder_ids.add(int(value))
            except (TypeError, ValueError):
                continue
    return folder_ids


def _folder_is_or_descends_from(db: Session, folder: Folder, ancestor_ids: Set[int]) -> bool:
    if not ancestor_ids:
        return False
    current: Optional[Folder] = folder
    visited: Set[int] = set()
    while current and current.id not in visited:
        visited.add(current.id)
        if current.id in ancestor_ids:
            return True
        if current.parent_id is None:
            break
        current = (
            db.query(Folder)
            .filter(Folder.id == current.parent_id, Folder.is_deleted == False)
            .first()
        )
    return False


def folder_belongs_to_user_department(db: Session, folder: Folder, user: User) -> bool:
    current: Optional[Folder] = folder
    visited: Set[int] = set()
    while current and current.id not in visited:
        visited.add(current.id)
        if user_belongs_to_department(user, current.department_name):
            return True
        if current.parent_id is None:
            break
        current = (
            db.query(Folder)
            .filter(Folder.id == current.parent_id, Folder.is_deleted == False)
            .first()
        )
    return False


def is_home_pinned_folder(db: Session, folder: Folder) -> bool:
    return _folder_is_or_descends_from(db, folder, _load_home_pinned_folder_ids(db))


def is_ancestor_of_home_pinned_folder(db: Session, folder: Folder) -> bool:
    pinned_ids = _load_home_pinned_folder_ids(db)
    if not pinned_ids:
        return False
    pinned_folders = (
        db.query(Folder)
        .filter(Folder.id.in_(pinned_ids), Folder.is_deleted == False)
        .all()
    )
    return any(_folder_is_or_descends_from(db, pinned_folder, {folder.id}) for pinned_folder in pinned_folders)


def is_folder_in_admin_scope(db: Session, folder: Folder, current_user: User) -> bool:
    if current_user.is_super_admin:
        return True
    if not current_user.is_admin:
        return False
    # Department administrators are deliberately confined to their own branch.
    # Pinning is presentation metadata and must never expand management scope.
    return folder_belongs_to_user_department(db, folder, current_user)


def get_folder_manager_user_ids(db: Session, folder_id: int) -> Set[int]:
    rows = (
        db.query(FolderPermission.target_id)
        .filter(
            FolderPermission.folder_id == folder_id,
            FolderPermission.permission_type == FOLDER_MANAGER_PERMISSION_TYPE,
        )
        .all()
    )

    result: Set[int] = set()
    for row in rows:
        target_id = row[0]
        try:
            result.add(int(target_id))
        except (TypeError, ValueError):
            continue
    return result


def is_folder_manager(db: Session, folder_id: int, user_id: Optional[int]) -> bool:
    if not user_id:
        return False
    return user_id in get_folder_manager_user_ids(db, folder_id)


def can_view_folder(db: Session, folder: Folder, current_user: User) -> bool:
    if current_user.is_super_admin:
        return True
    if current_user.is_admin:
        return (
            folder.parent_id is None
            or is_folder_in_admin_scope(db, folder, current_user)
        )
    if folder.created_by and folder.created_by == current_user.id:
        return True
    if is_folder_manager(db, folder.id, current_user.id):
        return True

    return (
        folder.parent_id is None
        or folder_belongs_to_user_department(db, folder, current_user)
    )


def can_manage_folder_settings(db: Session, folder: Folder, current_user: User) -> bool:
    if current_user.is_super_admin:
        return True
    if current_user.is_admin:
        return is_folder_in_admin_scope(db, folder, current_user)
    return False


def list_folder_manager_candidates(db: Session, folder: Folder, current_user: User) -> List[User]:
    base_query = db.query(User).filter(User.is_active == True)
    manager_user_ids = get_folder_manager_user_ids(db, folder.id)
    include_user_ids = {user_id for user_id in manager_user_ids if user_id}
    if folder.created_by:
        include_user_ids.add(folder.created_by)

    if current_user.is_super_admin:
        if include_user_ids:
            base_query = base_query.filter(or_(User.id.in_(include_user_ids), User.is_active == True))
        return base_query.order_by(User.name.asc()).all()

    folder_department = folder.department_name
    if folder_department:
        base_query = base_query.filter(
            or_(
                User.id.in_(include_user_ids) if include_user_ids else False,
                User.department_name == folder_department,
                User.full_department_path.contains(folder_department),
            )
        )
    elif include_user_ids:
        base_query = base_query.filter(User.id.in_(include_user_ids))
    else:
        base_query = base_query.filter(User.id == current_user.id)

    return base_query.order_by(User.name.asc()).all()


def normalize_manager_user_ids(user_ids: Iterable[int], creator_user_id: Optional[int]) -> List[int]:
    unique_ids: List[int] = []
    seen: Set[int] = set()

    for user_id in user_ids:
        if not user_id or user_id == creator_user_id or user_id in seen:
            continue
        seen.add(user_id)
        unique_ids.append(user_id)

    return unique_ids
