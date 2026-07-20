"""Migrate legacy Markdown preset files into folder-bound structured presets.

The source files remain untouched. Run without --apply for a dry run.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.models.folder import Folder  # noqa: E402
from app.models.folder_ai_preset import FolderAiPreset  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.folder_ai_preset_service import folder_ai_preset_service  # noqa: E402


SERVICE_DIR = Path(__file__).resolve().parents[1] / "app" / "services" / "preset_prompts"
SOURCES = [
    ("global/group_default_preset_questions.md", ("智海王潮传播集团", "智海王朝传播集团"), "全集团统一预设问答"),
    ("departments/cross_marketing_center_preset_questions.md", ("跨界营销中心", "跨境营销中心"), "跨界营销中心预设问答"),
]


def fallback_questions(content: str):
    questions = folder_ai_preset_service._fallback_parse(content)
    if questions:
        return questions
    return [{"question": "这份目录指引说明了什么？", "aliases": [], "answer": content, "keywords": [], "priority": 50}]


def find_folder(db, names):
    for name in names:
        folder = db.query(Folder).filter(Folder.name == name, Folder.is_deleted == False).first()
        if folder:
            return folder
    for name in names:
        folder = db.query(Folder).filter(Folder.name.contains(name[:4]), Folder.is_deleted == False).first()
        if folder:
            return folder
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ai-organize", action="store_true")
    args = parser.parse_args()

    with SessionLocal() as db:
        admin = db.query(User).filter(User.is_super_admin == True, User.is_active == True).order_by(User.id.asc()).first()
        if not admin:
            raise RuntimeError("No active super administrator found.")

        planned = []
        for relative_path, folder_names, preset_name in SOURCES:
            path = SERVICE_DIR / relative_path
            folder = find_folder(db, folder_names)
            if not path.exists() or not folder:
                print(f"SKIP {relative_path}: source or target folder missing")
                continue
            content = path.read_text(encoding="utf-8").strip()
            if args.ai_organize:
                organized = folder_ai_preset_service.organize_content(content)
                questions = organized["questions"]
            else:
                questions = fallback_questions(content)
            print(f"PLAN folder={folder.id}:{folder.name} source={relative_path} questions={len(questions)}")
            planned.append((folder, preset_name, content, questions))

        if not args.apply:
            print("DRY RUN: re-run with --apply to publish")
            return 0

        for folder, preset_name, content, questions in planned:
            existing = (
                db.query(FolderAiPreset)
                .filter(FolderAiPreset.folder_id == folder.id, FolderAiPreset.is_deleted == False)
                .order_by(FolderAiPreset.id.asc())
                .first()
            )
            saved = folder_ai_preset_service.publish(
                db,
                folder_id=folder.id,
                user=admin,
                name=preset_name,
                description="由旧版 Markdown 预设安全迁移；原文件保留。",
                source_content=content,
                questions=questions,
                inherit_to_children=True,
                preset_id=existing.id if existing else None,
            )
            print(f"PUBLISHED preset={saved['id']} version={saved['version']} questions={len(saved['questions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
