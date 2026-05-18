from __future__ import annotations

from typing import Dict, List, Optional


def build_related_file_payload(doc: dict) -> dict:
    metadata = doc.get("metadata", {})
    file_id = doc["file_id"]
    return {
        "file_id": file_id,
        "summary_id": doc["summary_id"],
        "original_name": metadata.get("file_name") or f"文件 {file_id}",
        "one_line_judgement": metadata.get("one_line_judgement") or "该文件已生成 AI 总结，但一句话判断尚未完善。",
        "score": doc["score"],
        "preview_url": f"/api/files/{file_id}/preview",
        "download_url": f"/api/files/{file_id}/download",
    }


class SummaryDocSearchTool:
    name = "summary_doc_search"
    description = "搜索 HAIKb 中由原文件前 10 页生成的 AI 总结文档。只允许搜索总结文档，不允许搜索原文件全文。"

    def __init__(self, retriever):
        self.retriever = retriever

    def run(self, query: str, top_k: int = 8, retrieval_mode: str = "hybrid", filters: Optional[dict] = None) -> dict:
        docs = self.retriever.run(query=query, top_k=top_k, retrieval_mode=retrieval_mode, filters=filters)
        evidence: List[dict] = []
        related_files_map: Dict[int, dict] = {}

        for doc in docs:
            evidence.append(
                {
                    "summary_id": doc["summary_id"],
                    "file_id": doc["file_id"],
                    "chunk_id": doc["chunk_id"],
                    "content": doc["content"],
                    "score": doc["score"],
                    "file_name": doc["metadata"].get("file_name"),
                }
            )
            if doc["file_id"] not in related_files_map:
                related_files_map[doc["file_id"]] = build_related_file_payload(doc)

        return {"evidence": evidence, "related_files": list(related_files_map.values())}
