import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from jose import JWTError, jwt as jose_jwt
from app.dependencies.auth import get_current_user
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.models.folder import Folder
from app.models.rag_index import SummaryChunk
from app.models.resource_permission import ResourcePermission
from app.models.setting import SystemSetting
from app.models.user import User
from app.models.user_file_view import UserFileView
from app.services.audit_log_service import record_audit_log
from app.services.department_scope_service import department_scope_service
from app.services.folder_access import get_user_specific_department
from app.services.resource_access import (
    CAPABILITY_VIEW,
    RESOURCE_TYPE_FILE,
    RESOURCE_TYPE_FOLDER,
    SUBJECT_TYPE_ALL,
    SUBJECT_TYPE_ORG,
    SUBJECT_TYPE_USER,
    get_file_capabilities,
    get_folder_capabilities,
    list_visible_files,
    list_visible_folders,
)
from app.services.summary_index_service import generate_summary_and_index_task
from app.services.folder_summary_service import folder_summary_service
from app.services.resource_move_service import (
    ResourceMoveError,
    move_file,
    refresh_folder_summaries_after_move,
)
from app.services.folder_ai_preset_service import folder_ai_preset_service
from app.services.upload_folder_service import (
    ensure_upload_folder_parts,
    normalize_upload_folder_parts,
)
from app.services.file_preview_service import (
    IMAGE_EXTENSIONS,
    OFFICE_EXTENSIONS,
    PRESENTATION_EXTENSIONS,
    SUPPORTED_THUMBNAIL_EXTENSIONS,
    VIDEO_EXTENSIONS,
    enqueue_file_preview,
)

router = APIRouter()
LARGE_VIDEO_PREVIEW_THRESHOLD_BYTES = 1024 * 1024 * 1024
MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdown", ".mkd"}
PLAIN_TEXT_EXTENSIONS = {".txt"}
TEXT_PREVIEW_EXTENSIONS = MARKDOWN_EXTENSIONS | PLAIN_TEXT_EXTENSIONS
MARKDOWN_PREVIEW_MAX_BYTES = 20 * 1024 * 1024


def _normalized_file_extension(file: File) -> str:
    """Return a stable lowercase extension for both new and legacy records."""
    value = (file.file_ext or "").strip().lower()
    if value:
        return value if value.startswith(".") else f".{value}"
    return Path(file.original_name or "").suffix.lower()


def _read_text_as_utf8(path: str) -> str:
    source_path = Path(path)
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail="Text source file not found")
    if source_path.stat().st_size > MARKDOWN_PREVIEW_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Text file is too large for online preview")

    payload = source_path.read_bytes()
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _file_update_age_seconds(file: File) -> float:
    value = file.updated_at or file.created_at
    if value is None:
        return float("inf")
    now = datetime.now(value.tzinfo) if value.tzinfo else datetime.utcnow()
    return max(0.0, (now - value).total_seconds())


class FilePermissionRulePayload(BaseModel):
    subject_type: str
    subject_value: Optional[str] = None


class FilePermissionRuleResponse(BaseModel):
    subject_type: str
    subject_value: Optional[str] = None


class FilePermissionsUpdate(BaseModel):
    view_rules: List[FilePermissionRulePayload] = Field(default_factory=list)


class FilePermissionsResponse(BaseModel):
    file_id: int
    file_name: str
    permission_rules: List[FilePermissionRuleResponse] = Field(default_factory=list)
    effective_permission_rules: List[FilePermissionRuleResponse] = Field(default_factory=list)
    inherited_from_folder_id: Optional[int] = None
    inherited_from_folder_name: Optional[str] = None
    available_org_units: List[str] = Field(default_factory=list)
    candidate_users: List[Dict[str, object]] = Field(default_factory=list)


def _file_permission_org_units(db: Session) -> List[str]:
    directory_setting = db.query(SystemSetting).filter(SystemSetting.key == "dingtalk_directory_tree").first()
    if directory_setting:
        try:
            payload = json.loads(directory_setting.value)
        except (TypeError, json.JSONDecodeError):
            payload = {}
        units = set()
        for item in payload.get("departments", []) if isinstance(payload, dict) else []:
            if not isinstance(item, dict) or item.get("parent_id") is None:
                continue
            scope_path = (item.get("scope_path") or "").strip()
            if not scope_path:
                full_path = (item.get("path") or "").strip()
                scope_path = full_path.split("/", 1)[1] if "/" in full_path else (item.get("name") or "").strip()
            if scope_path:
                units.add(scope_path)
        if units:
            return sorted(units)

    rows = db.query(User.full_department_path).filter(User.is_active == True, User.full_department_path != None).all()
    result = set()
    for row in rows:
        parts = [part.strip() for part in (row[0] or "").split("/") if part.strip()]
        prefix: List[str] = []
        for part in parts:
            prefix.append(part)
            result.add("/".join(prefix))
    return sorted(result)


def _file_permission_candidates(db: Session, current_user: User) -> List[User]:
    query = db.query(User).filter(User.is_active == True)
    if not current_user.is_super_admin:
        department = (current_user.department_name or "").strip()
        if department:
            query = query.filter(or_(User.department_name == department, User.full_department_path.contains(department)))
        else:
            query = query.filter(User.id == current_user.id)
    return query.order_by(User.name.asc(), User.id.asc()).all()


def _direct_file_view_rules(db: Session, file_id: int) -> List[ResourcePermission]:
    return db.query(ResourcePermission).filter(
        ResourcePermission.resource_type == RESOURCE_TYPE_FILE,
        ResourcePermission.resource_id == file_id,
        ResourcePermission.capability == CAPABILITY_VIEW,
    ).all()


def _inherited_file_view_rules(db: Session, file: File) -> tuple[List[ResourcePermission], Optional[Folder]]:
    current_id = file.folder_id
    visited = set()
    while current_id and current_id not in visited:
        visited.add(current_id)
        folder = db.query(Folder).filter(Folder.id == current_id, Folder.is_deleted == False).first()
        if not folder:
            break
        rules = db.query(ResourcePermission).filter(
            ResourcePermission.resource_type == RESOURCE_TYPE_FOLDER,
            ResourcePermission.resource_id == folder.id,
            ResourcePermission.capability == CAPABILITY_VIEW,
            ResourcePermission.inherit_to_children == True,
        ).all()
        if rules:
            return rules, folder
        current_id = folder.parent_id
    return [], None


