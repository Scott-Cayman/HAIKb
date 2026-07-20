from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable, Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.models.folder import Folder
from app.models.user import User
from app.services.audit_log_service import record_audit_log
from app.services.folder_access import get_user_specific_department
from app.services.resource_access import get_folder_capabilities


MAX_UPLOAD_FOLDER_DEPTH = 32
MAX_UPLOAD_FOLDER_NAME_LENGTH = 255
MAX_UPLOAD_RELATIVE_PATH_LENGTH = 4096


@dataclass
class EnsuredUploadFolderPath:
    folder_id: Optional[int]
    created_folder_ids: list[int] = field(default_factory=list)
    reused_folder_ids: list[int] = field(default_factory=list)


def normalize_upload_folder_parts(relative_path: str, *, includes_filename: bool) -> list[str]:
    raw_path = (relative_path or "").replace("\\", "/")
    if not raw_path:
        return []
    if "\x00" in raw_path or len(raw_path) > MAX_UPLOAD_RELATIVE_PATH_LENGTH:
        raise HTTPException(status_code=400, detail="上传目录路径无效")
    if raw_path.startswith("/") or re.match(r"^[A-Za-z]:/", raw_path):
        raise HTTPException(status_code=400, detail="上传目录必须使用相对路径")

    raw_parts = raw_path.split("/")
    if any(not part.strip() for part in raw_parts):
        raise HTTPException(status_code=400, detail="上传目录路径包含空目录名")

    normalized_parts: list[str] = []
    for raw_part in raw_parts:
        part = raw_part.strip()
        if part in {".", ".."} or len(part) > MAX_UPLOAD_FOLDER_NAME_LENGTH:
            raise HTTPException(status_code=400, detail="上传目录路径无效")
        normalized_parts.append(part)

    folder_parts = normalized_parts[:-1] if includes_filename else normalized_parts
    if len(folder_parts) > MAX_UPLOAD_FOLDER_DEPTH:
        raise HTTPException(status_code=400, detail=f"上传目录最多支持 {MAX_UPLOAD_FOLDER_DEPTH} 层")
    return folder_parts


def ensure_upload_folder_parts(
    folder_names: Iterable[str],
    parent_folder_id: Optional[int],
    db: Session,
    current_user: User,
    *,
    request: Optional[Request] = None,
    audit_source: str = "folder_upload",
) -> EnsuredUploadFolderPath:
    names = list(folder_names)
    current_parent_id = parent_folder_id
    current_parent: Optional[Folder] = None
    result = EnsuredUploadFolderPath(folder_id=parent_folder_id)

    if current_parent_id is not None:
        current_parent = db.query(Folder).filter(
            Folder.id == current_parent_id,
            Folder.is_deleted == False,
        ).first()
        if not current_parent:
            raise HTTPException(status_code=404, detail="目标文件夹不存在")
        if not get_folder_capabilities(db, current_parent, current_user).can_upload:
            raise HTTPException(status_code=403, detail="您没有向此目录上传内容的权限")
    elif names and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以通过上传创建根目录")

    for folder_name in names:
        existing_folder = db.query(Folder).filter(
            Folder.name == folder_name,
            Folder.parent_id == current_parent_id,
            Folder.is_deleted == False,
        ).first()

        if existing_folder:
            if not get_folder_capabilities(db, existing_folder, current_user).can_upload:
                raise HTTPException(status_code=403, detail=f"您没有向目录“{folder_name}”上传内容的权限")
            current_parent_id = existing_folder.id
            current_parent = existing_folder
            result.reused_folder_ids.append(existing_folder.id)
            continue

        new_folder = Folder(
            name=folder_name,
            parent_id=current_parent_id,
            created_by=current_user.id,
            department_name=(
                current_parent.department_name
                if current_parent is not None
                else get_user_specific_department(current_user)
            ),
            is_super_admin_created=(
                current_parent.is_super_admin_created
                if current_parent is not None
                else current_user.is_super_admin
            ),
            display_mode="icon",
            icon_key="folder",
            icon_bg_from="#8cf3d5",
            icon_bg_to="#44d7cc",
            icon_color="#ffffff",
            card_bg_from="#ebfff7",
            card_bg_via="#d8fff3",
            card_bg_to="#c1f7ec",
            card_glow_color="#ffffff",
        )
        db.add(new_folder)
        db.flush()
        record_audit_log(
            db,
            current_user,
            "folder.create",
            "folder",
            new_folder.id,
            request=request,
            detail={
                "name": new_folder.name,
                "parent_id": new_folder.parent_id,
                "source": audit_source,
            },
        )
        current_parent_id = new_folder.id
        current_parent = new_folder
        result.created_folder_ids.append(new_folder.id)

    result.folder_id = current_parent_id
    return result
