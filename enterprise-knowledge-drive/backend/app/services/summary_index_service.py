from __future__ import annotations

from pathlib import Path
import logging
from threading import BoundedSemaphore

from app.config import settings
from app.database import SessionLocal
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.rag.index_manager import index_manager
from app.services.document_parser import UnsupportedDocumentError, document_parser_service
from app.services.summary_generator import summary_generator_service
from app.services.folder_summary_service import folder_summary_service

logger = logging.getLogger(__name__)
_summary_worker_slots = BoundedSemaphore(max(1, settings.SUMMARY_WORKER_CONCURRENCY))


class SummaryIndexService:
    """串起解析、总结、落盘、索引四个步骤。"""

    def summarize_file(self, file_id: int, reindex: bool = True) -> dict:
        with _summary_worker_slots:
            return self._summarize_file_unlocked(file_id=file_id, reindex=reindex)

    def _summarize_file_unlocked(self, file_id: int, reindex: bool = True) -> dict:
        logger.info(f"Starting summarize_file for file ID: {file_id}")
        folder_id = None
        
        with SessionLocal() as db:
            file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
            if not file:
                logger.error(f"File {file_id} not found")
                raise ValueError(f"文件 {file_id} 不存在")
            folder_id = file.folder_id

            logger.info(f"Processing file: {file.original_name} (ext: {file.file_ext})")
            
            file.summary_status = "processing"
            file.summary_error = None
            db.commit()

            try:
                logger.info(f"Extracting text from file...")
                parsed = document_parser_service.extract_first_pages_text(file=file, max_pages=10)
                logger.info(f"Text extraction complete, confidence: {parsed.get('parse_confidence')}")
            except UnsupportedDocumentError as exc:
                logger.warning(f"Unsupported document: {str(exc)}")
                file.summary_status = "unsupported"
                file.summary_error = str(exc)
                db.commit()
                return {"file_id": file.id, "status": "unsupported", "message": str(exc)}
            except Exception as exc:
                logger.exception(f"Error extracting text: {str(exc)}")
                file.summary_status = "failed"
                file.summary_error = str(exc)
                db.commit()
                raise

            try:
                summary_payload = summary_generator_service.generate_summary(file=file, parsed=parsed)
            except Exception as exc:
                logger.exception(f"Error generating summary: {str(exc)}")
                file.summary_status = "failed"
                file.summary_error = str(exc)
                db.commit()
                raise
            summary_file_path = self._write_summary_markdown(file.id, summary_payload["summary_markdown"])
            summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file.id).first()
            if not summary:
                summary = DocumentSummary(file_id=file.id, summary_markdown="")
                db.add(summary)
                db.flush()

            summary.summary_markdown = summary_payload["summary_markdown"]
            summary.summary_file_path = str(summary_file_path)
            summary.one_line_judgement = summary_payload.get("one_line_judgement")
            summary.two_sentence_intro = summary_payload.get("two_sentence_intro")
            summary.client_type = summary_payload.get("client_type")
            summary.project_type = summary_payload.get("project_type")
            summary.document_type = summary_payload.get("document_type")
            summary.region_tags = summary_payload.get("region_tags")
            summary.industry_tags = summary_payload.get("industry_tags")
            summary.keyword_tags = summary_payload.get("keyword_tags")
            summary.parse_pages = int(summary_payload.get("parse_pages") or 10)
            summary.parse_status = "success"
            summary.parse_confidence = summary_payload.get("parse_confidence")
            summary.parse_error = None
            summary.index_status = "pending"
            summary.index_error = None
            db.commit()
            db.refresh(summary)
            summary_id = summary.id

        if reindex:
            try:
                index = index_manager.get_default_index()
                pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
                pipeline.run(summary_id, reindex=True)
            except Exception as exc:
                with SessionLocal() as db:
                    file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
                    summary = db.query(DocumentSummary).filter(DocumentSummary.id == summary_id).first()
                    if file:
                        file.summary_status = "failed"
                        file.summary_error = str(exc)
                    if summary:
                        summary.index_status = "failed"
                        summary.index_error = str(exc)
                    db.commit()
                raise

        with SessionLocal() as db:
            file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
            if file:
                file.summary_status = "success"
                file.summary_error = None
                db.commit()

        # 更新文件夹总结
        if folder_id:
            try:
                folder_summary_service.update_folder_summary(folder_id)
            except Exception:
                pass

        return {"file_id": file_id, "summary_id": summary_id, "status": "success"}

    def generate_summary_and_index_task(self, file_id: int) -> None:
        try:
            self.summarize_file(file_id=file_id, reindex=True)
        except Exception as exc:
            with SessionLocal() as db:
                file = db.query(File).filter(File.id == file_id).first()
                if file:
                    file.summary_status = "failed"
                    file.summary_error = str(exc)
                    db.commit()

    def reindex_summary(self, file_id: int) -> dict:
        """重新生成总结并索引（使用新的视觉 LLM 链路）"""
        return self.summarize_file(file_id=file_id, reindex=True)

    def _write_summary_markdown(self, file_id: int, markdown: str) -> Path:
        summary_dir = Path(settings.SUMMARY_DIR)
        summary_dir.mkdir(parents=True, exist_ok=True)
        output = summary_dir / f"{file_id}.md"
        output.write_text(markdown, encoding="utf-8")
        return output


summary_index_service = SummaryIndexService()
generate_summary_and_index_task = summary_index_service.generate_summary_and_index_task
