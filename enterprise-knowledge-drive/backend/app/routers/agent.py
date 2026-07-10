from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.agent_service_optimized import agent_service
from app.services.department_scope_service import department_scope_service
from app.services.preset_prompt_service import preset_prompt_service


router = APIRouter()


class AgentChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None
    top_k: int = 8
    retrieval_mode: str = "hybrid"
    test_department_name: Optional[str] = None


class SuggestedQuestionsResponse(BaseModel):
    questions: List[str]


@router.post("/chat")
def chat(
    request: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    x_test_department_name: Optional[str] = Header(default=None, alias="X-Test-Department-Name"),
):
    try:
        requested_department_name = request.test_department_name or x_test_department_name
        scoped_user = department_scope_service.build_scoped_user(current_user, requested_department_name)
        return agent_service.chat(
            query=request.query,
            conversation_id=request.conversation_id,
            top_k=request.top_k,
            retrieval_mode=request.retrieval_mode,
            user_id=current_user.id,
            scoped_user=scoped_user,
            override_department_name=requested_department_name,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/suggested-questions", response_model=SuggestedQuestionsResponse)
def suggested_questions(
    limit: int = 12,
    test_department_name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    try:
        scoped_user = department_scope_service.build_scoped_user(current_user, test_department_name)
        questions = preset_prompt_service.get_suggested_questions_for_user(scoped_user, limit=max(4, min(limit, 20)))
        return SuggestedQuestionsResponse(questions=questions)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
