import logging
import os
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from typing import Optional

from PIL import Image

from app.config import settings
from app.database import SessionLocal
from app.models.file import File


logger = logging.getLogger(__name__)

OFFICE_EXTENSIONS = {".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"}
PRESENTATION_EXTENSIONS = {".ppt", ".pptx"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogg", ".mov"}
SUPPORTED_THUMBNAIL_EXTENSIONS = OFFICE_EXTENSIONS | IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | {".pdf"}
LARGE_PDF_THRESHOLD_BYTES = 50 * 1024 * 1024
PDF_COMPRESSION_THRESHOLD_BYTES = 20 * 1024 * 1024

_preview_executor = ThreadPoolExecutor(
    max_workers=max(1, int(settings.PREVIEW_WORKER_CONCURRENCY or 2)),
    thread_name_prefix="haikb-preview",
)
_preview_jobs: set[int] = set()
_preview_jobs_lock = Lock()


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )


def _office_to_pdf(input_path: Path, output_dir: Path) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice 未安装，无法生成 Office 预览")

    output_dir.mkdir(parents=True, exist_ok=True)
    export_filter = "pdf"
    if input_path.suffix.lower() in {".xls", ".xlsx"}:
        # Calc's default A4 export can split one sheet into many horizontal
        # fragments. Export each sheet as one continuous PDF page so the
        # browser can provide a natural spreadsheet scroll preview.
        export_filter = (
            'pdf:calc_pdf_Export:{"SinglePageSheets":'
            '{"type":"boolean","value":"true"}}'
        )
    with tempfile.TemporaryDirectory(prefix="haikb-lo-profile-") as profile_dir:
        result = _run(
            [
                soffice,
                f"-env:UserInstallation={Path(profile_dir).resolve().as_uri()}",
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--norestore",
                "--convert-to",
                export_filter,
                "--outdir",
                str(output_dir),
                str(input_path),
            ],
            timeout=30 * 60,
        )
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice 转换失败: {result.stderr[-800:]}")

    expected = output_dir / f"{input_path.stem}.pdf"
    if expected.exists() and expected.stat().st_size > 0:
        return expected

    candidates = sorted(output_dir.glob("*.pdf"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not candidates:
        raise RuntimeError("LibreOffice 未生成 PDF 文件")
    return candidates[0]


def _compress_pdf(source: Path, target: Path) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    source_size = source.stat().st_size
    if source_size < PDF_COMPRESSION_THRESHOLD_BYTES:
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return target

    ghostscript = shutil.which("gs")
    if not ghostscript:
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return target

    temp_target = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.tmp.pdf")
    result = _run(
        [
            ghostscript,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.6",
            "-dPDFSETTINGS=/ebook",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            "-dDetectDuplicateImages=true",
            "-dCompressFonts=true",
            "-dDownsampleColorImages=true",
            "-dColorImageResolution=144",
            "-dColorImageDownsampleType=/Bicubic",
            "-dDownsampleGrayImages=true",
            "-dGrayImageResolution=144",
            "-dGrayImageDownsampleType=/Bicubic",
            f"-sOutputFile={temp_target}",
            str(source),
        ],
        timeout=30 * 60,
    )
    if result.returncode != 0 or not temp_target.exists() or temp_target.stat().st_size == 0:
        temp_target.unlink(missing_ok=True)
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return target

    if temp_target.stat().st_size >= source_size:
        temp_target.unlink(missing_ok=True)
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return target

    os.replace(temp_target, target)
    return target


def _render_pdf_pages(pdf_path: Path, pages_dir: Path) -> tuple[int, Path]:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("Poppler 未安装，无法生成分页预览")

    if pages_dir.exists():
        shutil.rmtree(pages_dir)
    pages_dir.mkdir(parents=True, exist_ok=True)
    raw_prefix = pages_dir / "render"
    result = _run(
        [
            pdftoppm,
            "-jpeg",
            "-jpegopt",
            "quality=82,optimize=y,progressive=y",
            "-scale-to-x",
            "1440",
            "-scale-to-y",
            "-1",
            str(pdf_path),
            str(raw_prefix),
        ],
        timeout=30 * 60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"PDF 分页图生成失败: {result.stderr[-800:]}")

    rendered = sorted(pages_dir.glob("render-*.jpg"))
    if not rendered:
        raise RuntimeError("PDF 分页图为空")
    for index, source in enumerate(rendered, start=1):
        source.rename(pages_dir / f"page-{index:04d}.jpg")
    return len(rendered), pages_dir / "page-0001.jpg"


def _render_pdf_thumbnail(pdf_path: Path, target: Path) -> None:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("Poppler 未安装，无法生成 PDF 封面")

    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="haikb-cover-", dir=target.parent) as temp_dir:
        output_prefix = Path(temp_dir) / "cover"
        result = _run(
            [
                pdftoppm,
                "-f",
                "1",
                "-singlefile",
                "-jpeg",
                "-jpegopt",
                "quality=84,optimize=y,progressive=y",
                "-scale-to-x",
                "640",
                "-scale-to-y",
                "-1",
                str(pdf_path),
                str(output_prefix),
            ],
            timeout=10 * 60,
        )
        rendered = output_prefix.with_suffix(".jpg")
        if result.returncode != 0 or not rendered.exists():
            raise RuntimeError(f"PDF 封面生成失败: {result.stderr[-800:]}")
        os.replace(rendered, target)


def _thumbnail_from_image(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image.seek(0)
        image = image.convert("RGB")
        image.thumbnail((640, 480), Image.Resampling.LANCZOS)
        image.save(target, format="JPEG", quality=84, optimize=True, progressive=True)


def _thumbnail_from_office_package(source: Path, target: Path) -> bool:
    """Use an Office package's embedded cover when available.

    This gives large PPTX/DOCX files a cover before LibreOffice finishes the
    heavier PDF conversion. Older binary Office files simply fall back to the
    normal conversion path.
    """
    if source.suffix.lower() not in {".docx", ".pptx", ".xlsx"}:
        return False
    try:
        with zipfile.ZipFile(source) as package:
            names = {name.lower(): name for name in package.namelist()}
            candidate = next(
                (
                    names[key]
                    for key in (
                        "docprops/thumbnail.jpeg",
                        "docprops/thumbnail.jpg",
                        "docprops/thumbnail.png",
                    )
                    if key in names
                ),
                None,
            )
            if not candidate:
                return False
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(candidate) as source_stream, tempfile.NamedTemporaryFile(
                suffix=Path(candidate).suffix,
                dir=target.parent,
                delete=False,
            ) as temp_stream:
                shutil.copyfileobj(source_stream, temp_stream)
                temp_path = Path(temp_stream.name)
            try:
                _thumbnail_from_image(temp_path, target)
            finally:
                temp_path.unlink(missing_ok=True)
            return target.exists() and target.stat().st_size > 0
    except (OSError, zipfile.BadZipFile, KeyError):
        logger.debug("Office file %s has no reusable embedded thumbnail", source)
        return False


def _video_thumbnail(source: Path, target: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg 未安装，无法生成视频封面")
    target.parent.mkdir(parents=True, exist_ok=True)
    result = _run(
        [
            ffmpeg,
            "-y",
            "-ss",
            "1",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2:force_original_aspect_ratio=decrease",
            "-q:v",
            "3",
            str(target),
        ],
        timeout=5 * 60,
    )
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        raise RuntimeError(f"视频封面生成失败: {result.stderr[-800:]}")


def _publish_thumbnail(db, db_file: File, thumbnail_path: Path) -> None:
    db_file.thumbnail_path = str(thumbnail_path)
    db_file.thumbnail_status = "success"
    db.commit()


def _render_pages_without_blocking_thumbnail(db, db_file: File, pdf_path: Path, pages_dir: Path) -> None:
    """Build the heavier paged preview after the shared cover is available."""
    try:
        page_count, _ = _render_pdf_pages(pdf_path, pages_dir)
        db_file.preview_kind = "pages"
        db_file.preview_pages_path = str(pages_dir)
        db_file.preview_page_count = page_count
        db_file.preview_error = None
        db.commit()
    except Exception as exc:
        logger.exception("Paged preview generation failed for file %s", db_file.id)
        db.rollback()
        db_file = db.query(File).filter(File.id == db_file.id).first()
        if db_file:
            # PDF preview and thumbnail remain usable even if page extraction fails.
            db_file.preview_kind = "pdf"
            db_file.preview_error = str(exc)[:1000]
            db.commit()


def process_file_preview_assets(file_id: int, force: bool = False) -> None:
    db = SessionLocal()
    temp_dir: Optional[tempfile.TemporaryDirectory[str]] = None
    thumbnail_path = Path(settings.PREVIEW_DIR) / "thumbnails" / f"{file_id}.jpg"
    try:
        # The row lock is the cross-request/cross-worker deduplication boundary.
        db_file = (
            db.query(File)
            .filter(File.id == file_id, File.is_deleted == False)
            .with_for_update()
            .first()
        )
        if not db_file:
            return

        ext = (db_file.file_ext or "").lower()
        if ext not in SUPPORTED_THUMBNAIL_EXTENSIONS:
            db_file.thumbnail_status = "unsupported"
            db_file.preview_kind = db_file.preview_kind or "unsupported"
            db.commit()
            return

        existing_thumbnail = Path(db_file.thumbnail_path) if db_file.thumbnail_path else thumbnail_path
        if not force and db_file.thumbnail_status == "success" and existing_thumbnail.exists():
            if not db_file.thumbnail_path:
                db_file.thumbnail_path = str(existing_thumbnail)
                db.commit()
            return
        if db_file.thumbnail_status == "processing":
            return

        storage_path = Path(db_file.storage_path)
        if not storage_path.exists():
            raise RuntimeError("原文件不存在")

        db_file.thumbnail_status = "processing"
        db_file.preview_error = None
        db.commit()

        preview_root = Path(settings.PREVIEW_DIR)
        preview_root.mkdir(parents=True, exist_ok=True)
        thumbnail_path.parent.mkdir(parents=True, exist_ok=True)
        pages_dir = preview_root / "pages" / str(file_id)

        if ext in OFFICE_EXTENSIONS:
            thumbnail_ready = _thumbnail_from_office_package(storage_path, thumbnail_path)
            if thumbnail_ready:
                _publish_thumbnail(db, db_file, thumbnail_path)

            existing_preview = Path(db_file.preview_path) if db_file.preview_path else None
            if not force and existing_preview and existing_preview.exists() and db_file.preview_status == "success":
                pdf_path = existing_preview
            else:
                temp_dir = tempfile.TemporaryDirectory(prefix=f"haikb-preview-{file_id}-", dir=preview_root)
                raw_pdf = _office_to_pdf(storage_path, Path(temp_dir.name))
                pdf_path = preview_root / f"{uuid.uuid4()}.pdf"
                _compress_pdf(raw_pdf, pdf_path)

            db_file.preview_path = str(pdf_path)
            db_file.preview_status = "success"
            db_file.preview_kind = "pdf"
            if not thumbnail_ready:
                _render_pdf_thumbnail(pdf_path, thumbnail_path)
                _publish_thumbnail(db, db_file, thumbnail_path)
            else:
                db.commit()

            if ext in PRESENTATION_EXTENSIONS or pdf_path.stat().st_size >= LARGE_PDF_THRESHOLD_BYTES:
                _render_pages_without_blocking_thumbnail(db, db_file, pdf_path, pages_dir)

        elif ext == ".pdf":
            db_file.preview_kind = "pdf"
            db_file.preview_path = str(storage_path)
            db_file.preview_status = "success"
            _render_pdf_thumbnail(storage_path, thumbnail_path)
            _publish_thumbnail(db, db_file, thumbnail_path)

            if storage_path.stat().st_size >= LARGE_PDF_THRESHOLD_BYTES:
                pdf_path = preview_root / f"{uuid.uuid4()}.pdf"
                _compress_pdf(storage_path, pdf_path)
                db_file.preview_path = str(pdf_path)
                db.commit()
                _render_pages_without_blocking_thumbnail(db, db_file, pdf_path, pages_dir)

        elif ext in IMAGE_EXTENSIONS:
            _thumbnail_from_image(storage_path, thumbnail_path)
            db_file.preview_kind = "image"
            db_file.preview_status = "success"
            _publish_thumbnail(db, db_file, thumbnail_path)

        elif ext in VIDEO_EXTENSIONS:
            _video_thumbnail(storage_path, thumbnail_path)
            db_file.preview_kind = "video"
            _publish_thumbnail(db, db_file, thumbnail_path)

    except Exception as exc:
        logger.exception("Failed to process preview assets for file %s", file_id)
        db.rollback()
        db_file = db.query(File).filter(File.id == file_id).first()
        if db_file:
            thumbnail_exists = thumbnail_path.exists() and thumbnail_path.stat().st_size > 0
            if (db_file.file_ext or "").lower() in OFFICE_EXTENSIONS and db_file.preview_status != "success":
                db_file.preview_status = "failed"
            db_file.thumbnail_path = str(thumbnail_path) if thumbnail_exists else db_file.thumbnail_path
            db_file.thumbnail_status = "success" if thumbnail_exists else "failed"
            db_file.preview_error = str(exc)[:1000]
            db.commit()
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()
        db.close()


def enqueue_file_preview(file_id: int, force: bool = False) -> bool:
    """Queue one shared thumbnail job per file for the whole application."""
    normalized_id = int(file_id)
    with _preview_jobs_lock:
        if normalized_id in _preview_jobs:
            return False
        _preview_jobs.add(normalized_id)

    try:
        future: Future[None] = _preview_executor.submit(process_file_preview_assets, normalized_id, force)
    except Exception:
        with _preview_jobs_lock:
            _preview_jobs.discard(normalized_id)
        raise

    def release_job(_future: Future[None]) -> None:
        with _preview_jobs_lock:
            _preview_jobs.discard(normalized_id)

    future.add_done_callback(release_job)
    return True


def recover_interrupted_thumbnail_jobs() -> int:
    """A restarted process has no live workers, so processing rows are retryable."""
    db = SessionLocal()
    try:
        recovered = (
            db.query(File)
            .filter(File.is_deleted == False, File.thumbnail_status == "processing")
            .update({File.thumbnail_status: "pending"}, synchronize_session=False)
        )
        db.commit()
        if recovered:
            logger.warning("Recovered %s interrupted thumbnail jobs", recovered)
        return int(recovered or 0)
    finally:
        db.close()
