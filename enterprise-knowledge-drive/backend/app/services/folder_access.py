from typing import Iterable, List, Optional, Set

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.folder import Folder
from app.models.permission import FolderPermission
from app.models.user import User

FOLDER_MANAGER_PERMISSION_TYPE = "manager"


def get_user_specific_department(user: User) -> Optional[str]:
    """获取用户的具体部门（优先匹配跨界营销中心、创意部等关键部门）。"""
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    return user.department_name


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
    if folder.created_by and folder.created_by == current_user.id:
        return True
    if is_folder_manager(db, folder.id, current_user.id):
        return True

    user_department = get_user_specific_department(current_user)
    return folder.is_super_admin_created or folder.department_name == user_department


def can_manage_folder_settings(db: Session, folder: Folder, current_user: User) -> bool:
    if current_user.is_super_admin:
        return True
    if folder.created_by and folder.created_by == current_user.id:
        return True
    return is_folder_manager(db, folder.id, current_user.id)


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
