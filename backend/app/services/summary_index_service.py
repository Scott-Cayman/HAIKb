from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.rag.index_manager import index_manager
from app.services.document_parser import UnsupportedDocumentError, document_parser_service
from app.services.summary_generator import summary_generator_service
from app.services.folder_summary_service import folder_summary_service


class SummaryIndexService:
    """串起解析、总结、落盘、索引四个步骤。"""

    def summarize_file(self, file_id: int, reindex: bool = True) -> dict:
        with SessionLocal() as db:
            file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
            if not file:
                raise ValueError(f"文件 {file_id} 不存在")

            file.summary_status = "processing"
            file.summary_error = None
            db.commit()

            try:
                parsed = document_parser_service.extract_first_pages_text(file=file, max_pages=10)
            except UnsupportedDocumentError as exc:
                file.summary_status = "unsupported"
                file.summary_error = str(exc)
                db.commit()
                return {"file_id": file.id, "status": "unsupported", "message": str(exc)}
            except Exception as exc:
                file.summary_status = "failed"
                file.summary_error = str(exc)
                db.commit()
                raise

            summary_payload = summary_generator_service.generate_summary(file=file, parsed=parsed)
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
        if file and file.folder_id:
            try:
                folder_summary_service.update_folder_summary(file.folder_id)
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
        with SessionLocal() as db:
            summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
            if not summary:
                raise ValueError(f"文件 {file_id} 尚未生成总结")
            summary_id = summary.id
        index = index_manager.get_default_index()
        pipeline = index.get_indexing_pipeline(settings={"retrieval_mode": "hybrid"})
        result = pipeline.run(summary_id, reindex=True)
        return {"file_id": file_id, "summary_id": summary_id, "status": "success", "result": result}

    def _write_summary_markdown(self, file_id: int, markdown: str) -> Path:
        summary_dir = Path(settings.SUMMARY_DIR)
        summary_dir.mkdir(parents=True, exist_ok=True)
        output = summary_dir / f"{file_id}.md"
        output.write_text(markdown, encoding="utf-8")
        return output


summary_index_service = SummaryIndexService()
generate_summary_and_index_task = summary_index_service.generate_summary_and_index_task
