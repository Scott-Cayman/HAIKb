from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from sqlalchemy.orm import Session
from app.services.agent_service_optimized import agent_service
from app.services.department_scope_service import department_scope_service
from app.services.folder_ai_preset_service import folder_ai_preset_service
from app.services.resource_access import list_visible_files, list_visible_folders
from app.models.file import File
from app.models.folder import Folder
from sqlalchemy import or_


router = APIRouter()


class AgentChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None
    top_k: int = 8
    retrieval_mode: str = "hybrid"
    test_department_name: Optional[str] = None
    current_folder_id: Optional[int] = None


class SuggestedQuestionsResponse(BaseModel):
    questions: List[str]


def _build_permission_scope(db: Session, scoped_user: User, current_folder_id: Optional[int]):
    candidate_folders = db.query(Folder).filter(Folder.is_deleted == False).all()
    visible_folders = list_visible_folders(db, candidate_folders, scoped_user)
    visible_folder_ids = {folder.id for folder in visible_folders}

    candidate_files = (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
        .all()
    )
    visible_files = list_visible_files(db, candidate_files, scoped_user)
    if current_folder_id is not None:
        if current_folder_id not in visible_folder_ids:
            raise PermissionError("当前目录不在账号可见范围内")
        subtree_ids = folder_ai_preset_service.folder_descendant_ids(db, current_folder_id)
        visible_files = [file for file in visible_files if file.folder_id in subtree_ids]
    return [file.id for file in visible_files], sorted(visible_folder_ids)


@router.post("/chat")
def chat(
    request: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_test_department_name: Optional[str] = Header(default=None, alias="X-Test-Department-Name"),
):
    try:
        requested_department_name = request.test_department_name or x_test_department_name
        scoped_user = department_scope_service.build_scoped_user(current_user, requested_department_name)
        allowed_file_ids, visible_folder_ids = _build_permission_scope(db, scoped_user, request.current_folder_id)
        return agent_service.chat(
            query=request.query,
            conversation_id=request.conversation_id,
            top_k=request.top_k,
            retrieval_mode=request.retrieval_mode,
            user_id=current_user.id,
            scoped_user=scoped_user,
            override_department_name=requested_department_name,
            allowed_file_ids=allowed_file_ids,
            visible_folder_ids=visible_folder_ids,
            current_folder_id=request.current_folder_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/chat/stream")
def chat_stream(
    request: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_test_department_name: Optional[str] = Header(default=None, alias="X-Test-Department-Name"),
):
    try:
        requested_department_name = request.test_department_name or x_test_department_name
        scoped_user = department_scope_service.build_scoped_user(current_user, requested_department_name)
        allowed_file_ids, visible_folder_ids = _build_permission_scope(db, scoped_user, request.current_folder_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def event_generator():
        try:
            for event in agent_service.chat_stream(
                query=request.query,
                conversation_id=request.conversation_id,
                top_k=request.top_k,
                retrieval_mode=request.retrieval_mode,
                user_id=current_user.id,
                scoped_user=scoped_user,
                override_department_name=requested_department_name,
                allowed_file_ids=allowed_file_ids,
                visible_folder_ids=visible_folder_ids,
                current_folder_id=request.current_folder_id,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/suggested-questions", response_model=SuggestedQuestionsResponse)
def suggested_questions(
    limit: int = 12,
    test_department_name: Optional[str] = None,
    current_folder_id: Optional[int] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        scoped_user = department_scope_service.build_scoped_user(current_user, test_department_name)
        _allowed_file_ids, visible_folder_ids = _build_permission_scope(db, scoped_user, current_folder_id)
        questions = folder_ai_preset_service.suggested_questions(
            db,
            visible_folder_ids=visible_folder_ids,
            current_folder_id=current_folder_id,
            limit=max(4, min(limit, 20)),
        )
        return SuggestedQuestionsResponse(questions=questions)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
