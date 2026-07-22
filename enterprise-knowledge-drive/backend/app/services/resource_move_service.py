from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.file import File
from app.models.folder import Folder
from app.services.folder_summary_service import folder_summary_service


class ResourceMoveError(ValueError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class MoveResult:
    resource_type: str
    resource_id: int
    old_parent_id: int
    target_folder_id: int
    target_path: str


def collect_descendant_folder_ids(db: Session, root_folder_id: int) -> List[int]:
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
        if not batch:
            continue
        collected.extend(batch)
        child_rows = (
            db.query(Folder.id)
            .filter(Folder.parent_id.in_(batch), Folder.is_deleted == False)
            .all()
        )
        queue.extend(row[0] for row in child_rows)

    return collected


def get_folder_chain(db: Session, folder: Folder) -> List[Folder]:
    chain: List[Folder] = []
    current: Optional[Folder] = folder
    visited: Set[int] = set()

    while current and current.id not in visited:
        visited.add(current.id)
        chain.append(current)
        if current.parent_id is None:
            break
        current = (
            db.query(Folder)
            .filter(Folder.id == current.parent_id, Folder.is_deleted == False)
            .first()
        )

    if not chain or chain[-1].parent_id is not None:
        raise ResourceMoveError(409, "目录层级异常，无法确定根目录")
    chain.reverse()
    return chain


def get_folder_root_id(db: Session, folder: Folder) -> int:
    return get_folder_chain(db, folder)[0].id


def get_folder_path(db: Session, folder: Folder) -> str:
    return " / ".join(item.name for item in get_folder_chain(db, folder))


def _ensure_same_root(db: Session, source_folder: Folder, target_folder: Folder) -> None:
    if get_folder_root_id(db, source_folder) != get_folder_root_id(db, target_folder):
        raise ResourceMoveError(400, "暂不支持跨根目录移动")


def move_file(db: Session, file: File, target_folder: Folder) -> MoveResult:
    if file.folder_id is None:
        raise ResourceMoveError(400, "未归属目录的文件暂不支持移动")
    if file.folder_id == target_folder.id:
        raise ResourceMoveError(400, "文件已经在目标目录中")

    source_folder = (
        db.query(Folder)
        .filter(Folder.id == file.folder_id, Folder.is_deleted == False)
        .first()
    )
    if not source_folder:
        raise ResourceMoveError(409, "文件的原目录不存在")
    _ensure_same_root(db, source_folder, target_folder)

    duplicate = (
        db.query(File.id)
        .filter(
            File.folder_id == target_folder.id,
            File.is_deleted == False,
            File.id != file.id,
            func.lower(File.original_name) == file.original_name.lower(),
        )
        .first()
    )
    if duplicate:
        raise ResourceMoveError(409, "目标目录已存在同名文件")

    old_parent_id = file.folder_id
    file.folder_id = target_folder.id
    file.department_name = target_folder.department_name
    file.is_super_admin_created = target_folder.is_super_admin_created
    return MoveResult(
        resource_type="file",
        resource_id=file.id,
        old_parent_id=old_parent_id,
        target_folder_id=target_folder.id,
        target_path=get_folder_path(db, target_folder),
    )


def move_folder(db: Session, folder: Folder, target_folder: Folder) -> MoveResult:
    if folder.parent_id is None:
        raise ResourceMoveError(400, "根目录不能移动")
    if folder.parent_id == target_folder.id:
        raise ResourceMoveError(400, "文件夹已经在目标目录中")

    descendants = set(collect_descendant_folder_ids(db, folder.id))
    if target_folder.id in descendants:
        raise ResourceMoveError(400, "不能将文件夹移动到自身或其子目录")

    _ensure_same_root(db, folder, target_folder)
    duplicate = (
        db.query(Folder.id)
        .filter(
            Folder.parent_id == target_folder.id,
            Folder.is_deleted == False,
            Folder.id != folder.id,
            func.lower(Folder.name) == folder.name.lower(),
        )
        .first()
    )
    if duplicate:
        raise ResourceMoveError(409, "目标目录已存在同名文件夹")

    old_parent_id = folder.parent_id
    folder.parent_id = target_folder.id

    descendant_ids = list(descendants)
    db.query(Folder).filter(Folder.id.in_(descendant_ids)).update(
        {
            "department_name": target_folder.department_name,
            "is_super_admin_created": target_folder.is_super_admin_created,
        },
        synchronize_session=False,
    )
    db.query(File).filter(
        File.folder_id.in_(descendant_ids),
        File.is_deleted == False,
    ).update(
        {
            "department_name": target_folder.department_name,
            "is_super_admin_created": target_folder.is_super_admin_created,
        },
        synchronize_session=False,
    )

    return MoveResult(
        resource_type="folder",
        resource_id=folder.id,
        old_parent_id=old_parent_id,
        target_folder_id=target_folder.id,
        target_path=get_folder_path(db, target_folder),
    )


def build_folder_paths(db: Session, folders: List[Folder]) -> Dict[int, str]:
    return {folder.id: get_folder_path(db, folder) for folder in folders}


def refresh_folder_summaries_after_move(old_parent_id: int, target_folder_id: int) -> None:
    refreshed: Set[int] = set()
    for folder_id in (old_parent_id, target_folder_id):
        if folder_id in refreshed:
            continue
        refreshed.add(folder_id)
        try:
            folder_summary_service.update_folder_summary(folder_id)
        except ValueError:
            continue
