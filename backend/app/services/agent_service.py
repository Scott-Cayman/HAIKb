from __future__ import annotations

import json
import uuid
from typing import List, Optional

from app.database import SessionLocal
from app.models.agent_message import AgentMessage
from app.rag.index_manager import index_manager
from app.rag.tools import SummaryDocSearchTool
from app.services.llm_service import llm_service


SYSTEM_PROMPT = """你是 HAIKb 企业知识库 Agent，负责帮助用户从公司历史文件中找到可复用的项目资料、标书文件、投标方案和案例文件。

PROJECT_ROOT="${PROJECT_ROOT:-$DEFAULT_PROJECT_ROOT}"
1. 你不能直接读取或检索原文件全文。
2. 你只能基于系统提供的 AI_DOCUMENT_SUMMARY 总结文档回答。
3. 如果总结文档不足以支持明确结论，你必须说明“当前仅基于前 10 页总结判断”。
4. 用户要求找文件时，你必须返回相关原文件，而不是只给文字回答。
5. 每个推荐文件都必须包含两句话简介。
6. 不要编造不存在的文件、客户、项目、金额、评分标准。
7. 如果没有找到高匹配文件，要说明未找到，并可以推荐相近文件。"""


class AgentService:
    """MVP 版 Agent：先检索 summary，再基于 evidence 组织回答。"""

    def _ai_score_files(self, query: str, related_files: List[dict]) -> List[dict]:
        """用 LLM 对每篇文件进行相关性评分（0-1）"""
        if not llm_service.is_configured():
            return related_files

        # 先取更多的候选，让 AI 挑
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
- 不要有任何其他文字
"""

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
                    file["score"] = scores[file_num]
                    file["original_retrieval_score"] = file.get("score")

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
        
        # 先检索多一点候选给 AI 评分
        tool_result = tool.run(query=query, top_k=min(top_k * 2, 20), retrieval_mode=retrieval_mode)
        evidence = tool_result["evidence"]
        related_files = tool_result["related_files"]
        
        # AI 评分重排
        related_files = self._ai_score_files(query, related_files)
        
        # 只返回 top_k
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
                "## 匹配结论\n"
                "当前没有找到高匹配的总结文档。\n\n"
                "## 推荐文件\n"
                "暂无可推荐文件。\n\n"
                "## 回答\n"
                "当前知识库里没有足够证据支撑结论，建议换个关键词再试，或先上传相关资料。\n\n"
                "## 注意\n"
                "当前系统只能基于原文件前 10 页生成的总结文档进行判断。"
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
                f"下面是从 HAIKb 总结文档索引中检索到的证据。注意：这些证据来自原文件前 10 页生成的 AI 总结文档，不是原文件全文。\n\n"
                f"{evidence_text}\n\n"
                f"推荐文件：\n{related_text}\n\n"
                "请基于证据回答用户问题。"
                "要求：1. 只基于证据回答，不要编造。"
                "2. 如果证据不足，请明确说明。"
                "3. 输出格式必须包含：匹配结论、推荐文件、回答、注意。"
            )
            try:
                return llm_service.chat(
                    [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.2,
                    max_tokens=1400,
                )
            except Exception:
                pass

        recommend_lines = "\n".join(
            f"- {item['original_name']}：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )
        return (
            "## 匹配结论\n"
            f"已从 AI 总结文档中找到 {len(related_files)} 份较相关文件，可用于回答“{query}”。\n\n"
            "## 推荐文件\n"
            f"{recommend_lines}\n\n"
            "## 回答\n"
            "系统已根据命中的总结文档整理出相关资料，优先建议先查看推荐文件的 AI 总结和原文件预览，再核对全文细节。\n\n"
            "## 注意\n"
            "当前判断仅基于原文件前 10 页生成的总结文档，如需核对全文细节，请打开原文件预览。"
        )


agent_service = AgentService()
