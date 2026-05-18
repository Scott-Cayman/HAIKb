from __future__ import annotations

import json
import re
from collections import Counter
from typing import Dict, List

from app.models.file import File
from app.services.llm_service import llm_service


SUMMARY_PROMPT = """你是 HAIKb 企业知识库的文档理解器。你的任务不是写给人看的文章，而是生成一份给大模型检索、判断、复用的结构化总结文档。

你将收到一个企业文件的前 10 页文本。文件可能是政府标书、投标文件、项目方案、活动执行方案、会展会务材料等。

你必须只基于输入文本总结，不要编造原文没有的信息。
如果某些字段无法判断，请写“未识别”。

请严格输出 Markdown，结构如下：
# AI_DOCUMENT_SUMMARY
## 0. 机器可读元数据
- file_id: {file_id}
- original_name: {original_name}
- document_type: 招标文件/投标文件/项目方案/执行方案/合同/其他/未识别
- parse_scope: first_10_pages
- parse_pages: {parse_pages}
- parse_confidence: {parse_confidence}
## 1. 文件一句话判断
## 2. 两句话简介
## 3. 标签
## 4. 重要信息摘要
## 5. 可复用价值
## 6. 适合被以下问题检索到
## 7. 检索关键词扩展
## 8. 解析限制
固定写：本总结仅基于原文件前 10 页生成，可能无法覆盖全文所有细节。如需查看完整内容，请打开原文件预览。"""


