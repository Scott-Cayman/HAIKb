from __future__ import annotations

import uuid
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException

from app.database import SessionLocal
from app.models.audit_log import AuditLog
from app.models.folder import Folder
from app.models.user import User
from app.services.resource_access import get_folder_capabilities
from app.services.upload_folder_service import ensure_upload_folder_parts


def main() -> None:
    db = SessionLocal()
    try:
        users = db.query(User).filter(User.is_active == True).all()
        folders = db.query(Folder).filter(Folder.is_deleted == False).all()

        allowed_pair: tuple[User, Folder] | None = None
        denied_pair: tuple[User, Folder] | None = None
        for user in users:
            for folder in folders:
                can_upload = get_folder_capabilities(db, folder, user).can_upload
                if can_upload and allowed_pair is None:
                    allowed_pair = (user, folder)
                if not can_upload and not user.is_super_admin and denied_pair is None:
                    denied_pair = (user, folder)
                if allowed_pair and denied_pair:
                    break
            if allowed_pair and denied_pair:
                break

        if not allowed_pair:
            raise AssertionError("没有找到具备上传权限的测试用户和目录")

        allowed_user, allowed_folder = allowed_pair
        suffix = uuid.uuid4().hex[:10]
        result = ensure_upload_folder_parts(
            [f"drag-upload-verify-{suffix}", "nested"],
            allowed_folder.id,
            db,
            allowed_user,
            audit_source="verification",
        )
        if len(result.created_folder_ids) != 2:
            raise AssertionError(f"嵌套目录创建数量异常: {result.created_folder_ids}")
        audit_count = db.query(AuditLog).filter(
            AuditLog.action == "folder.create",
            AuditLog.target_id.in_(result.created_folder_ids),
        ).count()
        if audit_count != 2:
            raise AssertionError(f"目录创建审计记录数量异常: {audit_count}")
        db.rollback()

        denied_checked = False
        if denied_pair:
            denied_user, denied_folder = denied_pair
            try:
                ensure_upload_folder_parts(
                    [f"drag-upload-denied-{suffix}"],
                    denied_folder.id,
                    db,
                    denied_user,
                    audit_source="verification",
                )
            except HTTPException as error:
                if error.status_code != 403:
                    raise
                denied_checked = True
            finally:
                db.rollback()

        print(
            {
                "allowed_user_id": allowed_user.id,
                "allowed_folder_id": allowed_folder.id,
                "nested_create_and_audit": "ok",
                "denied_upload": "ok" if denied_checked else "skipped-no-denied-pair",
                "database_changes": "rolled_back",
            }
        )
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
