#!/usr/bin/env python3
"""验证上传 -> 总结 -> 检索 -> 文件夹总结闭环是否正常。

默认覆盖两条路径：
1. 直调上传接口，依赖后端 auto_start_summary 默认自动进入总结
2. 模拟前端路径：上传时关闭 auto_start_summary，再显式调用批量总结接口
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import SessionLocal
from app.main import app
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.models.user import User
from app.routers.auth import create_access_token


def get_auth_headers() -> dict:
    with SessionLocal() as db:
        user = db.query(User).filter(User.is_active == True).order_by(User.id.asc()).first()
        if not user:
            raise RuntimeError("未找到可用的激活用户")
        token = create_access_token({"sub": str(user.id)})
    return {"Authorization": f"Bearer {token}"}


def pick_sample_bytes(exts: list[str]) -> tuple[bytes, str, str]:
    with SessionLocal() as db:
        sample = (
            db.query(File)
            .filter(File.is_deleted == False, File.file_ext.in_(exts), File.storage_path != None)
            .order_by(File.id.desc())
            .first()
        )
        if not sample:
            raise RuntimeError(f"未找到样本文件: {exts}")
        path = Path(sample.storage_path)
        if not path.exists():
            raise RuntimeError(f"样本文件不存在: {path}")
        return path.read_bytes(), sample.original_name, sample.file_ext


def wait_task(client: TestClient, headers: dict, task_id: str, timeout_seconds: int = 180) -> dict:
    deadline = time.time() + timeout_seconds
    last_payload = None
    while time.time() < deadline:
        resp = client.get(f"/api/rag/batch-tasks/{task_id}", headers=headers)
        resp.raise_for_status()
        last_payload = resp.json()
        if last_payload["status"] != "running":
            return last_payload
        time.sleep(1)
    raise TimeoutError(f"任务超时未结束: {task_id}, last={last_payload}")


def verify_case(client: TestClient, headers: dict, *, kind: str, bytes_payload: bytes, ext: str, mime: str, auto_start_summary: bool) -> dict:
    suffix = int(time.time())
    folder_name = f"verify-{kind}-folder-{suffix}"
    folder_res = client.post("/api/folders", json={"name": folder_name}, headers=headers)
    folder_res.raise_for_status()
    folder_id = folder_res.json()["id"]

    upload_name = f"verify-{kind}-{suffix}{ext}"
    form_data = {"folder_id": str(folder_id)}
    if not auto_start_summary:
        form_data["auto_start_summary"] = "false"

    upload_res = client.post(
        "/api/files/upload",
        headers=headers,
        data=form_data,
        files={"file": (upload_name, io.BytesIO(bytes_payload), mime)},
    )
    upload_res.raise_for_status()
    upload_payload = upload_res.json()
    file_id = upload_payload["id"]

    task_payload = None
    if auto_start_summary:
        task_id = upload_payload.get("auto_summary_task_id")
        if not task_id:
            raise AssertionError("上传接口未返回 auto_summary_task_id")
        task_payload = wait_task(client, headers, task_id)
    else:
        batch_res = client.post("/api/rag/files/batch-summarize", headers=headers, json={"file_ids": [file_id]})
        batch_res.raise_for_status()
        task_payload = wait_task(client, headers, batch_res.json()["task_id"])

    if task_payload["status"] != "success":
        raise AssertionError(f"总结任务未成功: {task_payload}")

    summary_res = client.get(f"/api/rag/files/{file_id}/summary", headers=headers)
    summary_res.raise_for_status()
    summary_payload = summary_res.json()
    if summary_payload.get("summary_status") != "success" or not summary_payload.get("summary"):
        raise AssertionError(f"文件总结未成功: {summary_payload}")

    agent_res = client.post(
        "/api/agent/chat",
        headers=headers,
        json={"query": upload_name.replace(ext, ""), "top_k": 5, "retrieval_mode": "hybrid"},
    )
    agent_res.raise_for_status()
    agent_payload = agent_res.json()
    related_ids = [item.get("file_id") for item in agent_payload.get("related_files", [])]
    if file_id not in related_ids:
        raise AssertionError(f"AI 检索未命中新上传文件: {related_ids}")

    folder_summary_res = client.get(f"/api/folders/{folder_id}/summary", headers=headers)
    folder_summary_res.raise_for_status()
    folder_summary_payload = folder_summary_res.json()
    if folder_summary_payload.get("summary_status") != "success":
        raise AssertionError(f"文件夹总结未成功: {folder_summary_payload}")

    with SessionLocal() as db:
        doc_summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
        if not doc_summary:
            raise AssertionError("DocumentSummary 记录不存在")

    return {
        "kind": kind,
        "file_id": file_id,
        "folder_id": folder_id,
        "task_status": task_payload["status"],
        "document_type": doc_summary.document_type,
        "query_hit": True,
        "path_mode": "backend-auto-summary" if auto_start_summary else "frontend-batch-summary",
    }


def main() -> None:
    client = TestClient(app)
    headers = get_auth_headers()

    pdf_bytes, _, pdf_ext = pick_sample_bytes([".pdf"])
    image_bytes, _, image_ext = pick_sample_bytes([".png", ".jpg", ".jpeg", ".webp"])

    mime_map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }

    results = [
        verify_case(
            client,
            headers,
            kind="pdf-auto",
            bytes_payload=pdf_bytes,
            ext=pdf_ext,
            mime=mime_map[pdf_ext],
            auto_start_summary=True,
        ),
        verify_case(
            client,
            headers,
            kind="image-batch",
            bytes_payload=image_bytes,
            ext=image_ext,
            mime=mime_map[image_ext],
            auto_start_summary=False,
        ),
    ]

    print("UPLOAD_PIPELINE_OK")
    for item in results:
        print(item)


if __name__ == "__main__":
    main()
