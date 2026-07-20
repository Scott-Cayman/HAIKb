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
from app.services.resource_access import get_file_capabilities
from app.services.summary_generator import summary_generator_service
from app.services.summary_index_service import summary_index_service


router = APIRouter()


def _require_admin(current_user: User) -> None:
    if not (current_user.is_admin or current_user.is_super_admin):
        raise HTTPException(status_code=403, detail="仅管理员可执行此操作")


def _get_file_for_capability(
    db: Session,
    file_id: int,
    current_user: User,
    capability: str,
) -> File:
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    capabilities = get_file_capabilities(db, file, current_user)
    if not getattr(capabilities, capability, False):
        raise HTTPException(status_code=403, detail="您没有操作此文件的权限")
    return file


class ManualSummaryRequest(BaseModel):
    summary_text: str


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
    _require_admin(current_user)
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
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="仅超级管理员可以重建全局索引")
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
    file = _get_file_for_capability(db, file_id, current_user, "can_edit")
    
    file.summary_status = "processing"
    file.summary_error = None
    db.commit()
    
    background_tasks.add_task(summary_index_service.generate_summary_and_index_task, file_id)
    return {"file_id": file_id, "status": "processing", "message": "Summary generation started in background"}


@router.post("/files/batch-summarize")
def batch_summarize_files(
    payload: BatchSummaryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_file_ids = list(dict.fromkeys(payload.file_ids))
    files = db.query(File).filter(
        File.id.in_(normalized_file_ids) if normalized_file_ids else False,
        File.is_deleted == False,
    ).all()
    files_by_id = {file.id: file for file in files}
    if len(files_by_id) != len(normalized_file_ids):
        raise HTTPException(status_code=404, detail="部分文件不存在或已删除")
    if any(not get_file_capabilities(db, file, current_user).can_edit for file in files):
        raise HTTPException(status_code=403, detail="您没有生成部分文件总结的权限")
    try:
        return batch_summary_service.create_task(normalized_file_ids, owner_user_id=current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/batch-tasks/{task_id}")
def get_batch_summary_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    try:
        return batch_summary_service.get_task_status(
            task_id,
            owner_user_id=current_user.id,
            is_super_admin=current_user.is_super_admin,
        )
    except Exception as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/files/{file_id}/summary")
def get_file_summary(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = _get_file_for_capability(db, file_id, current_user, "can_view")

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
    file = _get_file_for_capability(db, file_id, current_user, "can_edit")
    
    file.summary_status = "processing"
    file.summary_error = None
    db.commit()
    
    background_tasks.add_task(summary_index_service.reindex_summary, file_id)
    return {"file_id": file_id, "status": "processing", "message": "Reindexing started in background"}


@router.post("/files/{file_id}/manual-summary")
def save_manual_summary(
    file_id: int,
    payload: ManualSummaryRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """手动保存总结（用于视频等不支持自动解析的格式）"""
    file = _get_file_for_capability(db, file_id, current_user, "can_edit")

    if not payload.summary_text.strip():
        raise HTTPException(status_code=400, detail="总结内容不能为空")

    # 将用户输入包装成标准 summary markdown 格式
    markdown = f"""# AI_DOCUMENT_SUMMARY

## 0. 机器可读元数据
- file_id: {file.id}
- original_name: {file.original_name}
- document_type: 手动总结
- parse_scope: manual
- parse_pages: 0
- parse_confidence: manual

## 1. 文件一句话判断
{payload.summary_text.strip().splitlines()[0][:200]}

## 2. 两句话简介
{payload.summary_text.strip()}

## 3. 标签
- 客户类型：未识别
- 项目类型：未识别
- 文件类型：手动总结
- 行业标签：[]
- 区域标签：[]
- 关键词标签：[]

## 4. 重要信息摘要
（由用户手动填写，见上方简介）

## 5. 可复用价值
该文件包含用户手动编写的总结，可用于企业知识检索。

## 6. 适合被以下问题检索到
- 查找 {file.original_name}

## 7. 检索关键词扩展
{file.original_name}

## 8. 解析限制
本总结由用户手动编写，未经 AI 自动解析。
"""

    # 写入磁盘
    summary_file_path = summary_index_service._write_summary_markdown(file.id, markdown)

    # 提取结构化字段
    fields = summary_generator_service.extract_structured_fields(markdown)

    # 更新或创建 DocumentSummary 记录
    summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file.id).first()
    if not summary:
        summary = DocumentSummary(file_id=file.id, summary_markdown="")
        db.add(summary)
        db.flush()

    summary.summary_markdown = markdown
    summary.summary_file_path = str(summary_file_path)
    summary.one_line_judgement = fields.get("one_line_judgement")
    summary.two_sentence_intro = fields.get("two_sentence_intro")
    summary.client_type = fields.get("client_type")
    summary.project_type = fields.get("project_type")
    summary.document_type = fields.get("document_type")
    summary.region_tags = fields.get("region_tags")
    summary.industry_tags = fields.get("industry_tags")
    summary.keyword_tags = fields.get("keyword_tags")
    summary.parse_pages = 0
    summary.parse_status = "manual"
    summary.parse_confidence = "manual"
    summary.parse_error = None
    summary.index_status = "pending"
    summary.index_error = None
    db.commit()
    db.refresh(summary)

    # 更新文件状态
    file.summary_status = "success"
    file.summary_error = None
    db.commit()

    summary_id = summary.id

    # 后台索引
    def _index_task():
        from app.database import SessionLocal as SL
        try:
            index = index_manager.get_default_index()
            pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
            pipeline.run(summary_id, reindex=True)
        except Exception as exc:
            with SL() as bg_db:
                bg_summary = bg_db.query(DocumentSummary).filter(DocumentSummary.id == summary_id).first()
                if bg_summary:
                    bg_summary.index_status = "failed"
                    bg_summary.index_error = str(exc)
                    bg_db.commit()

    background_tasks.add_task(_index_task)

    return {
        "file_id": file.id,
        "summary_status": file.summary_status,
        "summary_error": file.summary_error,
        "summary": summary,
    }


@router.get("/status")
def get_rag_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
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
