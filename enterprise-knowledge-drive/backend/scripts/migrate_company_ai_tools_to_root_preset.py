from __future__ import annotations

import json
from pathlib import Path
import sys


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.database import SessionLocal
from app.models.folder import Folder
from app.models.folder_ai_preset import FolderAiPreset, FolderAiPresetQuestion
from app.models.user import User
from app.services.folder_ai_preset_service import folder_ai_preset_service


SOURCE_PATH = BACKEND_DIR / "app" / "services" / "company_ai_tools.md"
ROOT_FOLDER_NAME = "智海王潮传播集团"

TOOL_QUESTIONS = [
    {
        "question": "公司有哪些 AI 工具？",
        "aliases": ["公司的AI工具", "智海王潮AI工具", "AI工具有哪些", "公司AI产品"],
        "keywords": ["HAI", "HAIAgent", "HAIPablo", "AI工具"],
        "priority": 100,
        "is_enabled": True,
        "answer": (
            "智海王潮目前主要使用三款 AI 工具：\n\n"
            "1. **HAI**：集团 AI 聚合平台，统一入口为 https://hai.himice.com/home 。\n"
            "2. **HAIAgent**：面向活动营销和会展策划的方案策划智能体，访问 https://agent.himice.com/ 。\n"
            "3. **HAIPablo**：面向视觉创意、图片生成和物料延展的 AI 创意工作台，访问 http://pablo.himice.net:7777/ 。"
        ),
    },
    {
        "question": "HAI 是什么，网站地址是什么？",
        "aliases": ["HAI网站", "HAI地址", "HAI平台", "怎么访问HAI", "hai网址"],
        "keywords": ["HAI", "AI聚合平台", "hai.himice.com"],
        "priority": 100,
        "is_enabled": True,
        "answer": (
            "HAI 是智海王潮的 AI 聚合平台，面向集团员工提供统一的 AI 能力入口，可用于文本生成、信息整理、"
            "知识查询、办公辅助和业务提效。访问地址：https://hai.himice.com/home 。"
        ),
    },
    {
        "question": "HAIAgent 是什么，如何访问？",
        "aliases": ["HAIAgent网站", "方案策划智能体", "agent地址", "怎么访问HAIAgent"],
        "keywords": ["HAIAgent", "方案策划", "agent.himice.com"],
        "priority": 95,
        "is_enabled": True,
        "answer": (
            "HAIAgent 是智海王潮面向活动营销和会展策划打造的方案策划智能体，可辅助客户分析、项目分析、"
            "活动策略、创意方向、执行方案和传播思路的生成与优化。访问地址：https://agent.himice.com/ 。"
        ),
    },
    {
        "question": "HAIPablo 是什么，如何访问？",
        "aliases": ["HAIPablo网站", "Pablo网站", "AI创意工作台", "怎么访问Pablo"],
        "keywords": ["HAIPablo", "Pablo", "AI创意", "图片生成"],
        "priority": 95,
        "is_enabled": True,
        "answer": (
            "HAIPablo 是智海王潮的 AI 创意工作台，主要用于视觉创意、图片生成、物料延展、风格参考、海报设计"
            "和活动视觉辅助。访问地址：http://pablo.himice.net:7777/ 。"
        ),
    },
]


def main() -> None:
    source_content = SOURCE_PATH.read_text(encoding="utf-8").strip()
    with SessionLocal() as db:
        root = (
            db.query(Folder)
            .filter(Folder.parent_id == None, Folder.is_deleted == False, Folder.name == ROOT_FOLDER_NAME)
            .first()
        )
        if not root:
            raise RuntimeError(f"未找到集团根目录：{ROOT_FOLDER_NAME}")

        admin = (
            db.query(User)
            .filter(User.is_super_admin == True, User.is_active == True)
            .order_by(User.id.asc())
            .first()
        )
        if not admin:
            raise RuntimeError("未找到可执行迁移的超级管理员")

        preset = (
            db.query(FolderAiPreset)
            .filter(FolderAiPreset.folder_id == root.id, FolderAiPreset.is_deleted == False)
            .order_by(FolderAiPreset.updated_at.desc(), FolderAiPreset.id.desc())
            .first()
        )
        existing_questions = []
        if preset:
            for row in (
                db.query(FolderAiPresetQuestion)
                .filter(FolderAiPresetQuestion.preset_id == preset.id)
                .order_by(FolderAiPresetQuestion.priority.desc(), FolderAiPresetQuestion.id.asc())
                .all()
            ):
                existing_questions.append(
                    {
                        "question": row.question,
                        "aliases": json.loads(row.aliases_json or "[]"),
                        "answer": row.answer,
                        "keywords": json.loads(row.keywords_json or "[]"),
                        "priority": row.priority,
                        "is_enabled": row.is_enabled,
                    }
                )

        tool_question_keys = {
            folder_ai_preset_service.normalize_question(item["question"])
            for item in TOOL_QUESTIONS
        }
        preserved_questions = [
            item
            for item in existing_questions
            if folder_ai_preset_service.normalize_question(item["question"]) not in tool_question_keys
        ]
        existing_source = (preset.source_content or "").strip() if preset else ""
        merged_source = existing_source
        if "# 智海王潮公司 AI 工具体系" not in existing_source:
            merged_source = "\n\n---\n\n".join(part for part in [existing_source, source_content] if part)

        result = folder_ai_preset_service.publish(
            db,
            folder_id=root.id,
            user=admin,
            preset_id=preset.id if preset else None,
            name=preset.name if preset else "全集团统一预设问答",
            description=(preset.description if preset else None) or "集团通用知识、产品工具与统一口径",
            source_content=merged_source,
            inherit_to_children=True,
            questions=preserved_questions + TOOL_QUESTIONS,
        )
        print(
            {
                "root_folder_id": root.id,
                "preset_id": result["id"],
                "version": result["version"],
                "question_count": len(result["questions"]),
            }
        )


if __name__ == "__main__":
    main()