def _serialize_file_permission_rule(rule: ResourcePermission) -> FilePermissionRuleResponse:
    return FilePermissionRuleResponse(
        subject_type="org" if rule.subject_type == "department" else rule.subject_type,
        subject_value=rule.subject_value,
    )

class TitleSearchItem(BaseModel):
    id: int
    title: str
    kind: str
    hit_count: int


class TitleSearchResponse(BaseModel):
    query: str
    tokens: List[str]
    results: List[TitleSearchItem]


class KeywordFileSearchItem(BaseModel):
    file_id: int
    summary_id: Optional[int] = None
    original_name: str
    one_line_judgement: str
    score: float
    preview_url: str
    download_url: str
    folder_id: Optional[int] = None
    folder_name: Optional[str] = None
    folder_path: Optional[str] = None
    file_ext: Optional[str] = None
    preview_status: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    size: int = 0
    matched_fields: List[str] = Field(default_factory=list)
    match_excerpt: Optional[str] = None


class KeywordFileSearchResponse(BaseModel):
    query: str
    tokens: List[str]
    total: int
    results: List[KeywordFileSearchItem]
    elapsed_ms: float


def _two_char_tokens(text: str, max_tokens: int = 12) -> List[str]:
    normalized = "".join((text or "").split())
    if len(normalized) < 2:
        return []
    seen = set()
    tokens: List[str] = []
    for idx in range(len(normalized) - 1):
        token = normalized[idx : idx + 2]
        if token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= max_tokens:
            break
    return tokens


def _keyword_search_terms(text: str, max_terms: int = 16) -> List[str]:
    """Build literal search terms without semantic expansion.

    Keyword mode intentionally stays deterministic: the complete phrase gets
    the highest weight and short n-grams only provide tolerant partial matches.
    """
    normalized = re.sub(r"\s+", "", (text or "").strip().lower())
    if len(normalized) < 2:
        return []

    terms: List[str] = [normalized]
    for token in _two_char_tokens(normalized, max_tokens=max_terms):
        lowered = token.lower()
        if lowered not in terms:
            terms.append(lowered)
    for token in re.findall(r"[a-z0-9_\-]{2,}", (text or "").lower()):
        if token not in terms:
            terms.append(token)
    return terms[:max_terms]


