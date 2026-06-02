from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.dependencies.auth import get_current_user
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.models.rag_index import RagIndex, RagSource, SummaryChunk
from app.models.user import User
from app.rag.index_manager import index_manager
from app.services.batch_summary_service import batch_summary_service
from app.services.summary_index_service import summary_index_service


router = APIRouter()


class SummaryTagUpdateRequest(BaseModel):
    client_type: Optional[str] = None
    project_type: Optional[str] = None
    document_type: Optional[str] = None
    region_tags: Optional[List[str]] = None
    industry_tags: Optional[List[str]] = None
    keyword_tags: Optional[List[str]] = None


class BatchSummaryRequest(BaseModel):
    file_ids: List[int]


@router.get("/indices")
def get_indices(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    indices = db.query(RagIndex).order_by(RagIndex.id.asc()).all()
    payload = []
    for index in indices:
        summary_count = db.query(RagSource).filter(RagSource.index_id == index.id).count()
        chunk_count = db.query(SummaryChunk).filter(SummaryChunk.index_id == index.id).count()
        payload.append(
            {
                "id": index.id,
                "name": index.name,
                "index_type": index.index_type,
                "status": index.status,
                "summary_count": summary_count,
                "chunk_count": chunk_count,
            }
        )
    return payload


@router.post("/indices/default/rebuild")
def rebuild_default_index(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    index = index_manager.get_default_index()
    pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
    pipeline.reset_index()

    summaries = db.query(DocumentSummary).filter(DocumentSummary.is_deleted == False).all()
    success = 0
    for summary in summaries:
        pipeline.run(summary.id, reindex=True)
        success += 1
    return {"status": "success", "reindexed": success}


@router.post("/files/{file_id}/summarize")
def summarize_file(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    file.summary_status = "processing"
    file.summary_error = None
    db.commit()
    
    background_tasks.add_task(summary_index_service.generate_summary_and_index_task, file_id)
    return {"file_id": file_id, "status": "processing", "message": "Summary generation started in background"}


@router.post("/files/batch-summarize")
def batch_summarize_files(
    payload: BatchSummaryRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        return batch_summary_service.create_task(payload.file_ids)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/batch-tasks/{task_id}")
def get_batch_summary_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    try:
        return batch_summary_service.get_task_status(task_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/files/{file_id}/summary")
def get_file_summary(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
    return {
        "file_id": file.id,
        "summary_status": file.summary_status,
        "summary_error": file.summary_error,
        "summary": summary,
    }


@router.put("/files/{file_id}/tags")
def update_file_tags(
    file_id: int,
    payload: SummaryTagUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")

    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")

    if payload.client_type is not None:
        summary.client_type = payload.client_type.strip() or None
    if payload.project_type is not None:
        summary.project_type = payload.project_type.strip() or None
    if payload.document_type is not None:
        summary.document_type = payload.document_type.strip() or None

    if payload.region_tags is not None:
        summary.region_tags = json.dumps([item.strip() for item in payload.region_tags if item and item.strip()], ensure_ascii=False)
    if payload.industry_tags is not None:
        summary.industry_tags = json.dumps([item.strip() for item in payload.industry_tags if item and item.strip()], ensure_ascii=False)
    if payload.keyword_tags is not None:
        summary.keyword_tags = json.dumps([item.strip() for item in payload.keyword_tags if item and item.strip()], ensure_ascii=False)

    db.commit()
    db.refresh(summary)
    return {
        "file_id": file.id,
        "summary_status": file.summary_status,
        "summary_error": file.summary_error,
        "summary": summary,
    }


@router.post("/files/{file_id}/reindex-summary")
def reindex_summary(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    file.summary_status = "processing"
    file.summary_error = None
    db.commit()
    
    background_tasks.add_task(summary_index_service.reindex_summary, file_id)
    return {"file_id": file_id, "status": "processing", "message": "Reindexing started in background"}


@router.get("/status")
def get_rag_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file_summary_stats = {
        status: count
        for status, count in db.query(File.summary_status, func.count(File.id)).group_by(File.summary_status).all()
    }
    summary_index_stats = {
        status: count
        for status, count in db.query(DocumentSummary.index_status, func.count(DocumentSummary.id))
        .group_by(DocumentSummary.index_status)
        .all()
    }
    return {
        "file_summary_stats": file_summary_stats,
        "summary_index_stats": summary_index_stats,
        "total_summaries": db.query(DocumentSummary).count(),
        "total_sources": db.query(RagSource).count(),
        "total_chunks": db.query(SummaryChunk).count(),
    }
