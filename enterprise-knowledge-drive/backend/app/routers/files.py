import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.dependencies.auth import get_current_user
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
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


@router.get("/title-search", response_model=TitleSearchResponse)
def title_search(
    q: str,
    limit: int = 12,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
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
    preview_status = "unsupported"
    if ext in [".pdf", ".jpg", ".jpeg", ".png", ".webp"]:
        preview_status = "success"
        preview_path = storage_path
    elif ext in [".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"]:
        preview_status = "pending"
        preview_path = None
    else:
        preview_path = None

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
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)

    if preview_status == "pending":
        preview_path = os.path.join(settings.PREVIEW_DIR, f"{uuid.uuid4()}.pdf")
        background_tasks.add_task(convert_to_pdf, storage_path, preview_path, ext, db_file.id)

    background_tasks.add_task(generate_summary_and_index_task, db_file.id)
    return db_file


@router.get("/recent")
def get_recent_files(limit: int = 10, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(File)
        .outerjoin(Folder, Folder.id == File.folder_id)
        .filter(
            File.is_deleted == False,
            or_(File.folder_id == None, Folder.is_deleted == False),
        )
        .order_by(File.created_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/folder/{folder_id}")
def get_files_in_folder(folder_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return db.query(File).filter(File.folder_id == folder_id, File.is_deleted == False).all()


@router.get("/{file_id}", response_model=FileResponseModel)
def get_file(file_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

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

    file.download_count += 1
    db.commit()
    return FileResponse(path=file.storage_path, filename=file.original_name)


@router.get("/{file_id}/preview")
def preview_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if file.preview_status != "success":
        raise HTTPException(status_code=400, detail="Preview not available")

    file.view_count += 1
    db.commit()
    path_to_serve = file.preview_path if file.preview_path else file.storage_path
    return FileResponse(path=path_to_serve)


@router.delete("/{file_id}")
def delete_file(file_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    file.is_deleted = True
    db.commit()
    return {"message": "File deleted successfully"}
