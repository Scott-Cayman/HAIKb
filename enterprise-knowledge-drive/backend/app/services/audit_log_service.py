from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User


def record_audit_log(
    db: Session,
    user: User,
    action: str,
    target_type: str,
    target_id: Optional[int],
    *,
    request: Optional[Request] = None,
    detail: Optional[dict[str, Any]] = None,
) -> AuditLog:
    """Append an audit record in the caller's transaction.

    The caller remains responsible for committing.  Keeping the audit row and
    the resource mutation in one transaction avoids records for operations that
    ultimately rolled back.
    """

    forwarded_for = request.headers.get("x-forwarded-for", "") if request else ""
    client_ip = forwarded_for.split(",", 1)[0].strip() if forwarded_for else ""
    if not client_ip and request and request.client:
        client_ip = request.client.host

    detail_snapshot = {
        "actor_id": user.id,
        "actor_name": user.name,
        "actor_department": user.full_department_path or user.department_name,
        **(detail or {}),
    }
    log = AuditLog(
        user_id=user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=json.dumps(detail_snapshot, ensure_ascii=False, default=str),
        ip=(client_ip or None),
        user_agent=(request.headers.get("user-agent", "")[:500] or None) if request else None,
    )
    db.add(log)
    db.flush()
    return log
