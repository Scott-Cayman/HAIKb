from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from app.database import SessionLocal
from app.models.document_summary import DocumentSummary
from app.models.file import File
from app.services.summary_index_service import summary_index_service


MAX_BATCH_SECONDS = 300
MAX_RETRY_ATTEMPTS = 3


@dataclass
class BatchSummaryTask:
    """内存中的批量总结任务状态。"""

    task_id: str
    file_ids: List[int]
    created_at: float
    deadline_at: float
    status: str = "running"
    message: Optional[str] = None
    processing_file_id: Optional[int] = None
    completed_file_ids: List[int] = field(default_factory=list)
    success_file_ids: List[int] = field(default_factory=list)
    failed_file_ids: List[int] = field(default_factory=list)
    pending_file_ids: List[int] = field(default_factory=list)
    retry_queue: List[int] = field(default_factory=list)
    attempts: Dict[int, int] = field(default_factory=dict)
    last_error_by_file: Dict[int, str] = field(default_factory=dict)


class BatchSummaryService:
    """上传后的批量总结任务服务，支持进度、重试和超时兜底。"""

    def __init__(self) -> None:
        self._tasks: Dict[str, BatchSummaryTask] = {}
        self._active_file_task_map: Dict[int, str] = {}
        self._lock = threading.Lock()

    def create_task(self, file_ids: List[int]) -> dict:
        normalized_ids = self._normalize_file_ids(file_ids)
        if not normalized_ids:
            raise ValueError("没有可生成总结的文件")

        with self._lock:
            existing_task_ids = {
                self._active_file_task_map[file_id]
                for file_id in normalized_ids
                if file_id in self._active_file_task_map
            }
            if len(normalized_ids) == 1 and len(existing_task_ids) == 1:
                existing_task = self._tasks.get(next(iter(existing_task_ids)))
                if existing_task:
                    return self._serialize_task(existing_task)
            normalized_ids = [file_id for file_id in normalized_ids if file_id not in self._active_file_task_map]

        if not normalized_ids:
            raise ValueError("文件总结任务已在处理中")

        task_id = str(uuid.uuid4())
        now = time.time()
        task = BatchSummaryTask(
            task_id=task_id,
            file_ids=normalized_ids,
            pending_file_ids=list(normalized_ids),
            created_at=now,
            deadline_at=now + MAX_BATCH_SECONDS,
        )
        with self._lock:
            self._tasks[task_id] = task
            for file_id in normalized_ids:
                self._active_file_task_map[file_id] = task_id

        worker = threading.Thread(target=self._run_task, args=(task_id,), daemon=True)
        worker.start()
        return self.get_task_status(task_id)

    def get_task_status(self, task_id: str) -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise ValueError("批量总结任务不存在")
            snapshot = self._serialize_task(task)
        return snapshot

    def _normalize_file_ids(self, file_ids: List[int]) -> List[int]:
        unique_ids: List[int] = []
        seen = set()
        with SessionLocal() as db:
            for raw_id in file_ids:
                try:
                    file_id = int(raw_id)
                except (TypeError, ValueError):
                    continue
                if file_id in seen:
                    continue
                exists = db.query(File.id).filter(File.id == file_id, File.is_deleted == False).first()
                if not exists:
                    continue
                seen.add(file_id)
                unique_ids.append(file_id)
        return unique_ids

    def _run_task(self, task_id: str) -> None:
        try:
            first_round_failures: List[int] = []

            with self._lock:
                task = self._tasks[task_id]
                first_round_targets = list(task.file_ids)

            for file_id in first_round_targets:
                if self._is_deadline_exceeded(task_id):
                    self._finalize_timeout(task_id)
                    return
                success = self._process_single_file(task_id, file_id)
                if not success:
                    first_round_failures.append(file_id)

            retry_round = 0
            retry_candidates = list(first_round_failures)
            while retry_candidates:
                if self._is_deadline_exceeded(task_id):
                    self._finalize_timeout(task_id)
                    return

                retry_round += 1
                if retry_round >= MAX_RETRY_ATTEMPTS:
                    break

                next_round_failures: List[int] = []
                with self._lock:
                    task = self._tasks[task_id]
                    task.retry_queue = list(retry_candidates)
                    task.pending_file_ids = list(retry_candidates)

                for file_id in retry_candidates:
                    if self._is_deadline_exceeded(task_id):
                        self._finalize_timeout(task_id)
                        return
                    success = self._process_single_file(task_id, file_id)
                    if not success:
                        next_round_failures.append(file_id)

                retry_candidates = next_round_failures

            with self._lock:
                task = self._tasks[task_id]
                task.processing_file_id = None
                task.pending_file_ids = []
                task.retry_queue = []
                task.failed_file_ids = list(retry_candidates)
                if retry_candidates and time.time() >= task.deadline_at:
                    task.status = "failed"
                    task.message = "生成失败，请联系管理员"
                elif retry_candidates:
                    task.status = "partial_failed"
                    task.message = "部分文件生成失败，请稍后重试或联系管理员"
                else:
                    task.status = "success"
                    task.message = "总结生成完成"
                self._release_task_files(task)
        except Exception as exc:
            with self._lock:
                task = self._tasks[task_id]
                task.processing_file_id = None
                task.pending_file_ids = []
                task.retry_queue = []
                task.failed_file_ids = sorted(set(task.file_ids) - set(task.success_file_ids))
                task.status = "failed"
                task.message = str(exc) or "生成失败，请联系管理员"
                self._release_task_files(task)

    def _process_single_file(self, task_id: str, file_id: int) -> bool:
        with self._lock:
            task = self._tasks[task_id]
            task.processing_file_id = file_id
            task.pending_file_ids = [item for item in task.pending_file_ids if item != file_id]
            task.attempts[file_id] = task.attempts.get(file_id, 0) + 1

        try:
            # 已成功生成的文件直接跳过，避免重复总结。
            with SessionLocal() as db:
                file = db.query(File).filter(File.id == file_id, File.is_deleted == False).first()
                summary = db.query(DocumentSummary).filter(DocumentSummary.file_id == file_id).first()
                if file and file.summary_status == "success" and summary and not summary.is_deleted:
                    self._mark_success(task_id, file_id)
                    return True

            summary_index_service.summarize_file(file_id=file_id, reindex=True)
            self._mark_success(task_id, file_id)
            return True
        except Exception as exc:
            self._mark_failure(task_id, file_id, str(exc))
            return False

    def _mark_success(self, task_id: str, file_id: int) -> None:
        with self._lock:
            task = self._tasks[task_id]
            task.processing_file_id = None
            if file_id not in task.completed_file_ids:
                task.completed_file_ids.append(file_id)
            if file_id not in task.success_file_ids:
                task.success_file_ids.append(file_id)
            if file_id in task.failed_file_ids:
                task.failed_file_ids.remove(file_id)
            task.last_error_by_file.pop(file_id, None)

    def _mark_failure(self, task_id: str, file_id: int, error_message: str) -> None:
        with self._lock:
            task = self._tasks[task_id]
            task.processing_file_id = None
            task.last_error_by_file[file_id] = error_message
            if file_id in task.success_file_ids:
                task.success_file_ids.remove(file_id)
            if file_id not in task.failed_file_ids:
                task.failed_file_ids.append(file_id)

    def _is_deadline_exceeded(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks[task_id]
            return time.time() >= task.deadline_at

    def _finalize_timeout(self, task_id: str) -> None:
        with self._lock:
            task = self._tasks[task_id]
            remaining = set(task.file_ids) - set(task.success_file_ids)
            task.processing_file_id = None
            task.pending_file_ids = []
            task.retry_queue = []
            task.failed_file_ids = sorted(remaining)
            task.status = "failed"
            task.message = "生成失败，请联系管理员"
            self._release_task_files(task)

    def _serialize_task(self, task: BatchSummaryTask) -> dict:
        elapsed_seconds = int(max(0, time.time() - task.created_at))
        total = len(task.file_ids)
        success_count = len(task.success_file_ids)
        failed_count = len(task.failed_file_ids)
        completed_count = len(set(task.completed_file_ids))
        processing_count = 1 if task.processing_file_id else 0
        pending_count = max(total - success_count - failed_count - processing_count, 0)
        return {
            "task_id": task.task_id,
            "status": task.status,
            "message": task.message,
            "total_count": total,
            "completed_count": completed_count,
            "success_count": success_count,
            "failed_count": failed_count,
            "processing_count": processing_count,
            "pending_count": pending_count,
            "processing_file_id": task.processing_file_id,
            "elapsed_seconds": elapsed_seconds,
            "timeout_seconds": MAX_BATCH_SECONDS,
            "retry_attempts": task.attempts,
            "failed_file_ids": task.failed_file_ids,
            "success_file_ids": task.success_file_ids,
            "last_error_by_file": task.last_error_by_file,
        }

    def _release_task_files(self, task: BatchSummaryTask) -> None:
        for file_id in task.file_ids:
            mapped_task_id = self._active_file_task_map.get(file_id)
            if mapped_task_id == task.task_id:
                self._active_file_task_map.pop(file_id, None)


batch_summary_service = BatchSummaryService()
