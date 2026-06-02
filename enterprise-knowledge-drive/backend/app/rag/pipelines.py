from __future__ import annotations

import json
import uuid
from typing import List

from sqlalchemy.orm import Session

from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.models.rag_index import RagIndexRelation, RagSource, SummaryChunk


def split_markdown_summary(markdown: str, chunk_size: int = 1000, chunk_overlap: int = 120) -> List[str]:
    """优先按 Markdown 标题切，再做长度兜底切分。"""
    sections: List[str] = []
    current: List[str] = []

    for line in (markdown or "").splitlines():
        if line.startswith("## ") and current:
            sections.append("\n".join(current).strip())
            current = [line]
        else:
            current.append(line)
    if current:
        sections.append("\n".join(current).strip())

    chunks: List[str] = []
    for section in sections:
        if len(section) <= chunk_size:
            if section:
                chunks.append(section)
            continue

        start = 0
        while start < len(section):
            end = start + chunk_size
            piece = section[start:end].strip()
            if piece:
                chunks.append(piece)
            if end >= len(section):
                break
            start = max(end - chunk_overlap, start + 1)

    return chunks or [markdown]


class SummaryIndexingPipeline:
    """将 AI 总结文档写入 Source / Chunk / Vector / Relation。"""

    def __init__(self, index_id: int, vector_store, doc_store, keyword_store, db_factory, settings: dict | None = None):
        self.index_id = index_id
        self.vector_store = vector_store
        self.doc_store = doc_store
        self.keyword_store = keyword_store
        self.db_factory = db_factory
        self.settings = settings or {}

    def delete_existing(self, db: Session, summary_id: int) -> None:
        sources = db.query(RagSource).filter(
            RagSource.index_id == self.index_id,
            RagSource.summary_id == summary_id,
        ).all()
        if not sources:
            return

        source_ids = [source.id for source in sources]
        vector_ids = [
            relation.target_id
            for relation in db.query(RagIndexRelation).filter(
                RagIndexRelation.index_id == self.index_id,
                RagIndexRelation.source_id.in_(source_ids),
                RagIndexRelation.relation_type == "vector",
            )
        ]
        if vector_ids:
            self.vector_store.delete(vector_ids)

        db.query(RagIndexRelation).filter(
            RagIndexRelation.index_id == self.index_id,
            RagIndexRelation.source_id.in_(source_ids),
        ).delete(synchronize_session=False)
        db.query(SummaryChunk).filter(
            SummaryChunk.index_id == self.index_id,
            SummaryChunk.summary_id == summary_id,
        ).delete(synchronize_session=False)
        db.query(RagSource).filter(
            RagSource.index_id == self.index_id,
            RagSource.summary_id == summary_id,
        ).delete(synchronize_session=False)

    def run(self, summary_id: int, reindex: bool = True) -> dict:
        with self.db_factory() as db:
            summary = db.query(DocumentSummary).filter(DocumentSummary.id == summary_id).first()
            if not summary:
                raise ValueError(f"Summary {summary_id} 不存在")

            file = db.query(File).filter(File.id == summary.file_id, File.is_deleted == False).first()
            if not file:
                raise ValueError(f"File {summary.file_id} 不存在")

            summary.index_status = "processing"
            summary.index_error = None
            db.commit()

            if reindex:
                self.delete_existing(db, summary_id)

            source = RagSource(
                id=str(uuid.uuid4()),
                index_id=self.index_id,
                summary_id=summary.id,
                file_id=summary.file_id,
                name=file.original_name,
                path=summary.summary_file_path,
                size=len(summary.summary_markdown.encode("utf-8")),
                note_json=json.dumps(
                    {
                        "client_type": summary.client_type,
                        "project_type": summary.project_type,
                        "document_type": summary.document_type,
                        "keyword_tags": summary.keyword_tags,
                    },
                    ensure_ascii=False,
                ),
            )
            db.add(source)
            db.commit()

            chunks = split_markdown_summary(summary.summary_markdown)
            for idx, text in enumerate(chunks):
                chunk_id = str(uuid.uuid4())
                metadata = {
                    "index_id": self.index_id,
                    "source_id": source.id,
                    "summary_id": summary.id,
                    "file_id": summary.file_id,
                    "file_name": file.original_name,
                    "client_type": summary.client_type,
                    "project_type": summary.project_type,
                    "document_type": summary.document_type,
                    "one_line_judgement": summary.one_line_judgement,
                    "two_sentence_intro": summary.two_sentence_intro,
                    "type": "ai_summary_chunk",
                }
                db.add(
                    SummaryChunk(
                        id=chunk_id,
                        index_id=self.index_id,
                        source_id=source.id,
                        summary_id=summary.id,
                        file_id=summary.file_id,
                        chunk_index=idx,
                        content=text,
                        metadata_json=json.dumps(metadata, ensure_ascii=False),
                    )
                )
                db.add(
                    RagIndexRelation(
                        index_id=self.index_id,
                        source_id=source.id,
                        target_id=chunk_id,
                        relation_type="document",
                    )
                )
                vector_id = self.vector_store.add_text(chunk_id, text, metadata)
                db.add(
                    RagIndexRelation(
                        index_id=self.index_id,
                        source_id=source.id,
                        target_id=vector_id,
                        relation_type="vector",
                    )
                )

            summary.index_status = "success"
            summary.index_error = None
            db.commit()
            return {"summary_id": summary.id, "source_id": source.id, "chunk_count": len(chunks)}

    def reset_index(self) -> None:
        with self.db_factory() as db:
            db.query(RagIndexRelation).filter(RagIndexRelation.index_id == self.index_id).delete(synchronize_session=False)
            db.query(SummaryChunk).filter(SummaryChunk.index_id == self.index_id).delete(synchronize_session=False)
            db.query(RagSource).filter(RagSource.index_id == self.index_id).delete(synchronize_session=False)
            db.commit()
        self.vector_store.drop_collection()
