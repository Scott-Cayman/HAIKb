import mimetypes
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from jose import JWTError, jwt as jose_jwt
from app.dependencies.auth import get_current_user
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
from app.models.user_file_view import UserFileView
from app.services.summary_index_service import generate_summary_and_index_task
from app.services.folder_summary_service import folder_summary_service

router = APIRouter()

class TitleSearchItem(BaseModel):
    id: int
    title: str
    kind: str
    hit_count: int


class TitleSearchResponse(BaseModel):
    query: str
    tokens: List[str]
    results: List[TitleSearchItem]


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
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
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
    summary_status: str
    uploaded_by: int

    class Config:
        from_attributes = True


class FileUpdateRequest(BaseModel):
    original_name: Optional[str] = None


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

    results: List[TitleSearchItem] = []
    for row in folders:
        title = row.name or ""
        hit_count = sum(1 for token in tokens if token in title)
        if hit_count <= 0:
            continue
        results.append(TitleSearchItem(id=row.id, title=title, kind="folder", hit_count=hit_count))
    for row in files:
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


# 统一搜索响应模型
class RelatedFileItem(BaseModel):
    file_id: int
    summary_id: int
    original_name: str
    one_line_judgement: str
    score: float
    preview_url: str
    download_url: str


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
):
    from app.services.agent_service_optimized import agent_service

    response = UnifiedSearchResponse(query=q)

    try:
        agent_result = agent_service.chat(
            query=q,
            top_k=8,
            retrieval_mode="hybrid",
            user_id=current_user.id,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if payload.original_name is not None:
        new_name = payload.original_name.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="original_name required")
        file.original_name = new_name
        db.commit()
        db.refresh(file)
    return file


def get_or_create_folder_path(relative_path: str, parent_folder_id: int, db: Session, current_user: User) -> Optional[int]:
    path_parts = relative_path.split("/")
    if len(path_parts) <= 1:
        return parent_folder_id

    folder_names = path_parts[:-1]
    current_parent_id = parent_folder_id

    for folder_name in folder_names:
        if not folder_name.strip():
            continue

        existing_folder = db.query(Folder).filter(
            Folder.name == folder_name,
            Folder.parent_id == current_parent_id,
            Folder.is_deleted == False,
        ).first()

        if existing_folder:
            current_parent_id = existing_folder.id
        else:
            new_folder = Folder(name=folder_name, parent_id=current_parent_id, created_by=current_user.id)
            db.add(new_folder)
            db.commit()
            db.refresh(new_folder)
            current_parent_id = new_folder.id

    return current_parent_id


@router.post("/upload", response_model=FileResponseModel)
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = FastAPIFile(...),
    folder_id: Optional[int] = Form(None),
    relative_path: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_folder_id = folder_id

    if relative_path:
        target_folder_id = get_or_create_folder_path(relative_path, folder_id, db, current_user)

    if target_folder_id:
        folder = db.query(Folder).filter(Folder.id == target_folder_id, Folder.is_deleted == False).first()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    ext = os.path.splitext(file.filename)[1].lower()
    stored_name = f"{uuid.uuid4()}{ext}"
    storage_path = os.path.join(settings.STORAGE_DIR, "originals", stored_name)

    with open(storage_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    size = os.path.getsize(storage_path)
    # 视频格式：大多数浏览器可直接播放；HEVC(H.265) 需要转码为 H.264 才能兼容
    VIDEO_EXTS = {".mp4", ".webm", ".ogg", ".mov"}
    preview_status = "unsupported"
    if ext in [".pdf", ".jpg", ".jpeg", ".png", ".webp"]:
        preview_status = "success"
        preview_path = storage_path
    elif ext in VIDEO_EXTS:
        codec_tag = _detect_video_codec_tag(storage_path) if ext in {".mp4", ".mov"} else None
        if codec_tag in {"hvc1", "hev1"}:
            preview_status = "pending"
            preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.mp4")
        else:
            preview_status = "success"
            preview_path = storage_path
    elif ext in [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]:
        preview_status = "pending"
        preview_path = None
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
        department_name = _get_user_specific_department(current_user)
    
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
        summary_status="pending",
        uploaded_by=current_user.id,
        department_name=department_name,
        is_super_admin_created=is_super_admin_created
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    if preview_status == "pending" and ext in [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]:
        preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.pdf")
        background_tasks.add_task(convert_to_pdf, storage_path, preview_path, ext, db_file.id)

    if preview_status == "pending" and ext in VIDEO_EXTS and db_file.preview_path:
        background_tasks.add_task(transcode_video_to_h264, storage_path, db_file.preview_path, db_file.id)

    background_tasks.add_task(generate_summary_and_index_task, db_file.id)
    return db_file


def _get_user_specific_department(user: User) -> Optional[str]:
    """获取用户的具体部门（优先匹配 跨界营销中心、创意部 等关键部门）"""
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    return user.department_name


def _check_file_permission(file: File, current_user: User) -> bool:
    """检查用户是否有访问文件的权限"""
    if current_user.is_super_admin:
        return True
    # 普通用户检查
    user_department = _get_user_specific_department(current_user)
    return file.is_super_admin_created or file.department_name == user_department


@router.get("/recent")
def get_recent_files(limit: int = 10, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
    )
    
    # 权限检查
    if not current_user.is_super_admin:
        user_department = _get_user_specific_department(current_user)
        query = query.filter(
            or_(
                File.is_super_admin_created == True,
                File.department_name == user_department
            )
        )
    
    return (
        query
        .order_by(File.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/folder/{folder_id}")
def get_files_in_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # 检查文件夹权限
    # 复用文件夹权限检查逻辑
    user_department = _get_user_specific_department(current_user)
    if not current_user.is_super_admin and not folder.is_super_admin_created and folder.department_name != user_department:
        raise HTTPException(status_code=403, detail="You don't have permission to access this folder")
    
    return db.query(File).filter(File.folder_id == folder_id, File.is_deleted == False).all()


@router.get("/{file_id}", response_model=FileResponseModel)
def get_file(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # 权限检查
    if not _check_file_permission(file, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

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
        if codec_tag in {"hvc1", "hev1"}:
            video_preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.mp4")
            file.preview_status = "pending"
            file.preview_path = video_preview_path
            db.commit()
            background_tasks.add_task(transcode_video_to_h264, file.storage_path, video_preview_path, file.id)

    if file.preview_status in ["failed", "unsupported"] and file.file_ext in [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]:
        preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.pdf")
        file.preview_status = "pending"
        db.commit()
        background_tasks.add_task(convert_to_pdf, file.storage_path, preview_path, file.file_ext, file.id)

    return file


@router.get("/{file_id}/download")
def download_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # 权限检查
    if not _check_file_permission(file, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file.download_count += 1
    db.commit()
    return FileResponse(path=file.storage_path, filename=file.original_name)


@router.get("/{file_id}/preview")
def preview_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # 权限检查
    if not _check_file_permission(file, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    if file.preview_status != "success":
        raise HTTPException(status_code=400, detail="Preview not available")

    file.view_count += 1
    db.commit()
    path_to_serve = file.preview_path if file.preview_path else file.storage_path
    return FileResponse(path=path_to_serve)


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

    if not _check_file_permission(file, user):
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


@router.delete("/{file_id}")
def delete_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # 权限检查
    if not _check_file_permission(file, current_user):
        raise HTTPException(status_code=403, detail="You don't have permission to access this file")

    file.is_deleted = True
    db.commit()
    return {"message": "File deleted successfully"}