class SummaryGeneratorService:
    """优先调用 LLM，未配置时退回规则总结。"""

    def generate_summary(self, file: File, parsed: Dict[str, object]) -> Dict[str, object]:
        text = (parsed.get("text") or "").strip()
        parse_pages = int(parsed.get("parsed_pages") or 10)
        parse_confidence = str(parsed.get("parse_confidence") or "low")

        markdown = ""
        if llm_service.is_configured() and text:
            markdown = self._generate_with_llm(file, text, parse_pages, parse_confidence)

        if not markdown:
            markdown = self._generate_with_rules(file, text, parse_pages, parse_confidence)

        fields = self.extract_structured_fields(markdown)
        fields["summary_markdown"] = markdown
        fields["parse_pages"] = parse_pages
        fields["parse_confidence"] = parse_confidence
        return fields

    def _generate_with_llm(self, file: File, text: str, parse_pages: int, parse_confidence: str) -> str:
        prompt = SUMMARY_PROMPT.format(
            file_id=file.id,
            original_name=file.original_name,
            parse_pages=parse_pages,
            parse_confidence=parse_confidence,
        )
        user_content = f"文件名：{file.original_name}\n\n前 10 页文本如下：\n{text[:16000]}"
        try:
            return llm_service.chat(
                [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.1,
                max_tokens=1800,
            )
        except Exception:
            return ""

    def _generate_with_rules(self, file: File, text: str, parse_pages: int, parse_confidence: str) -> str:
        client_type = self._guess_label(
            text,
            file.original_name,
            {
                "政府": ["政府", "政务", "采购", "招标", "公共资源"],
                "国企": ["国企", "集团", "国有"],
                "协会": ["协会", "学会", "联合会"],
                "品牌方": ["品牌", "营销", "发布会"],
                "民企": ["有限公司", "股份", "企业"],
            },
        )
        project_type = self._guess_label(
            text,
            file.original_name,
            {
                "文旅": ["文旅", "景区", "旅游", "文创"],
                "会展": ["会展", "展会", "展览", "博览"],
                "活动": ["活动", "执行", "赛事", "路演"],
                "会议": ["会议", "论坛", "峰会", "会务"],
                "招商": ["招商", "推介"],
                "宣传": ["宣传", "传播", "推广"],
                "运营": ["运营", "托管"],
            },
        )
        document_type = self._guess_label(
            text,
            file.original_name,
            {
                "招标文件": ["招标", "采购需求", "招标公告"],
                "投标文件": ["投标", "响应文件"],
                "方案": ["方案", "策划", "执行方案"],
                "合同": ["合同", "协议"],
                "其他": ["说明", "资料"],
            },
        )
        keyword_tags = self._top_keywords(text or file.original_name)
        region_tags = self._collect_tags(text, ["北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "成都", "重庆"])
        industry_tags = self._collect_tags(text, ["文旅", "会展", "政务", "教育", "交通", "医疗", "能源", "消费"])
        one_line = f"这是一份以{client_type}客户为主、偏向{project_type}场景的{document_type}资料，可用于企业知识检索与项目复用判断。"
        two_sentence = (
            f"这份文件主要围绕{client_type}客户的{project_type}项目展开，适合用于快速判断项目背景、服务范围和交付要求。"
            f"它可作为后续检索{project_type}、{client_type}客户案例和复用方案结构时的摘要入口。"
        )
        search_keywords = "、".join(keyword_tags[:10]) if keyword_tags else "未识别"
        questions = [
            f"找{client_type}类项目",
            f"找{project_type}类资料",
            f"有没有相关{document_type}",
            "找可复用的历史案例",
            "找带服务范围和关键要求的文件",
        ]
        important_lines = self._pick_sentences(text)
        question_lines = "\n".join(f"- {item}" for item in questions)

        return f"""# AI_DOCUMENT_SUMMARY

## 0. 机器可读元数据
- file_id: {file.id}
- original_name: {file.original_name}
- document_type: {document_type}
- parse_scope: first_10_pages
- parse_pages: {parse_pages}
- parse_confidence: {parse_confidence}

## 1. 文件一句话判断
{one_line}

## 2. 两句话简介
{two_sentence}

## 3. 标签
- 客户类型：{client_type}
- 项目类型：{project_type}
- 文件类型：{document_type}
- 行业标签：{json.dumps(industry_tags, ensure_ascii=False)}
- 区域标签：{json.dumps(region_tags, ensure_ascii=False)}
- 关键词标签：{json.dumps(keyword_tags, ensure_ascii=False)}

## 4. 重要信息摘要
- 项目名称：{self._extract_title(text, file.original_name)}
- 采购方 / 甲方：{self._extract_party(text)}
- 项目背景：{important_lines[0] if important_lines else '未识别'}
- 服务范围：{important_lines[1] if len(important_lines) > 1 else '未识别'}
- 关键要求：{important_lines[2] if len(important_lines) > 2 else '未识别'}
- 评分重点：{important_lines[3] if len(important_lines) > 3 else '未识别'}
- 时间节点：未识别
- 预算金额：未识别
- 资质要求：未识别

## 5. 可复用价值
该文件可作为{client_type}客户、{project_type}场景的历史摘要入口，帮助团队先判断是否值得打开原文件进一步核验。

## 6. 适合被以下问题检索到
{question_lines}

## 7. 检索关键词扩展
{search_keywords}

## 8. 解析限制
本总结仅基于原文件前 10 页生成，可能无法覆盖全文所有细节。如需查看完整内容，请打开原文件预览。
"""

    def extract_structured_fields(self, markdown: str) -> Dict[str, object]:
        def section(title: str) -> str:
            pattern = rf"## {re.escape(title)}\n([\s\S]*?)(?=\n## |$)"
            match = re.search(pattern, markdown)
            return match.group(1).strip() if match else ""

        tags_section = section("3. 标签")
        one_line = section("1. 文件一句话判断")
        return {
            "one_line_judgement": one_line.splitlines()[0] if one_line else "",
            "two_sentence_intro": section("2. 两句话简介").replace("\n", " ").strip(),
            "client_type": self._extract_tag_value(tags_section, "客户类型"),
            "project_type": self._extract_tag_value(tags_section, "项目类型"),
            "document_type": self._extract_tag_value(tags_section, "文件类型"),
            "industry_tags": self._normalize_json_tag(self._extract_tag_value(tags_section, "行业标签")),
            "region_tags": self._normalize_json_tag(self._extract_tag_value(tags_section, "区域标签")),
            "keyword_tags": self._normalize_json_tag(self._extract_tag_value(tags_section, "关键词标签")),
            "parse_confidence": self._extract_meta_value(markdown, "parse_confidence") or "low",
        }

    def _extract_tag_value(self, content: str, label: str) -> str:
        match = re.search(rf"- {re.escape(label)}：(.*)", content)
        return match.group(1).strip() if match else "未识别"

    def _extract_meta_value(self, markdown: str, label: str) -> str:
        match = re.search(rf"- {re.escape(label)}: (.*)", markdown)
        return match.group(1).strip() if match else ""

    def _normalize_json_tag(self, raw_value: str) -> str:
        if not raw_value:
            return json.dumps([], ensure_ascii=False)
        try:
            parsed = json.loads(raw_value)
            if isinstance(parsed, list):
                return json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError:
            pass
        values = [item.strip() for item in re.split(r"[、,，/\s]+", raw_value) if item.strip() and item.strip() != "未识别"]
        return json.dumps(values, ensure_ascii=False)

    def _guess_label(self, text: str, filename: str, mapping: Dict[str, List[str]]) -> str:
        source = f"{filename}\n{text}".lower()
        for label, keywords in mapping.items():
            if any(keyword.lower() in source for keyword in keywords):
                return label
        return "未识别"

    def _top_keywords(self, text: str) -> List[str]:
        parts = re.findall(r"[\u4e00-\u9fff]{2,}|[a-zA-Z0-9_]{3,}", text or "")
        counter = Counter(parts)
        stop_words = {"项目", "服务", "要求", "内容", "文件", "公司", "我们", "以及", "本次", "进行"}
        keywords = [word for word, _ in counter.most_common(12) if word not in stop_words]
        return keywords[:10] or ["未识别"]

    def _collect_tags(self, text: str, candidates: List[str]) -> List[str]:
        return [candidate for candidate in candidates if candidate in (text or "")][:8]

    def _pick_sentences(self, text: str) -> List[str]:
        sentences = [part.strip() for part in re.split(r"[。；;\n]", text or "") if len(part.strip()) >= 12]
        return sentences[:4]

    def _extract_title(self, text: str, fallback: str) -> str:
        first_line = next((line.strip() for line in (text or "").splitlines() if line.strip()), "")
        return first_line[:80] if first_line else fallback

    def _extract_party(self, text: str) -> str:
        match = re.search(r"(采购人|采购方|招标人|甲方)[:：]?\s*([^\n。；;]{2,40})", text or "")
        return match.group(2).strip() if match else "未识别"


summary_generator_service = SummaryGeneratorService()
