from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies.auth import get_current_admin
from app.models.user import User
from app.services.folder_ai_preset_service import folder_ai_preset_service


router = APIRouter()


class OrganizePresetRequest(BaseModel):
    source_content: str = Field(min_length=8)


class PresetQuestionPayload(BaseModel):
    question: str
    aliases: List[str] = []
    answer: str
    keywords: List[str] = []
    priority: int = 80
    is_enabled: bool = True


class PublishPresetRequest(BaseModel):
    preset_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    source_content: str
    inherit_to_children: bool = True
    questions: List[PresetQuestionPayload]


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, FileNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, PermissionError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{folder_id}/ai-presets")
def list_folder_ai_presets(
    folder_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    try:
        return folder_ai_preset_service.list_for_folder(db, folder_id, current_admin)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/{folder_id}/ai-presets/organize")
def organize_folder_ai_preset(
    folder_id: int,
    payload: OrganizePresetRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
) -> Dict[str, Any]:
    try:
        folder = folder_ai_preset_service.get_folder_or_404(db, folder_id)
        folder_ai_preset_service.require_manage(db, folder, current_admin)
        return folder_ai_preset_service.organize_content(payload.source_content)
    except Exception as exc:
        _raise_service_error(exc)


@router.post("/{folder_id}/ai-presets/publish")
def publish_folder_ai_preset(
    folder_id: int,
    payload: PublishPresetRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    try:
        return folder_ai_preset_service.publish(
            db,
            folder_id=folder_id,
            user=current_admin,
            name=payload.name,
            description=payload.description,
            source_content=payload.source_content,
            inherit_to_children=payload.inherit_to_children,
            preset_id=payload.preset_id,
            questions=[question.model_dump() for question in payload.questions],
        )
    except Exception as exc:
        _raise_service_error(exc)


@router.delete("/{folder_id}/ai-presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder_ai_preset(
    folder_id: int,
    preset_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    try:
        folder_ai_preset_service.delete(
            db,
            folder_id=folder_id,
            preset_id=preset_id,
            user=current_admin,
        )
    except Exception as exc:
        _raise_service_error(exc)

