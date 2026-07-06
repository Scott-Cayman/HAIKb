from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import List, Optional, Dict

from app.database import SessionLocal
from app.models.agent_message import AgentMessage
from app.rag.index_manager import index_manager
from app.rag.tools import SummaryDocSearchTool
from app.services.llm_service import llm_service

# 加载公司 AI 工具信息
COMPANY_AI_TOOLS_PATH = Path(__file__).parent / "company_ai_tools.md"
COMPANY_AI_TOOLS_CONTENT = ""
if COMPANY_AI_TOOLS_PATH.exists():
    with open(COMPANY_AI_TOOLS_PATH, "r", encoding="utf-8") as f:
        COMPANY_AI_TOOLS_CONTENT = f.read()

# 加载公司运营指南（常见问题汇总）
COMPANY_OPS_GUIDE_PATH = Path(__file__).parent / "company_operations_guide.md"
COMPANY_OPS_GUIDE_CONTENT = ""
if COMPANY_OPS_GUIDE_PATH.exists():
    with open(COMPANY_OPS_GUIDE_PATH, "r", encoding="utf-8") as f:
        COMPANY_OPS_GUIDE_CONTENT = f.read()


# 构建系统提示词，包含公司 AI 工具信息和运营指南
def build_system_prompt():
    base_prompt = """你是 HAIKb 企业知识库 Agent，负责帮助用户从公司历史文件中找到可复用的项目资料、标书文件、投标方案和案例文件。

1. 你不能直接读取或检索原文件全文。
2. 你只能基于系统提供的 AI_DOCUMENT_SUMMARY 总结文档回答。
3. 回答格式：先直接回答用户的问题，再给出推荐文件和依据（如果有）。
4. 如果是查找文件类问题，必须返回相关原文件，每个推荐文件都必须包含两句话简介。
5. 如果是问题咨询类，基于知识库和自身理解给出详细、完整的解答，尽可能展开说明，再附上相关参考文件。
6. 回答要尽可能详细、全面，不要过于简短，分点说明会更好。
7. 不要编造不存在的文件、客户、项目、金额、评分标准。
8. 如果没有找到高匹配文件，可以基于知识库给出相近建议，或说明知识库内容不足。"""
    
    # 追加公司运营指南上下文
    if COMPANY_OPS_GUIDE_CONTENT:
        base_prompt += (
            f"\n\n---\n\n"
            f"### 公司运营指南（常见问题与操作流程）\n\n"
            f"{COMPANY_OPS_GUIDE_CONTENT}\n\n"
            f"---\n\n"
            f"当用户咨询考勤、行政、财务、运营流程、入职适应、团队协作、业务技能等公司内部问题时，"
            f"必须优先查阅上述公司运营指南。如果指南中有对应答案，直接引用回答；"
            f"如果指南未覆盖，再结合知识库文件回答，并标注信息来源。"
        )

    # 追加公司 AI 工具信息上下文
    if COMPANY_AI_TOOLS_CONTENT:
        base_prompt += (
            f"\n\n---\n\n"
            f"### 智海王潮公司 AI 工具体系\n\n"
            f"{COMPANY_AI_TOOLS_CONTENT}\n\n"
            f"---\n\n"
            f"在回答用户问题时，优先使用上述智海王潮公司 AI 工具体系的信息回答相关问题。"
        )

    return base_prompt

SYSTEM_PROMPT = build_system_prompt()


