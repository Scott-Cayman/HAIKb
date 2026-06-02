from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Dict

import fitz

from app.config import settings
from app.models.file import File


SUPPORTED_PARSE_EXTS = {".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".md"}
SUPPORTED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
UNSUPPORTED_PARSE_EXTS = set()


class UnsupportedDocumentError(RuntimeError):
    pass


class DocumentParserService:
    """只抽取文件前 10 页，不允许走全文 RAG。图片文件返回图片路径供视觉模型使用。"""

    def extract_first_pages_text(self, file: File, max_pages: int = 10) -> Dict[str, object]:
        ext = (file.file_ext or "").lower()
        
        # 如果是图片文件，直接返回图片路径
        if ext in SUPPORTED_IMAGE_EXTS:
            return self._parse_image_file(file)
        
        # 如果是文本文件，直接读取
        if ext in {".txt", ".md"}:
            return self._parse_text_file(file)
        
        # 否则处理文档文件
        if ext not in SUPPORTED_PARSE_EXTS:
            raise UnsupportedDocumentError(f"当前格式暂不支持总结解析: {ext or 'unknown'}")

        pdf_path = self.ensure_pdf_available(file)
        doc = fitz.open(pdf_path)
        page_count = len(doc)
        pages_to_parse = min(max_pages, page_count)

        texts = []
        for index in range(pages_to_parse):
            page_text = doc[index].get_text("text").strip()
            texts.append(f"\n\n--- PAGE {index + 1} ---\n{page_text}")

        combined_text = "\n".join(texts).strip()
        confidence = "high" if combined_text else "low"
        return {
            "text": combined_text,
            "page_count": page_count,
            "parsed_pages": pages_to_parse,
            "parse_confidence": confidence,
            "pdf_path": str(pdf_path),
        }

    def _parse_text_file(self, file: File) -> Dict[str, object]:
        """处理文本文件（.txt, .md），直接读取内容。"""
        import logging
        logger = logging.getLogger(__name__)
        
        file_path = Path(file.storage_path)
        if not file_path.exists():
            raise FileNotFoundError(f"文本文件不存在: {file_path}")
        
        logger.info(f"[DocumentParser] 处理文本文件: {file.original_name}, path={file_path}")
        
        # 读取文件内容（限制大小，避免超大文件）
        max_size = 100 * 1024  # 100KB
        size = file_path.stat().st_size
        
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            if size > max_size:
                content = f.read(max_size)
                content += "\n\n... (文件内容超过限制，只读取了前100KB)"
            else:
                content = f.read()
        
        confidence = "high" if content.strip() else "low"
        
        return {
            "text": content,
            "page_count": 1,
            "parsed_pages": 1,
            "parse_confidence": confidence,
        }

    def _parse_image_file(self, file: File) -> Dict[str, object]:
        """处理图片文件，返回图片路径供视觉模型使用。"""
        import logging
        logger = logging.getLogger(__name__)
        
        image_path = Path(file.storage_path)
        if not image_path.exists():
            raise FileNotFoundError(f"图片文件不存在: {image_path}")
        
        logger.info(f"[DocumentParser] 处理图片文件: {file.original_name}, path={image_path}")
        
        return {
            "text": "",
            "page_count": 1,
            "parsed_pages": 1,
            "parse_confidence": "low",
            "image_path": str(image_path),
        }

    def ensure_pdf_available(self, file: File) -> Path:
        preview_path = Path(file.preview_path) if file.preview_path else None
        if preview_path and preview_path.exists() and preview_path.suffix.lower() == ".pdf":
            return preview_path

        storage_path = Path(file.storage_path)
        if storage_path.suffix.lower() == ".pdf":
            return storage_path

        if storage_path.suffix.lower() not in {".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"}:
            raise UnsupportedDocumentError(f"当前格式无法转换为 PDF: {storage_path.suffix.lower()}")

        output_dir = Path(settings.PREVIEW_DIR)
        output_dir.mkdir(parents=True, exist_ok=True)
        temp_input = output_dir / f"{uuid.uuid4()}{storage_path.suffix.lower()}"
        shutil.copyfile(storage_path, temp_input)
        try:
            converted = self._office_to_pdf(temp_input, output_dir)
        finally:
            if temp_input.exists():
                temp_input.unlink()
        return converted

    def _office_to_pdf(self, input_path: Path, output_dir: Path) -> Path:
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
            raise RuntimeError("PDF file was not created after conversion")
        return output_file


document_parser_service = DocumentParserService()
