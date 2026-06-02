from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.favorite import Favorite
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User

router = APIRouter()


class FavoriteFileData(BaseModel):
    id: int
    original_name: str
    size: int
    folder_id: Optional[int]
    preview_status: str
    created_at: Optional[datetime] = None


class FavoriteFolderData(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    parent_id: Optional[int]
    created_at: Optional[datetime] = None


class FavoriteListItem(BaseModel):
    favorite_id: int
    item_type: Literal["file", "folder"]
    created_at: Optional[datetime] = None
    file: Optional[FavoriteFileData] = None
    folder: Optional[FavoriteFolderData] = None


class FavoriteStatusResponse(BaseModel):
    favorite_file_ids: List[int]
    favorite_folder_ids: List[int]


class FavoriteMutationResponse(BaseModel):
    success: bool
    item_type: Literal["file", "folder"]
    target_id: int
    is_favorite: bool


def _parse_id_list(raw_value: Optional[str]) -> List[int]:
    if not raw_value:
        return []

    parsed_ids: List[int] = []
    for chunk in raw_value.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            parsed_ids.append(int(chunk))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid id: {chunk}") from exc
    return parsed_ids


def _ensure_file_exists(db: Session, file_id: int) -> None:
    file = (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.id == file_id,
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
        .first()
    )
    if not file:
        raise HTTPException(status_code=404, detail="File not found")


def _ensure_folder_exists(db: Session, folder_id: int) -> None:
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")


@router.get("", response_model=List[FavoriteListItem])
def get_favorites(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    favorites = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id)
        .order_by(Favorite.created_at.desc(), Favorite.id.desc())
        .all()
    )

    file_ids = [row.file_id for row in favorites if row.file_id is not None]
    folder_ids = [row.folder_id for row in favorites if row.folder_id is not None]

    files_by_id = {
        row.id: row
        for row in (
            db.query(File)
            .outerjoin(Folder, Folder.id == File.folder_id)
            .filter(
                File.id.in_(file_ids) if file_ids else False,
                File.is_deleted == False,
                or_(File.folder_id == None, Folder.is_deleted == False),
            )
            .all()
        )
    }
    folders_by_id = {
        row.id: row
        for row in (
            db.query(Folder)
            .filter(Folder.id.in_(folder_ids) if folder_ids else False, Folder.is_deleted == False)
            .all()
        )
    }

    items: List[FavoriteListItem] = []
    for favorite in favorites:
        if favorite.file_id is not None:
            file = files_by_id.get(favorite.file_id)
            if not file:
                continue
            items.append(
                FavoriteListItem(
                    favorite_id=favorite.id,
                    item_type="file",
                    created_at=favorite.created_at,
                    file=FavoriteFileData(
                        id=file.id,
                        original_name=file.original_name,
                        size=file.size,
                        folder_id=file.folder_id,
                        preview_status=file.preview_status,
                        created_at=file.created_at,
                    ),
                )
            )
            continue

        if favorite.folder_id is not None:
            folder = folders_by_id.get(favorite.folder_id)
            if not folder:
                continue
            items.append(
                FavoriteListItem(
                    favorite_id=favorite.id,
                    item_type="folder",
                    created_at=favorite.created_at,
                    folder=FavoriteFolderData(
                        id=folder.id,
                        name=folder.name,
                        description=folder.description,
                        parent_id=folder.parent_id,
                        created_at=folder.created_at,
                    ),
                )
            )

    return items


@router.get("/status", response_model=FavoriteStatusResponse)
def get_favorite_status(
    file_ids: Optional[str] = Query(default=None),
    folder_ids: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    parsed_file_ids = _parse_id_list(file_ids)
    parsed_folder_ids = _parse_id_list(folder_ids)

    favorite_file_ids: List[int] = []
    favorite_folder_ids: List[int] = []

    if parsed_file_ids:
        favorite_file_ids = [
            row[0]
            for row in db.query(Favorite.file_id)
            .filter(
                Favorite.user_id == current_user.id,
                Favorite.file_id.in_(parsed_file_ids),
            )
            .all()
            if row[0] is not None
        ]

    if parsed_folder_ids:
        favorite_folder_ids = [
            row[0]
            for row in db.query(Favorite.folder_id)
            .filter(
                Favorite.user_id == current_user.id,
                Favorite.folder_id.in_(parsed_folder_ids),
            )
            .all()
            if row[0] is not None
        ]

    return {
        "favorite_file_ids": favorite_file_ids,
        "favorite_folder_ids": favorite_folder_ids,
    }


@router.post("/files/{file_id}", response_model=FavoriteMutationResponse)
def favorite_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_file_exists(db, file_id)

    favorite = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.file_id == file_id)
        .first()
    )
    if not favorite:
        favorite = Favorite(user_id=current_user.id, file_id=file_id)
        db.add(favorite)
        db.commit()

    return {
        "success": True,
        "item_type": "file",
        "target_id": file_id,
        "is_favorite": True,
    }


@router.delete("/files/{file_id}", response_model=FavoriteMutationResponse)
def unfavorite_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    favorite = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.file_id == file_id)
        .first()
    )
    if favorite:
        db.delete(favorite)
        db.commit()

    return {
        "success": True,
        "item_type": "file",
        "target_id": file_id,
        "is_favorite": False,
    }


@router.post("/folders/{folder_id}", response_model=FavoriteMutationResponse)
def favorite_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_folder_exists(db, folder_id)

    favorite = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.folder_id == folder_id)
        .first()
    )
    if not favorite:
        favorite = Favorite(user_id=current_user.id, folder_id=folder_id)
        db.add(favorite)
        db.commit()

    return {
        "success": True,
        "item_type": "folder",
        "target_id": folder_id,
        "is_favorite": True,
    }


@router.delete("/folders/{folder_id}", response_model=FavoriteMutationResponse)
def unfavorite_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    favorite = (
        db.query(Favorite)
        .filter(Favorite.user_id == current_user.id, Favorite.folder_id == folder_id)
        .first()
    )
    if favorite:
        db.delete(favorite)
        db.commit()

    return {
        "success": True,
        "item_type": "folder",
        "target_id": folder_id,
        "is_favorite": False,
    }
