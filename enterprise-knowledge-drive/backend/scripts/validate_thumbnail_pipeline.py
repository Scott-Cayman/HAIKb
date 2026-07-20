from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from PIL import Image

from app.config import settings
from app.database import SessionLocal
from app.models.file import File
from app.services.file_preview_service import (
    process_file_preview_assets,
    recover_interrupted_thumbnail_jobs,
)


def main() -> None:
    source_path = Path(settings.STORAGE_DIR) / "originals" / f"thumbnail-regression-{uuid.uuid4().hex}.png"
    file_id: int | None = None
    thumbnail_path: Path | None = None
    try:
        source_path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (1280, 720), color=(48, 190, 174)).save(source_path, format="PNG")

        with SessionLocal() as db:
            record = File(
                original_name="缩略图回归测试.png",
                stored_name=source_path.name,
                file_ext=".png",
                mime_type="image/png",
                size=source_path.stat().st_size,
                storage_path=str(source_path),
                preview_path=str(source_path),
                preview_status="success",
                preview_kind="image",
                thumbnail_status="processing",
                summary_status="unsupported",
                is_deleted=False,
            )
            db.add(record)
            db.commit()
            db.refresh(record)
            file_id = record.id

        recovered = recover_interrupted_thumbnail_jobs()
        with SessionLocal() as db:
            record = db.query(File).filter(File.id == file_id).one()
            if record.thumbnail_status != "pending":
                raise AssertionError("interrupted thumbnail job was not recovered")

        process_file_preview_assets(file_id)
        with SessionLocal() as db:
            record = db.query(File).filter(File.id == file_id).one()
            thumbnail_path = Path(record.thumbnail_path or "")
            if record.thumbnail_status != "success" or not thumbnail_path.exists():
                raise AssertionError("thumbnail was not generated")
            first_mtime = thumbnail_path.stat().st_mtime_ns
            first_size = thumbnail_path.stat().st_size

        time.sleep(0.02)
        process_file_preview_assets(file_id)
        second_mtime = thumbnail_path.stat().st_mtime_ns
        if second_mtime != first_mtime:
            raise AssertionError("a completed shared thumbnail was generated twice")

        print(
            json.dumps(
                {
                    "recovered_jobs": recovered,
                    "thumbnail_status": "success",
                    "thumbnail_bytes": first_size,
                    "shared_thumbnail_reused": True,
                },
                ensure_ascii=False,
            )
        )
    finally:
        if file_id is not None:
            with SessionLocal() as db:
                db.query(File).filter(File.id == file_id).delete(synchronize_session=False)
                db.commit()
        source_path.unlink(missing_ok=True)
        if thumbnail_path:
            thumbnail_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
