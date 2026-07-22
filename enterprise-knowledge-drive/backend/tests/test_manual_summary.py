from __future__ import annotations

import unittest
from types import SimpleNamespace

from app.routers.rag import _build_manual_summary_markdown


class ManualSummaryMarkdownTests(unittest.TestCase):
    def test_manual_summary_uses_separate_judgement_and_body(self) -> None:
        file = SimpleNamespace(id=42, original_name="培训视频.mp4")

        markdown = _build_manual_summary_markdown(
            file=file,
            one_line_judgement="这是一段新人培训视频",
            summary_text="第一部分介绍制度。\n第二部分介绍协作流程。",
        )

        self.assertIn("## 1. 文件一句话判断\n这是一段新人培训视频", markdown)
        self.assertIn("## 2. 两句话简介\n第一部分介绍制度。\n第二部分介绍协作流程。", markdown)

    def test_editing_manual_summary_preserves_existing_tags(self) -> None:
        file = SimpleNamespace(id=42, original_name="培训视频.mp4")
        existing_summary = SimpleNamespace(
            client_type="内部员工",
            project_type="新人培训",
            document_type="培训视频",
            industry_tags='["企业管理"]',
            region_tags='["海南"]',
            keyword_tags='["入职", "制度"]',
        )

        markdown = _build_manual_summary_markdown(
            file=file,
            one_line_judgement="更新后的一句话判断",
            summary_text="更新后的总结正文。",
            existing_summary=existing_summary,
        )

        self.assertIn("- 客户类型：内部员工", markdown)
        self.assertIn("- 项目类型：新人培训", markdown)
        self.assertIn('- 关键词标签：["入职", "制度"]', markdown)


if __name__ == "__main__":
    unittest.main()