class OptimizedAgentService:
    """优化的 Agent 服务，减少不必要的 LLM 调用。"""

    def __init__(self):
        pass

    def _ai_score_files(self, query: str, related_files: List[dict]) -> List[dict]:
        """直接使用 LLM 评分所有文件。"""
        if not llm_service.is_configured():
            return related_files

        if not related_files:
            return related_files

        file_descriptions = []
        for i, file in enumerate(related_files):
            desc = f"""文件 {i+1}:
名称: {file['original_name']}
一句话判断: {file['one_line_judgement'] or '暂无'}
"""
            file_descriptions.append(desc)

        prompt = f"""你是一个企业知识库检索助手，需要评估以下文件与用户查询的相关性。

用户查询: {query}

候选文件:
{chr(10).join(file_descriptions)}

请对每个文件给出 0.0 到 1.0 的相关性评分（1.0 最相关，0.0 完全不相关）。
输出格式要求：
- 每行只输出 "文件X: 评分"（精确到小数点后2位）
- X 是上面的文件序号（1, 2, 3...）
- 不要有任何其他文字"""

        try:
            response = llm_service.chat(
                [
                    {"role": "system", "content": "你是一个严格按格式输出的评分助手。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=500,
            )

            scores = {}
            for line in response.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                if "文件" in line and ":" in line:
                    parts = line.split(":", 1)
                    if len(parts) == 2:
                        file_num_str = parts[0].replace("文件", "").strip()
                        try:
                            file_num = int(file_num_str)
                            score_str = parts[1].strip()
                            try:
                                score = float(score_str)
                                scores[file_num] = max(0.0, min(1.0, score))
                            except ValueError:
                                continue
                        except ValueError:
                            continue

            for i, file in enumerate(related_files):
                file_num = i + 1
                if file_num in scores:
                    file["original_retrieval_score"] = file.get("score")
                    file["score"] = scores[file_num]

            related_files.sort(key=lambda x: x["score"], reverse=True)

        except Exception:
            pass

        return related_files

    def chat(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        top_k: int = 8,
        retrieval_mode: str = "hybrid",
        user_id: Optional[int] = None,
    ) -> dict:
        conv_id = conversation_id or str(uuid.uuid4())
        index = index_manager.get_default_index()
        retriever = index.get_retriever_pipeline(settings={"retrieval_mode": retrieval_mode}, user_id=user_id)
        tool = SummaryDocSearchTool(retriever)

        tool_result = tool.run(query=query, top_k=min(top_k * 2, 20), retrieval_mode=retrieval_mode)
        evidence = tool_result["evidence"]
        related_files = tool_result["related_files"]

        related_files = self._ai_score_files(query, related_files)

        related_files = related_files[:top_k]

        answer = self._build_answer(query, evidence, related_files)

        with SessionLocal() as db:
            db.add(AgentMessage(conversation_id=conv_id, user_id=user_id, role="user", content=query))
            db.add(
                AgentMessage(
                    conversation_id=conv_id,
                    user_id=user_id,
                    role="assistant",
                    content=answer,
                    metadata_json=json.dumps({"evidence": evidence, "related_files": related_files}, ensure_ascii=False),
                )
            )
            db.commit()

        return {
            "conversation_id": conv_id,
            "answer": answer,
            "evidence": evidence,
            "related_files": related_files,
        }

    def _build_answer(self, query: str, evidence: List[dict], related_files: List[dict]) -> str:
        if not evidence:
            return (
                "当前知识库里没有找到足够相关的文档，建议换个关键词再试，或先上传相关资料。\n\n"
                "### 推荐文件\n"
                "暂无可推荐文件。"
            )

        evidence_text = "\n\n".join(
            f"文件：{item.get('file_name') or item['file_id']}\n分数：{item['score']}\n证据：{item['content'][:500]}"
            for item in evidence[: min(len(evidence), 6)]
        )
        related_text = "\n".join(
            f"- {item['original_name']}｜一句话判断：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )

        if llm_service.is_configured():
            prompt = (
                f"用户问题：\n{query}\n\n"
                f"下面是从 HAIKb 总结文档索引中检索到的证据。\n\n"
                f"{evidence_text}\n\n"
                f"推荐文件：\n{related_text}\n\n"
                "请综合以下信息回答用户问题：\n"
                "- 系统提示词中的公司运营指南（考勤、行政、财务、入职、团队协作、业务技能等）\n"
                "- 系统提示词中的公司 AI 工具体系信息\n"
                "- 上述 RAG 检索到的文档证据\n\n"
                "要求：\n"
                "1. 当问题涉及公司内部制度、流程、工作方法时，优先引用系统提示词中的运营指南内容，再结合 RAG 证据补充。\n"
                "2. 不要编造不存在的信息。\n"
                "3. 如果证据不足，请明确说明，并基于自身理解给出参考建议。\n"
                "4. 输出格式：先直接给出回答，再列出推荐文件（如果有），最后给出依据说明。\n"
                "5. 不要使用'匹配结论'这样的标题。"
            )
            try:
                return llm_service.chat(
                    [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    max_tokens=2048,
                )
            except Exception:
                pass

        recommend_lines = "\n".join(
            f"- {item['original_name']}：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )
        return (
            f"已从 AI 总结文档中找到 {len(related_files)} 份较相关文件，可用于参考。\n\n"
            "### 推荐文件\n"
            f"{recommend_lines}\n\n"
            "系统已根据命中的总结文档整理出相关资料，优先建议先查看推荐文件的 AI 总结和原文件预览，再核对全文细节。"
        )


agent_service = OptimizedAgentService()

