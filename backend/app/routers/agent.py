from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.agent_service import agent_service


router = APIRouter()


class AgentChatRequest(BaseModel):
    query: str
    conversation_id: Optional[str] = None
    top_k: int = 8
    retrieval_mode: str = "hybrid"


@router.post("/chat")
def chat(request: AgentChatRequest, current_user: User = Depends(get_current_user)):
    try:
        return agent_service.chat(
            query=request.query,
            conversation_id=request.conversation_id,
            top_k=request.top_k,
            retrieval_mode=request.retrieval_mode,
            user_id=current_user.id,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
