from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def prepare_temp_environment() -> Path:
    """准备临时数据库和存储目录，避免污染正式数据。"""
    root = Path(tempfile.mkdtemp(prefix="haikb_rag_smoke_"))
    storage = root / "storage"
    preview_dir = storage / "previews"
    summary_dir = storage / "summaries"
    rag_dir = storage / "rag"
    data_dir = root / "data"

    for path in [storage, preview_dir, summary_dir, rag_dir, rag_dir / "vectors", rag_dir / "docs", data_dir]:
        path.mkdir(parents=True, exist_ok=True)

    os.environ["DATABASE_URL"] = f"sqlite:///{(data_dir / 'app.db').resolve()}"
    os.environ["STORAGE_DIR"] = str(storage)
    os.environ["PREVIEW_DIR"] = str(preview_dir)
    os.environ["SUMMARY_DIR"] = str(summary_dir)
    os.environ["RAG_DATA_DIR"] = str(rag_dir)
    os.environ["RAG_VECTOR_DIR"] = str(rag_dir / "vectors")
    os.environ["RAG_DOC_DIR"] = str(rag_dir / "docs")
    os.environ["AUTH_MOCK"] = "true"
    return root


def generate_demo_pdf(output_path: Path) -> None:
    """生成一份最小 PDF 样例，内容覆盖政府/文旅/会展关键词。"""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    text = (
        "成都市文旅局会展活动招标文件\n"
        "采购人：成都市文化和旅游局\n"
        "本项目围绕城市文旅推广、会展执行、政府活动保障展开。\n"
        "服务范围包括活动策划、会场搭建、嘉宾接待、宣传推广和现场执行。\n"
        "投标人需具备大型会展活动经验、政府项目服务经验和跨部门协调能力。\n"
        "评分重点包括方案完整性、同类案例、执行团队、风险预案与报价合理性。\n"
    )
    page.insert_text((72, 72), text, fontsize=12)
    doc.save(output_path)
    doc.close()


def run_smoke_test() -> dict:
    """执行登录、上传、总结、索引、检索的最小闭环验证。"""
    temp_root = prepare_temp_environment()
    pdf_path = temp_root / "政府文旅会展项目招标文件.pdf"
    generate_demo_pdf(pdf_path)

    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        login_response = client.get("/api/auth/mock-login", params={"role": "admin"})
        login_response.raise_for_status()
        token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        with open(pdf_path, "rb") as handle:
            upload_response = client.post(
                "/api/files/upload",
                headers=headers,
                files={"file": (pdf_path.name, handle, "application/pdf")},
            )
        upload_response.raise_for_status()
        upload_payload = upload_response.json()
        file_id = int(upload_payload["id"])

        summary_response = client.get(f"/api/rag/files/{file_id}/summary", headers=headers)
        summary_response.raise_for_status()
        summary_payload = summary_response.json()

        rerun_payload = None
        if summary_payload["summary_status"] != "success":
            rerun_response = client.post(f"/api/rag/files/{file_id}/summarize", headers=headers)
            rerun_payload = {"status_code": rerun_response.status_code, "body": rerun_response.json()}
            if rerun_response.status_code == 200:
                summary_response = client.get(f"/api/rag/files/{file_id}/summary", headers=headers)
                summary_response.raise_for_status()
                summary_payload = summary_response.json()

        status_response = client.get("/api/rag/status", headers=headers)
        status_response.raise_for_status()
        status_payload = status_response.json()

        chat_response = client.post(
            "/api/agent/chat",
            headers=headers,
            json={"query": "找一下政府类文旅会展项目", "top_k": 5, "retrieval_mode": "hybrid"},
        )
        chat_response.raise_for_status()
        chat_payload = chat_response.json()

    summary_record = summary_payload.get("summary") or {}
    return {
        "temp_root": str(temp_root),
        "upload": {
            "file_id": file_id,
            "original_name": upload_payload["original_name"],
            "preview_status": upload_payload["preview_status"],
            "summary_status": summary_payload["summary_status"],
        },
        "summary": {
            "summary_error": summary_payload["summary_error"],
            "document_type": summary_record.get("document_type"),
            "client_type": summary_record.get("client_type"),
            "project_type": summary_record.get("project_type"),
            "two_sentence_intro": summary_record.get("two_sentence_intro"),
        },
        "summarize_retry": rerun_payload,
        "rag_status": status_payload,
        "agent": {
            "related_file_count": len(chat_payload["related_files"]),
            "evidence_count": len(chat_payload["evidence"]),
            "first_related_file": (
                chat_payload["related_files"][0]["original_name"] if chat_payload["related_files"] else None
            ),
            "answer_preview": chat_payload["answer"][:220],
        },
    }


if __name__ == "__main__":
    result = run_smoke_test()
    print(json.dumps(result, ensure_ascii=False, indent=2))