def _keyword_match_score(
    value: Optional[str],
    *,
    phrase: str,
    partial_terms: List[str],
    exact_score: float,
    partial_score: float,
) -> tuple[float, int]:
    normalized_value = re.sub(r"\s+", "", (value or "").lower())
    if not normalized_value:
        return 0.0, 0
    if phrase in normalized_value:
        return exact_score, max(1, len(partial_terms))
    hits = sum(1 for term in partial_terms if term and term in normalized_value)
    minimum_hits = 1 if len(partial_terms) <= 2 else max(2, (len(partial_terms) + 1) // 2)
    if hits < minimum_hits:
        return 0.0, 0
    coverage = hits / max(1, len(partial_terms))
    return min(exact_score - 0.01, partial_score + coverage * 0.14), hits


def _keyword_excerpt(value: Optional[str], terms: List[str], max_chars: int = 140) -> Optional[str]:
    text = re.sub(r"\s+", " ", (value or "").strip())
    if not text:
        return None
    lowered = text.lower()
    positions = [lowered.find(term) for term in terms if term and lowered.find(term) >= 0]
    if not positions:
        return text[:max_chars] + ("…" if len(text) > max_chars else "")
    match_at = min(positions)
    start = max(0, match_at - 36)
    end = min(len(text), start + max_chars)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def _folder_search_paths(db: Session, folder_ids: List[int]) -> Dict[int, str]:
    if not folder_ids:
        return {}
    rows = db.query(Folder).filter(Folder.is_deleted == False).all()
    folder_map = {row.id: row for row in rows}
    result: Dict[int, str] = {}
    for folder_id in set(folder_ids):
        names: List[str] = []
        current_id: Optional[int] = folder_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            current = folder_map.get(current_id)
            if not current:
                break
            names.append(current.name)
            current_id = current.parent_id
        result[folder_id] = " / ".join(reversed(names))
    return result


def _internal_keyword_file_search(
    *,
    q: str,
    allowed_file_ids: List[int],
    limit: int,
    offset: int,
    db: Session,
) -> KeywordFileSearchResponse:
    started_at = time.perf_counter()
    terms = _keyword_search_terms(q)
    if not terms or not allowed_file_ids:
        return KeywordFileSearchResponse(
            query=q,
            tokens=terms,
            total=0,
            results=[],
            elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
        )

    phrase = terms[0]
    partial_terms = terms[1:] or terms
    metadata_fields = [
        File.original_name,
        DocumentSummary.one_line_judgement,
        DocumentSummary.two_sentence_intro,
        DocumentSummary.keyword_tags,
        DocumentSummary.client_type,
        DocumentSummary.project_type,
        DocumentSummary.document_type,
        DocumentSummary.region_tags,
        DocumentSummary.industry_tags,
    ]
    metadata_conditions = [
        func.lower(func.coalesce(field, "")).contains(term)
        for term in terms
        for field in metadata_fields
    ]
    direct_rows = (
        db.query(File, DocumentSummary)
        .outerjoin(
            DocumentSummary,
            and_(DocumentSummary.file_id == File.id, DocumentSummary.is_deleted == False),
        )
        .filter(File.id.in_(allowed_file_ids), File.is_deleted == False)
        .filter(or_(*metadata_conditions))
        .order_by(File.id.desc())
        .limit(max(500, (limit + offset) * 20))
        .all()
    )

    result_map: Dict[int, Dict[str, object]] = {}
    row_cache: Dict[int, tuple[File, Optional[DocumentSummary]]] = {}

    def ensure_result(file: File, summary: Optional[DocumentSummary]) -> Dict[str, object]:
        row_cache[file.id] = (file, summary)
        existing = result_map.get(file.id)
        if existing is not None:
            return existing
        existing = {
            "file": file,
            "summary": summary,
            "score": 0.0,
            "matched_fields": [],
            "match_excerpt": None,
        }
        result_map[file.id] = existing
        return existing

    score_fields = (
        ("文件名", lambda file, summary: file.original_name, 1.0, 0.82),
        ("关键词标签", lambda file, summary: summary.keyword_tags if summary else None, 0.88, 0.72),
        ("文件描述", lambda file, summary: summary.one_line_judgement if summary else None, 0.84, 0.68),
        ("文件简介", lambda file, summary: summary.two_sentence_intro if summary else None, 0.81, 0.65),
        (
            "分类标签",
            lambda file, summary: " ".join(
                filter(
                    None,
                    [
                        summary.client_type if summary else None,
                        summary.project_type if summary else None,
                        summary.document_type if summary else None,
                        summary.region_tags if summary else None,
                        summary.industry_tags if summary else None,
                    ],
                )
            ),
            0.76,
            0.60,
        ),
    )

    for file, summary in direct_rows:
        result = ensure_result(file, summary)
        for field_name, get_value, exact_score, partial_score in score_fields:
            value = get_value(file, summary)
            score, hit_count = _keyword_match_score(
                value,
                phrase=phrase,
                partial_terms=partial_terms,
                exact_score=exact_score,
                partial_score=partial_score,
            )
            if hit_count <= 0:
                continue
            result["score"] = max(float(result["score"]), score)
            matched_fields = result["matched_fields"]
            if field_name not in matched_fields:
                matched_fields.append(field_name)
            if not result["match_excerpt"] and field_name != "文件名":
                result["match_excerpt"] = _keyword_excerpt(value, terms)

    chunk_conditions = [func.lower(SummaryChunk.content).contains(term) for term in terms]
    chunk_rows = (
        db.query(SummaryChunk.file_id, SummaryChunk.summary_id, SummaryChunk.content)
        .filter(SummaryChunk.file_id.in_(allowed_file_ids))
        .filter(or_(*chunk_conditions))
        .order_by(SummaryChunk.id.asc())
        .limit(max(800, (limit + offset) * 40))
        .all()
    )
    chunk_file_ids = {row.file_id for row in chunk_rows if row.file_id not in row_cache}
    if chunk_file_ids:
        for file, summary in (
            db.query(File, DocumentSummary)
            .outerjoin(
                DocumentSummary,
                and_(DocumentSummary.file_id == File.id, DocumentSummary.is_deleted == False),
            )
            .filter(File.id.in_(chunk_file_ids), File.is_deleted == False)
            .all()
        ):
            row_cache[file.id] = (file, summary)

    for row in chunk_rows:
        cached = row_cache.get(row.file_id)
        if not cached:
            continue
        file, summary = cached
        result = ensure_result(file, summary)
        score, hit_count = _keyword_match_score(
            row.content,
            phrase=phrase,
            partial_terms=partial_terms,
            exact_score=0.79,
            partial_score=0.56,
        )
        if hit_count <= 0:
            continue
        result["score"] = max(float(result["score"]), score)
        if "文件内容" not in result["matched_fields"]:
            result["matched_fields"].append("文件内容")
        if not result["match_excerpt"]:
            result["match_excerpt"] = _keyword_excerpt(row.content, terms)

    folder_ids = [
        result["file"].folder_id
        for result in result_map.values()
        if result["file"].folder_id is not None
    ]
    folder_paths = _folder_search_paths(db, folder_ids)
    folder_names = {
        row.id: row.name
        for row in db.query(Folder).filter(Folder.id.in_(set(folder_ids))).all()
    } if folder_ids else {}

    serialized: List[KeywordFileSearchItem] = []
    for result in result_map.values():
        if float(result["score"]) <= 0:
            continue
        file = result["file"]
        summary = result["summary"]
        judgement = (
            (summary.one_line_judgement if summary else None)
            or (summary.two_sentence_intro if summary else None)
            or result["match_excerpt"]
            or "该文件尚未生成描述，可根据文件名判断是否查看。"
        )
        serialized.append(
            KeywordFileSearchItem(
                file_id=file.id,
                summary_id=summary.id if summary else None,
                original_name=file.original_name,
                one_line_judgement=judgement,
                score=round(float(result["score"]), 6),
                preview_url=f"/api/files/{file.id}/preview",
                download_url=f"/api/files/{file.id}/download",
                folder_id=file.folder_id,
                folder_name=folder_names.get(file.folder_id),
                folder_path=folder_paths.get(file.folder_id),
                file_ext=file.file_ext,
                preview_status=file.preview_status or "unsupported",
                created_at=file.created_at,
                updated_at=file.updated_at,
                size=file.size or 0,
                matched_fields=result["matched_fields"],
                match_excerpt=result["match_excerpt"],
            )
        )

    serialized.sort(
        key=lambda item: (
            item.score,
            1 if "文件名" in item.matched_fields else 0,
            item.created_at.timestamp() if item.created_at else 0.0,
            item.file_id,
        ),
        reverse=True,
    )
    total = len(serialized)
    page = serialized[offset : offset + limit]
    return KeywordFileSearchResponse(
        query=q,
        tokens=terms,
        total=total,
        results=page,
        elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
    )


def office_to_pdf(input_path: str, output_dir: str) -> Path:
    import platform

    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    system = platform.system()
    soffice_cmd: Optional[str] = None

    if system == "Windows":
        soffice_cmd = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice_cmd:
            common_paths = [
                r"C:\Program Files\LibreOffice\program\soffice.exe",
                r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            ]
            for path in common_paths:
                if Path(path).exists():
                    soffice_cmd = path
                    break
        if not soffice_cmd:
            raise RuntimeError("LibreOffice 未安装或未加入 PATH，无法进行 Office→PDF 转换。")
    else:
        soffice_cmd = shutil.which("soffice") or shutil.which("libreoffice")
        if not soffice_cmd:
            raise RuntimeError("LibreOffice 未安装或未加入 PATH，无法进行 Office→PDF 转换。")

    cmd = [
        soffice_cmd,
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        str(output_dir),
        str(input_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {result.stderr}")

    output_file = output_dir / f"{input_path.stem}.pdf"
    if not output_file.exists():
        candidates = [
            p
            for p in output_dir.iterdir()
            if p.is_file() and p.suffix.lower() == ".pdf" and p.stem == input_path.stem
        ]
        if candidates:
            output_file = candidates[0]
        else:
            raise RuntimeError("PDF file was not created after conversion")
    return output_file


def convert_to_pdf(storage_path: str, preview_path: str, file_ext: str, file_id: int):
    try:
        output_dir = Path(preview_path).parent
        converted_pdf = office_to_pdf(storage_path, str(output_dir))
        if converted_pdf.exists() and converted_pdf.stat().st_size > 0:
            shutil.move(str(converted_pdf), preview_path)

        db = SessionLocal()
        db_file = db.query(File).filter(File.id == file_id).first()
        if db_file:
            if os.path.exists(preview_path):
                db_file.preview_status = "success"
                db_file.preview_path = preview_path
            else:
                db_file.preview_status = "failed"
            db.commit()
        db.close()
    except Exception:
        db = SessionLocal()
        db_file = db.query(File).filter(File.id == file_id).first()
        if db_file:
            db_file.preview_status = "failed"
            db.commit()
        db.close()


def _detect_video_codec_tag(file_path: str) -> Optional[str]:
    try:
        with open(file_path, "rb") as f:
            head = f.read(2 * 1024 * 1024)
            try:
                size = os.path.getsize(file_path)
            except Exception:
                size = 0
            tail = b""
            if size and size > 2 * 1024 * 1024:
                try:
                    f.seek(max(0, size - 2 * 1024 * 1024))
                    tail = f.read(2 * 1024 * 1024)
                except Exception:
                    tail = b""
    except Exception:
        return None

    data = head + tail
    for tag in (b"hvc1", b"hev1", b"avc1", b"av01", b"vp09"):
        if tag in data:
            return tag.decode("ascii", errors="ignore")
    return None


def transcode_video_to_h264(storage_path: str, preview_path: str, file_id: int):
    db = SessionLocal()
    try:
        ffmpeg_cmd = shutil.which("ffmpeg")
        if not ffmpeg_cmd:
            raise RuntimeError("ffmpeg not found")

        output_dir = Path(preview_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            ffmpeg_cmd,
            "-y",
            "-i",
            storage_path,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "26",
            "-vf",
            "scale='min(1920,iw)':-2:force_original_aspect_ratio=decrease",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-movflags",
            "+faststart",
            preview_path,
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60 * 60)

        db_file = db.query(File).filter(File.id == file_id).first()
        if result.returncode == 0 and os.path.exists(preview_path) and os.path.getsize(preview_path) > 0:
            if db_file:
                db_file.preview_status = "success"
                db_file.preview_path = preview_path
        else:
            if os.path.exists(preview_path):
                try:
                    os.remove(preview_path)
                except Exception:
                    pass
            if db_file:
                db_file.preview_status = "failed"
        db.commit()
    except Exception:
        db_file = db.query(File).filter(File.id == file_id).first()
        if db_file:
            db_file.preview_status = "failed"
            db.commit()
    finally:
        db.close()


class FileResponseModel(BaseModel):
    id: int
    original_name: str
    file_ext: str
    size: int
    folder_id: Optional[int]
    preview_status: str
    preview_kind: Optional[str] = None
    preview_page_count: int = 0
    preview_error: Optional[str] = None
    preview_version: Optional[str] = None
    thumbnail_status: Optional[str] = None
    summary_status: str
    uploaded_by: int
    created_at: Optional[datetime] = None
    client_type: Optional[str] = None
    project_type: Optional[str] = None
    document_type: Optional[str] = None
    region_tags: Optional[str] = None
    industry_tags: Optional[str] = None
    keyword_tags: Optional[str] = None
    capabilities: Dict[str, bool] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class RecentFileResponseModel(FileResponseModel):
    region_tags: Optional[str] = None
    industry_tags: Optional[str] = None
    keyword_tags: Optional[str] = None


class FileUpdateRequest(BaseModel):
    original_name: Optional[str] = None


class FileMoveRequest(BaseModel):
    target_folder_id: int


class FileMoveResponse(BaseModel):
    resource_type: str
    resource_id: int
    old_parent_id: int
    target_folder_id: int
    target_path: str


def _serialize_file(file: File, db: Session, current_user: User) -> FileResponseModel:
    capabilities = get_file_capabilities(db, file, current_user)
    summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file.id).first()
    preview_version = None
    preview_source = Path(file.preview_path or file.storage_path or "")
    if preview_source.exists() and preview_source.is_file():
        preview_stat = preview_source.stat()
        preview_version = f"{preview_stat.st_mtime_ns:x}-{preview_stat.st_size:x}"
    return FileResponseModel(
        id=file.id,
        original_name=file.original_name,
        file_ext=file.file_ext,
        size=file.size,
        folder_id=file.folder_id,
        preview_status=file.preview_status,
        preview_kind=file.preview_kind,
        preview_page_count=file.preview_page_count or 0,
        preview_error=file.preview_error,
        preview_version=preview_version,
        thumbnail_status=file.thumbnail_status,
        summary_status=file.summary_status,
        uploaded_by=file.uploaded_by,
        created_at=file.created_at,
        client_type=summary.client_type if summary else None,
        project_type=summary.project_type if summary else None,
        document_type=summary.document_type if summary else None,
        region_tags=summary.region_tags if summary else None,
        industry_tags=summary.industry_tags if summary else None,
        keyword_tags=summary.keyword_tags if summary else None,
        capabilities=capabilities.to_dict(),
    )


def _get_allowed_file_ids(db: Session, current_user: User, candidate_file_ids: Optional[List[int]] = None) -> List[int]:
    query = (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
    )
    if candidate_file_ids is not None:
        if not candidate_file_ids:
            return []
        query = query.filter(File.id.in_(candidate_file_ids))

    files = query.all()
    return [file.id for file in list_visible_files(db, files, current_user)]


def _internal_title_search(q: str, limit: int, db: Session, current_user: User) -> TitleSearchResponse:
    tokens = _two_char_tokens(q)
    if not tokens:
        return {"query": q, "tokens": [], "results": []}

    like_filters_files = [File.original_name.contains(token) for token in tokens]
    like_filters_folders = [Folder.name.contains(token) for token in tokens]

    files = (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
        .filter(or_(*like_filters_files))
        .order_by(File.id.desc())
        .limit(max(50, limit * 6))
        .all()
    )
    folders = (
        db.query(Folder)
        .filter(Folder.is_deleted == False)
        .filter(or_(*like_filters_folders))
        .order_by(Folder.id.desc())
        .limit(max(50, limit * 6))
        .all()
    )

    visible_folders = list_visible_folders(db, folders, current_user)
    visible_files = list_visible_files(db, files, current_user)

    results: List[TitleSearchItem] = []
    for row in visible_folders:
        title = row.name or ""
        hit_count = sum(1 for token in tokens if token in title)
        if hit_count <= 0:
            continue
        results.append(TitleSearchItem(id=row.id, title=title, kind="folder", hit_count=hit_count))
    for row in visible_files:
        title = row.original_name or ""
        hit_count = sum(1 for token in tokens if token in title)
        if hit_count <= 0:
            continue
        results.append(TitleSearchItem(id=row.id, title=title, kind="file", hit_count=hit_count))

    results.sort(key=lambda item: (item.hit_count, 1 if item.kind == "file" else 0, item.id), reverse=True)
    return {"query": q, "tokens": tokens, "results": results[: max(1, min(50, limit))]}


@router.get("/title-search", response_model=TitleSearchResponse)
def title_search(
    q: str,
    limit: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _internal_title_search(q, limit, db, current_user)


@router.get("/keyword-search", response_model=KeywordFileSearchResponse)
def keyword_file_search(
    q: str,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    current_folder_id: Optional[int] = Query(default=None),
    test_department_name: Optional[str] = Query(default=None),
    x_test_department_name: Optional[str] = Header(default=None, alias="X-Test-Department-Name"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Search visible files by literal filename, metadata and indexed content."""
    if len(re.sub(r"\s+", "", q or "")) < 2:
        raise HTTPException(status_code=400, detail="请输入至少两个连续字符")

    requested_department_name = test_department_name or x_test_department_name
    scoped_user = department_scope_service.build_scoped_user(current_user, requested_department_name)
    allowed_file_ids = _get_allowed_file_ids(db, scoped_user)

    if current_folder_id is not None:
        folder = db.query(Folder).filter(Folder.id == current_folder_id, Folder.is_deleted == False).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        subtree_ids = folder_ai_preset_service.folder_descendant_ids(db, current_folder_id)
        allowed_file_ids = [
            row[0]
            for row in db.query(File.id)
            .filter(File.id.in_(allowed_file_ids), File.folder_id.in_(subtree_ids), File.is_deleted == False)
            .all()
        ]

    return _internal_keyword_file_search(
        q=q.strip(),
        allowed_file_ids=allowed_file_ids,
        limit=limit,
        offset=offset,
        db=db,
    )


# 统一搜索响应模型
class RelatedFileItem(BaseModel):
    file_id: int
    summary_id: int
    original_name: str
    one_line_judgement: str
    score: float
    preview_url: str
    download_url: str
    folder_id: Optional[int] = None


class AgentEvidenceItem(BaseModel):
    summary_id: int
    file_id: int
    chunk_id: str
    content: str
    score: float
    file_name: Optional[str] = None


class AgentAnswerItem(BaseModel):
    conversation_id: str
    answer: str
    evidence: List[AgentEvidenceItem]
    related_files: List[RelatedFileItem]


class UnifiedSearchResponse(BaseModel):
    query: str
    agent: Optional[AgentAnswerItem] = None
    keyword: Optional[TitleSearchResponse] = None
    error: Optional[str] = None


@router.get("/unified-search", response_model=UnifiedSearchResponse)
def unified_search(
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    test_department_name: Optional[str] = Query(default=None),
    x_test_department_name: Optional[str] = Header(default=None, alias="X-Test-Department-Name"),
):
    from app.services.agent_service_optimized import agent_service

    response = UnifiedSearchResponse(query=q)
    requested_department_name = test_department_name or x_test_department_name
    scoped_user = department_scope_service.build_scoped_user(current_user, requested_department_name)
    allowed_file_ids = _get_allowed_file_ids(db, scoped_user)

    try:
        agent_result = agent_service.chat(
            query=q,
            top_k=8,
            retrieval_mode="hybrid",
            user_id=current_user.id,
            scoped_user=scoped_user,
            override_department_name=requested_department_name,
            allowed_file_ids=allowed_file_ids,
        )
        response.agent = AgentAnswerItem(**agent_result)
    except Exception as e:
        response.error = str(e)

    try:
        keyword_result = _internal_title_search(q, 20, db, current_user)
        response.keyword = keyword_result
    except Exception as e:
        response.error = str(e)

    return response


@router.patch("/{file_id}", response_model=FileResponseModel)
def update_file(
    file_id: int,
    payload: FileUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    capabilities = get_file_capabilities(db, file, current_user)
    if not capabilities.can_rename:
        raise HTTPException(status_code=403, detail="You don't have permission to rename this file")

    if payload.original_name is not None:
        new_name = payload.original_name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="original_name required")
        old_name = file.original_name
        file.original_name = new_name
        record_audit_log(
            db,
            current_user,
            "file.rename",
            "file",
            file.id,
            request=request,
            detail={"old_name": old_name, "new_name": new_name},
        )
        db.commit()
        db.refresh(file)
    return _serialize_file(file, db, current_user)


@router.post("/{file_id}/move", response_model=FileMoveResponse)
def move_file_endpoint(
    file_id: int,
    payload: FileMoveRequest,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(
        File.id == file_id,
        File.is_deleted == False,
    ).with_for_update().first()
    target_folder = db.query(Folder).filter(
        Folder.id == payload.target_folder_id,
        Folder.is_deleted == False,
    ).with_for_update().first()
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not target_folder:
        raise HTTPException(status_code=404, detail="目标文件夹不存在")
    if not get_file_capabilities(db, file, current_user).can_move:
        raise HTTPException(status_code=403, detail="您没有移动此文件的权限")
    if not get_folder_capabilities(db, target_folder, current_user).can_upload:
        raise HTTPException(status_code=403, detail="您没有向目标目录移动内容的权限")

    try:
        result = move_file(db, file, target_folder)
        record_audit_log(
            db,
            current_user,
            "file.move",
            "file",
            file.id,
            request=request,
            detail={
                "name": file.original_name,
                "old_parent_id": result.old_parent_id,
                "target_folder_id": result.target_folder_id,
                "target_path": result.target_path,
            },
        )
        db.commit()
    except ResourceMoveError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception:
        db.rollback()
        raise

    background_tasks.add_task(
        refresh_folder_summaries_after_move,
        result.old_parent_id,
        result.target_folder_id,
    )
    return FileMoveResponse(**result.__dict__)


@router.post("/upload", response_model=FileResponseModel)
async def upload_file(
    background_tasks: BackgroundTasks,
    request: Request,
    file: UploadFile = FastAPIFile(...),
    folder_id: Optional[int] = Form(None),
    relative_path: Optional[str] = Form(None),
    auto_start_summary: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_folder_id = folder_id

    if folder_id is not None:
        requested_folder = db.query(Folder).filter(
            Folder.id == folder_id,
            Folder.is_deleted == False,
        ).first()
        if not requested_folder:
            raise HTTPException(status_code=404, detail="目标文件夹不存在")
        if not get_folder_capabilities(db, requested_folder, current_user).can_upload:
            raise HTTPException(status_code=403, detail="您没有向此目录上传内容的权限")

    if relative_path:
        folder_parts = normalize_upload_folder_parts(relative_path, includes_filename=True)
        ensured_path = ensure_upload_folder_parts(
            folder_parts,
            folder_id,
            db,
            current_user,
            request=request,
            audit_source="file_upload",
        )
        target_folder_id = ensured_path.folder_id

    if target_folder_id:
        folder = db.query(Folder).filter(Folder.id == target_folder_id, Folder.is_deleted == False).first()
        if not folder:
            raise HTTPException(status_code=404, detail="目标文件夹不存在")
        if not get_folder_capabilities(db, folder, current_user).can_upload:
            raise HTTPException(status_code=403, detail="您没有向此目录上传内容的权限")

    ext = os.path.splitext(file.filename)[1].lower()
    stored_name = f"{uuid.uuid4()}{ext}"
    storage_path = os.path.join(settings.STORAGE_DIR, "originals", stored_name)

    max_upload_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    written = 0
    try:
        with open(storage_path, "wb") as buffer:
            while chunk := file.file.read(1024 * 1024):
                written += len(chunk)
                if written > max_upload_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"单个文件不能超过 {settings.MAX_UPLOAD_SIZE_MB} MB",
                    )
                buffer.write(chunk)
    except Exception:
        db.rollback()
        if os.path.exists(storage_path):
            try:
                os.remove(storage_path)
            except OSError:
                pass
        raise

    size = os.path.getsize(storage_path)
    # 视频格式：大多数浏览器可直接播放；HEVC(H.265) 需要转码为 H.264 才能兼容
    VIDEO_EXTS = VIDEO_EXTENSIONS
    preview_status = "unsupported"
    preview_kind = "unsupported"
    thumbnail_status = "unsupported"
    if ext in TEXT_PREVIEW_EXTENSIONS:
        preview_status = "success"
        preview_path = storage_path
        preview_kind = "markdown" if ext in MARKDOWN_EXTENSIONS else "text"
    elif ext == ".pdf" or ext in IMAGE_EXTENSIONS:
        preview_status = "success"
        preview_path = storage_path
        preview_kind = "pdf" if ext == ".pdf" else "image"
        thumbnail_status = "pending"
    elif ext in VIDEO_EXTS:
        codec_tag = _detect_video_codec_tag(storage_path) if ext in {".mp4", ".mov"} else None
        if codec_tag in {"hvc1", "hev1"} or size >= LARGE_VIDEO_PREVIEW_THRESHOLD_BYTES:
            preview_status = "pending"
            preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.mp4")
        else:
            preview_status = "success"
            preview_path = storage_path
        preview_kind = "video"
        thumbnail_status = "pending"
    elif ext in OFFICE_EXTENSIONS:
        preview_status = "pending"
        preview_path = None
        preview_kind = "pages" if ext in PRESENTATION_EXTENSIONS else "pdf"
        thumbnail_status = "pending"
    else:
        preview_path = None

    # 确定文件的部门信息
    department_name = None
    is_super_admin_created = current_user.is_super_admin
    
    if target_folder_id:
        # 如果文件在文件夹中，继承文件夹的部门信息
        folder = db.query(Folder).filter(Folder.id == target_folder_id, Folder.is_deleted == False).first()
        if folder:
            department_name = folder.department_name
            is_super_admin_created = folder.is_super_admin_created
    else:
        # 如果不在文件夹中（根目录），使用当前用户的具体部门信息
        department_name = get_user_specific_department(current_user)
    
    db_file = File(
        folder_id=target_folder_id,
        original_name=file.filename,
        stored_name=stored_name,
        file_ext=ext,
        mime_type=file.content_type,
        size=size,
        storage_path=storage_path,
        preview_path=preview_path,
        preview_status=preview_status,
        preview_kind=preview_kind,
        thumbnail_status=thumbnail_status,
        summary_status="pending",
        uploaded_by=current_user.id,
        department_name=department_name,
        is_super_admin_created=is_super_admin_created
    )
    db.add(db_file)
    try:
        db.flush()
        record_audit_log(
            db,
            current_user,
            "file.upload",
            "file",
            db_file.id,
            request=request,
            detail={
                "name": db_file.original_name,
                "folder_id": db_file.folder_id,
                "size": db_file.size,
                "mime_type": db_file.mime_type,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        if os.path.exists(storage_path):
            try:
                os.remove(storage_path)
            except OSError:
                pass
        raise
    db.refresh(db_file)

    if ext in OFFICE_EXTENSIONS or ext == ".pdf" or ext in IMAGE_EXTENSIONS or ext in VIDEO_EXTS:
        background_tasks.add_task(enqueue_file_preview, db_file.id)

    if preview_status == "pending" and ext in VIDEO_EXTS and db_file.preview_path:
        background_tasks.add_task(transcode_video_to_h264, storage_path, db_file.preview_path, db_file.id)

    if auto_start_summary:
        background_tasks.add_task(generate_summary_and_index_task, db_file.id)
    return _serialize_file(db_file, db, current_user)


@router.get("/recent", response_model=List[RecentFileResponseModel])
def get_recent_files(limit: int = 10, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = (
        db.query(File, DocumentSummary)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .outerjoin(DocumentSummary, DocumentSummary.file_id == File.id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
    )
    
    rows = (
        query
        .order_by(File.created_at.desc())
        .limit(max(limit * 4, 20))
        .all()
    )

    results: List[RecentFileResponseModel] = []
    for file, summary in rows:
        capabilities = get_file_capabilities(db, file, current_user)
        if not capabilities.can_view:
            continue
        results.append(
            RecentFileResponseModel(
                id=file.id,
                original_name=file.original_name,
                file_ext=file.file_ext,
                size=file.size,
                folder_id=file.folder_id,
                preview_status=file.preview_status,
                preview_kind=file.preview_kind,
                preview_page_count=file.preview_page_count or 0,
                preview_error=file.preview_error,
                thumbnail_status=file.thumbnail_status,
                summary_status=file.summary_status,
                uploaded_by=file.uploaded_by,
                created_at=file.created_at,
                capabilities=capabilities.to_dict(),
                region_tags=summary.region_tags if summary else None,
                industry_tags=summary.industry_tags if summary else None,
                keyword_tags=summary.keyword_tags if summary else None,
            )
        )
        if len(results) >= limit:
            break

    return results


@router.get("/folder/{folder_id}")
def get_files_in_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    if not get_folder_capabilities(db, folder, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    
    files = db.query(File).filter(File.folder_id == folder_id, File.is_deleted == False).all()
    return [_serialize_file(file, db, current_user) for file in list_visible_files(db, files, current_user)]


@router.get("/{file_id}", response_model=FileResponseModel)
def get_file(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    capabilities = get_file_capabilities(db, file, current_user)
    if not capabilities.can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file_ext = _normalized_file_extension(file)
    if file_ext in TEXT_PREVIEW_EXTENSIONS and (
        file.preview_status != "success"
        or file.preview_kind != ("markdown" if file_ext in MARKDOWN_EXTENSIONS else "text")
        or file.preview_path != file.storage_path
    ):
        file.file_ext = file_ext
        file.preview_status = "success"
        file.preview_kind = "markdown" if file_ext in MARKDOWN_EXTENSIONS else "text"
        file.preview_path = file.storage_path
        file.preview_error = None
        db.commit()

    # 记录用户文件浏览
    file_view = UserFileView(user_id=current_user.id, file_id=file_id)
    db.add(file_view)
    db.commit()

    # 视频文件：旧数据 preview_status 可能为 "unsupported"，直接修正为 "success"（无需转换）
    VIDEO_EXTS_SET = {".mp4", ".webm", ".ogg", ".mov"}
    if file.preview_status in ["failed", "unsupported"] and file.file_ext in VIDEO_EXTS_SET:
        file.preview_status = "success"
        file.preview_path = file.storage_path
        db.commit()

    if (
        file.preview_status == "success"
        and file.file_ext in VIDEO_EXTS_SET
        and (not file.preview_path or file.preview_path == file.storage_path)
        and file.file_ext in {".mp4", ".mov"}
    ):
        codec_tag = _detect_video_codec_tag(file.storage_path)
        if codec_tag in {"hvc1", "hev1"} or (file.size or 0) >= LARGE_VIDEO_PREVIEW_THRESHOLD_BYTES:
            video_preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.mp4")
            file.preview_status = "pending"
            file.preview_path = video_preview_path
            db.commit()
            background_tasks.add_task(transcode_video_to_h264, file.storage_path, video_preview_path, file.id)

    if file.preview_status in ["failed", "unsupported"] and file.file_ext in OFFICE_EXTENSIONS:
        file.preview_status = "pending"
        file.thumbnail_status = "pending"
        file.preview_error = None
        db.commit()

    thumbnail_path = Path(file.thumbnail_path) if file.thumbnail_path else None
    if (
        (file.file_ext or "").lower() in SUPPORTED_THUMBNAIL_EXTENSIONS
        and (
            file.thumbnail_status != "success"
            or not thumbnail_path
            or not thumbnail_path.exists()
        )
    ):
        background_tasks.add_task(enqueue_file_preview, file.id)

    db.refresh(file)
    return _serialize_file(file, db, current_user)


@router.get("/{file_id}/download")
def download_file(
    file_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not get_file_capabilities(db, file, current_user).can_download:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file.download_count += 1
    record_audit_log(
        db,
        current_user,
        "file.download",
        "file",
        file.id,
        request=request,
        detail={"name": file.original_name, "folder_id": file.folder_id, "size": file.size},
    )
    db.commit()
    return FileResponse(path=file.storage_path, filename=file.original_name)


@router.get("/{file_id}/preview")
def preview_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not get_file_capabilities(db, file, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file_ext = _normalized_file_extension(file)
    is_text_preview = file_ext in TEXT_PREVIEW_EXTENSIONS
    is_markdown = file_ext in MARKDOWN_EXTENSIONS
    expected_preview_kind = "markdown" if is_markdown else "text"
    if is_text_preview and (
        file.preview_status != "success"
        or file.preview_kind != expected_preview_kind
        or file.preview_path != file.storage_path
    ):
        file.file_ext = file_ext
        file.preview_status = "success"
        file.preview_kind = expected_preview_kind
        file.preview_path = file.storage_path
        file.preview_error = None
        db.commit()

    if file.preview_status != "success":
        raise HTTPException(status_code=400, detail="Preview not available")

    if is_text_preview:
        content = _read_text_as_utf8(file.storage_path)
        file.view_count += 1
        db.commit()
        return Response(
            content=content,
            media_type=("text/markdown; charset=utf-8" if is_markdown else "text/plain; charset=utf-8"),
            headers={"Cache-Control": "private, max-age=60"},
        )

    file.view_count += 1
    db.commit()
    path_to_serve = file.preview_path if file.preview_path else file.storage_path
    return FileResponse(path=path_to_serve)


@router.get("/{file_id}/thumbnail")
def file_thumbnail(
    file_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not get_file_capabilities(db, file, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    thumbnail_path = Path(file.thumbnail_path) if file.thumbnail_path else None
    if file.thumbnail_status == "success" and thumbnail_path and thumbnail_path.exists():
        stat = thumbnail_path.stat()
        return FileResponse(
            path=thumbnail_path,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "private, max-age=604800, immutable",
                "ETag": f'W/"thumbnail-{file.id}-{stat.st_mtime_ns}-{stat.st_size}"',
            },
        )

    ext = (file.file_ext or "").lower()
    if ext not in SUPPORTED_THUMBNAIL_EXTENSIONS:
        if file.thumbnail_status != "unsupported":
            file.thumbnail_status = "unsupported"
            db.commit()
        return JSONResponse(
            status_code=415,
            content={"thumbnail_status": "unsupported", "detail": "该文件类型不支持缩略图"},
        )

    status = (file.thumbnail_status or "pending").lower()
    age_seconds = _file_update_age_seconds(file)
    if status == "processing" and age_seconds < settings.THUMBNAIL_PROCESSING_STALE_SECONDS:
        return JSONResponse(
            status_code=202,
            content={"thumbnail_status": "processing", "retry_after": 2},
            headers={"Retry-After": "2", "Cache-Control": "no-store"},
        )
    if status == "failed" and age_seconds < settings.THUMBNAIL_FAILED_RETRY_SECONDS:
        return JSONResponse(
            status_code=422,
            content={
                "thumbnail_status": "failed",
                "detail": file.preview_error or "缩略图生成失败，稍后访问时会自动重试",
            },
            headers={"Cache-Control": "no-store"},
        )

    # Pending, stale processing, old failure and a missing success file all
    # converge on the same shared job. The executor and row lock deduplicate it.
    file.thumbnail_status = "pending"
    if status in {"failed", "processing"}:
        file.preview_error = None
    db.commit()
    background_tasks.add_task(enqueue_file_preview, file.id)
    return JSONResponse(
        status_code=202,
        content={"thumbnail_status": "pending", "retry_after": 2},
        headers={"Retry-After": "2", "Cache-Control": "no-store"},
    )


@router.get("/{file_id}/preview/pages/{page_number}")
def preview_file_page(
    file_id: int,
    page_number: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if not get_file_capabilities(db, file, current_user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")
    if file.preview_kind != "pages" or file.preview_status != "success":
        raise HTTPException(status_code=404, detail="Paged preview not available")
    if page_number < 1 or page_number > (file.preview_page_count or 0):
        raise HTTPException(status_code=404, detail="Preview page not found")

    page_path = Path(file.preview_pages_path or "") / f"page-{page_number:04d}.jpg"
    if not page_path.exists():
        raise HTTPException(status_code=404, detail="Preview page not found")
    return FileResponse(
        path=page_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )


# 视频流式播放接口：支持 HTTP Range 请求（206 Partial Content），实现视频拖动进度条
@router.get("/{file_id}/stream")
def stream_file(file_id: int, token: str, request: Request, db: Session = Depends(get_db)):
    # 手动校验 JWT token（<video> 标签无法设置自定义请求头，所以通过 query 参数传递）
    try:
        payload = jose_jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.id == int(user_id)).first()
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if not get_file_capabilities(db, file, user).can_view:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    path_to_serve = file.preview_path if file.preview_status == "success" and file.preview_path else file.storage_path
    file_path = os.path.abspath(path_to_serve)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    file_size = os.path.getsize(file_path)
    media_type = mimetypes.guess_type(file_path)[0] or file.mime_type or "video/mp4"

    # 解析 Range 请求头（浏览器视频播放器必须通过 Range 请求实现拖动进度条）
    range_header = request.headers.get("range")
    if range_header:
        # 解析 "bytes=start-end" 格式
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if range_match[1] else file_size - 1
        end = min(end, file_size - 1)
        content_length = end - start + 1

        # 分块读取指定范围的字节，避免一次性加载整个视频到内存
        def iterfile():
            with open(file_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk_size = min(8192, remaining)
                    data = f.read(chunk_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": media_type,
        }
        return StreamingResponse(
            iterfile(), status_code=206, headers=headers, media_type=media_type
        )

    # 无 Range 请求：返回完整文件
    def iterfile_full():
        with open(file_path, "rb") as f:
            while chunk := f.read(8192):
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(file_size),
        "Content-Type": media_type,
    }
    return StreamingResponse(
        iterfile_full(), headers=headers, media_type=media_type
    )


@router.get("/{file_id}/permissions", response_model=FilePermissionsResponse)
def get_file_permissions(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not get_file_capabilities(db, file, current_user).can_manage_permissions:
        raise HTTPException(status_code=403, detail="您没有管理此文件权限的权限")

    direct_rules = _direct_file_view_rules(db, file.id)
    inherited_rules, inherited_folder = ([], None) if direct_rules else _inherited_file_view_rules(db, file)
    effective_rules = direct_rules or inherited_rules
    candidates = _file_permission_candidates(db, current_user)
    return FilePermissionsResponse(
        file_id=file.id,
        file_name=file.original_name,
        permission_rules=[_serialize_file_permission_rule(rule) for rule in direct_rules],
        effective_permission_rules=[_serialize_file_permission_rule(rule) for rule in effective_rules],
        inherited_from_folder_id=inherited_folder.id if inherited_folder else None,
        inherited_from_folder_name=inherited_folder.name if inherited_folder else None,
        available_org_units=_file_permission_org_units(db),
        candidate_users=[{"id": user.id, "name": user.name, "department_name": user.department_name or ""} for user in candidates],
    )


@router.put("/{file_id}/permissions", response_model=FilePermissionsResponse)
def update_file_permissions(
    file_id: int,
    payload: FilePermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    if not get_file_capabilities(db, file, current_user).can_manage_permissions:
        raise HTTPException(status_code=403, detail="您没有管理此文件权限的权限")

    candidates = _file_permission_candidates(db, current_user)
    candidate_ids = {user.id for user in candidates}
    normalized: List[tuple[str, Optional[str]]] = []
    seen = set()
    for rule in payload.view_rules:
        subject_type = (rule.subject_type or "").strip()
        subject_value = (rule.subject_value or "").strip() or None
        if subject_type not in {SUBJECT_TYPE_ALL, SUBJECT_TYPE_ORG, SUBJECT_TYPE_USER}:
            raise HTTPException(status_code=400, detail="不支持的权限对象类型")
        if subject_type == SUBJECT_TYPE_ALL:
            subject_value = None
        elif not subject_value:
            raise HTTPException(status_code=400, detail="权限对象不能为空")
        if subject_type == SUBJECT_TYPE_USER:
            try:
                subject_user_id = int(subject_value or "0")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail="用户权限对象格式错误") from exc
            if subject_user_id not in candidate_ids:
                raise HTTPException(status_code=400, detail="包含不可分配的用户")
        key = (subject_type, subject_value)
        if key not in seen:
            seen.add(key)
            normalized.append(key)

    db.query(ResourcePermission).filter(
        ResourcePermission.resource_type == RESOURCE_TYPE_FILE,
        ResourcePermission.resource_id == file.id,
        ResourcePermission.capability == CAPABILITY_VIEW,
    ).delete(synchronize_session=False)
    for subject_type, subject_value in normalized:
        db.add(ResourcePermission(
            resource_type=RESOURCE_TYPE_FILE,
            resource_id=file.id,
            action=CAPABILITY_VIEW,
            capability=CAPABILITY_VIEW,
            subject_type=subject_type,
            subject_value=subject_value,
            inherit_to_children=False,
            created_by=current_user.id,
        ))
    db.commit()
    return get_file_permissions(file_id=file.id, db=db, current_user=current_user)


@router.delete("/{file_id}")
def delete_file(
    file_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if not get_file_capabilities(db, file, current_user).can_delete:
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file.is_deleted = True
    record_audit_log(
        db,
        current_user,
        "file.delete",
        "file",
        file.id,
        request=request,
        detail={"name": file.original_name, "folder_id": file.folder_id, "size": file.size},
    )
    db.commit()
    return {"message": "File deleted successfully"}
