from __future__ import annotations

import json
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional

from app.database import SessionLocal
from app.models.agent_message import AgentMessage
from app.models.file import File
from app.models.user import User
from app.rag.index_manager import index_manager
from app.rag.tools import SummaryDocSearchTool
from app.services.folder_ai_preset_service import folder_ai_preset_service
from app.services.llm_service import llm_service
from app.services.preset_prompt_service import preset_prompt_service

def build_system_prompt(user_id: Optional[int] = None, scoped_user: Optional[User] = None) -> str:
    """Load the single user-facing Agent prompt managed from the admin UI.

    Directory knowledge is intentionally excluded here. It is matched through
    folder presets only when the user can see the corresponding directory.
    """
    return preset_prompt_service.get_agent_system_prompt()


class OptimizedAgentService:
    """优化的 Agent 服务，减少不必要的 LLM 调用。"""

    def __init__(self):
        pass

    def _attach_folder_ids(self, related_files: List[dict]) -> List[dict]:
        """为相关文件补齐 folder_id，供前端直接跳转到所属文件夹视图。"""
        if not related_files:
            return related_files

        file_ids = [item["file_id"] for item in related_files if item.get("file_id") is not None]
        if not file_ids:
            return related_files

        with SessionLocal() as db:
            folder_rows = (
                db.query(File.id, File.folder_id)
                .filter(File.id.in_(file_ids))
                .all()
            )

        folder_map = {file_id: folder_id for file_id, folder_id in folder_rows}
        for item in related_files:
            item["folder_id"] = folder_map.get(item["file_id"])
        return related_files

    def _ai_score_files(self, query: str, related_files: List[dict]) -> tuple[List[dict], dict]:
        """直接使用 LLM 评分所有文件。"""
        if not llm_service.is_configured():
            return related_files, {"used": False, "reason": "LLM 未配置，跳过文件重排。 "}

        if not related_files:
            return related_files, {"used": False, "reason": "没有候选文件，无需重排。"}

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
            return related_files, {
                "used": True,
                "prompt": {
                    "system": "你是一个严格按格式输出的评分助手。",
                    "user": prompt,
                },
                "response": response,
                "scored_count": len(scores),
            }

        except Exception:
            return related_files, {
                "used": False,
                "reason": "文件重排调用失败，已保留原始召回顺序。",
                "prompt": {
                    "system": "你是一个严格按格式输出的评分助手。",
                    "user": prompt,
                },
            }

        return related_files, {"used": False, "reason": "文件重排未执行。"}

    def chat(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        top_k: int = 8,
        retrieval_mode: str = "hybrid",
        user_id: Optional[int] = None,
        scoped_user: Optional[User] = None,
        override_department_name: Optional[str] = None,
        allowed_file_ids: Optional[List[int]] = None,
        visible_folder_ids: Optional[List[int]] = None,
        current_folder_id: Optional[int] = None,
    ) -> dict:
        if user_id is not None and allowed_file_ids is None:
            raise ValueError("Authenticated AI retrieval requires an explicit visible-file scope.")

        conv_id = conversation_id or str(uuid.uuid4())
        with SessionLocal() as db:
            preset_match = folder_ai_preset_service.match(
                db,
                query=query,
                visible_folder_ids=visible_folder_ids or [],
                current_folder_id=current_folder_id,
            )
        routing = {
            "route_mode": "folder_scope" if current_folder_id else "permission_scope",
            "intent_type": "folder_preset" if preset_match.matched else "knowledge_retrieval",
            "route_source": "folder_permissions",
            "target_library_names": [preset_match.folder_name] if preset_match.folder_name else [],
            "route_reason": preset_match.reason,
            "should_short_circuit": preset_match.matched,
            "preset_answer": preset_match.answer,
        }
        debug_trace = {
            "conversation_id": conv_id,
            "query": query,
            "scope": {
                "user_id": user_id,
                "override_department_name": override_department_name,
                "effective_department_name": (
                    scoped_user.root_department_name
                    or scoped_user.department_name
                    or None
                    if scoped_user
                    else None
                ),
                "current_folder_id": current_folder_id,
                "visible_folder_count": len(visible_folder_ids or []),
                "mode": "current_folder_subtree" if current_folder_id else "all_visible_folders",
            },
            "routing": {},
            "preset_match": preset_match.to_debug(),
            "stats": {
                "top_k": top_k,
                "retrieval_mode": retrieval_mode,
                "visible_file_count": len(allowed_file_ids or []),
            },
            "prompts": {},
            "model_trace": [],
        }

        if routing.get("should_short_circuit"):
            answer = routing.get("preset_answer") or "我已先帮你定位到更适合查看的知识库入口。"
            evidence: List[dict] = []
            related_files: List[dict] = []
            debug_trace["model_trace"].append(
                {
                    "stage": "preset_match",
                    "mode": preset_match.match_type,
                    "summary": preset_match.reason,
                }
            )
        else:
            index = index_manager.get_default_index()
            retriever = index.get_retriever_pipeline(settings={"retrieval_mode": retrieval_mode}, user_id=user_id)
            tool = SummaryDocSearchTool(retriever)
            # The authoritative AI scope is exactly the set of files the user
            # can currently view. Intent routing remains useful for debug and
            # answer context, but must not hard-limit retrieval to a guessed
            # folder because that can hide relevant documents.
            filters = (
                {"file_ids": sorted(set(allowed_file_ids))}
                if allowed_file_ids is not None
                else None
            )

            tool_result = tool.run(
                query=query,
                top_k=min(top_k * 2, 20),
                retrieval_mode=retrieval_mode,
                filters=filters,
            )
            evidence = tool_result["evidence"]
            related_files = tool_result["related_files"]
            debug_trace["stats"]["evidence_count"] = len(evidence)
            debug_trace["stats"]["candidate_file_count"] = len(related_files)
            debug_trace["model_trace"].append(
                {
                    "stage": "preset_match",
                    "mode": preset_match.match_type,
                    "summary": preset_match.reason,
                }
            )
            debug_trace["model_trace"].append(
                {
                    "stage": "retrieval",
                    "mode": "scoped" if filters else "full",
                    "summary": f'召回 {len(evidence)} 条证据，聚合出 {len(related_files)} 个候选文件。',
                }
            )

            related_files, rerank_debug = self._ai_score_files(query, related_files)
            related_files = self._attach_folder_ids(related_files[:top_k])
            debug_trace["prompts"]["rerank"] = rerank_debug.get("prompt")
            debug_trace["rerank"] = rerank_debug
            debug_trace["stats"]["reranked_file_count"] = len(related_files)
            debug_trace["model_trace"].append(
                {
                    "stage": "rerank",
                    "mode": "llm" if rerank_debug.get("used") else "fallback",
                    "summary": rerank_debug.get("reason")
                    or f'完成候选文件重排，保留前 {len(related_files)} 个文件。',
                }
            )

            answer, answer_debug = self._build_answer(
                query,
                evidence,
                related_files,
                routing,
                user_id=user_id,
                scoped_user=scoped_user,
            )
            debug_trace["prompts"]["answer"] = answer_debug.get("prompt")
            debug_trace["answer_debug"] = answer_debug
            debug_trace["model_trace"].append(
                {
                    "stage": "answer",
                    "mode": "llm" if answer_debug.get("used_llm") else "fallback",
                    "summary": answer_debug.get("summary") or "完成最终回答生成。",
                }
            )

        debug_trace["routing"] = self._build_routing_debug(routing)
        debug_trace["stats"]["related_file_count"] = len(related_files)
        debug_trace["stats"]["scoped_file_count"] = len(allowed_file_ids or [])

        with SessionLocal() as db:
            routing_metadata = dict(routing)
            routing_metadata.pop("target_file_ids", None)
            db.add(AgentMessage(conversation_id=conv_id, user_id=user_id, role="user", content=query))
            db.add(
                AgentMessage(
                    conversation_id=conv_id,
                    user_id=user_id,
                    role="assistant",
                    content=answer,
                    metadata_json=json.dumps(
                        {
                            "routing": routing_metadata,
                            "evidence": evidence,
                            "related_files": related_files,
                            "debug_trace": debug_trace,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            db.commit()

        return {
            "conversation_id": conv_id,
            "answer": answer,
            "evidence": evidence,
            "related_files": related_files,
            "routing": routing_metadata,
            "debug_trace": debug_trace,
        }

    def chat_stream(
        self,
        query: str,
        conversation_id: Optional[str] = None,
        top_k: int = 8,
        retrieval_mode: str = "hybrid",
        user_id: Optional[int] = None,
        scoped_user: Optional[User] = None,
        override_department_name: Optional[str] = None,
        allowed_file_ids: Optional[List[int]] = None,
        visible_folder_ids: Optional[List[int]] = None,
        current_folder_id: Optional[int] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Stream a preset answer immediately, or stream the RAG model after retrieval."""
        if user_id is not None and allowed_file_ids is None:
            raise ValueError("Authenticated AI retrieval requires an explicit visible-file scope.")

        conv_id = conversation_id or str(uuid.uuid4())
        started_at = time.perf_counter()
        with SessionLocal() as db:
            preset_match = folder_ai_preset_service.match(
                db,
                query=query,
                visible_folder_ids=visible_folder_ids or [],
                current_folder_id=current_folder_id,
            )

        routing = {
            "route_mode": "folder_scope" if current_folder_id else "permission_scope",
            "intent_type": "folder_preset" if preset_match.matched else "knowledge_retrieval",
            "route_source": "folder_permissions",
            "target_library_names": [preset_match.folder_name] if preset_match.folder_name else [],
            "route_reason": preset_match.reason,
        }
        debug_trace: Dict[str, Any] = {
            "conversation_id": conv_id,
            "query": query,
            "scope": {
                "user_id": user_id,
                "override_department_name": override_department_name,
                "effective_department_name": (
                    (scoped_user.root_department_name or scoped_user.department_name or None)
                    if scoped_user
                    else None
                ),
                "current_folder_id": current_folder_id,
                "visible_folder_count": len(visible_folder_ids or []),
                "mode": "current_folder_subtree" if current_folder_id else "all_visible_folders",
            },
            "routing": routing,
            "preset_match": preset_match.to_debug(),
            "stats": {
                "top_k": top_k,
                "retrieval_mode": retrieval_mode,
                "visible_file_count": len(allowed_file_ids or []),
                "scoped_file_count": len(allowed_file_ids or []),
            },
            "prompts": {},
            "model_trace": [
                {
                    "stage": "preset_match",
                    "mode": preset_match.match_type,
                    "summary": preset_match.reason,
                }
            ],
        }
        yield {"type": "start", "conversation_id": conv_id, "scope": debug_trace["scope"]}
        yield {"type": "preset_match", "preset_match": debug_trace["preset_match"]}

        evidence: List[dict] = []
        related_files: List[dict] = []
        answer = ""

        if preset_match.matched:
            answer = preset_match.answer or ""
            debug_trace["model_trace"].append(
                {
                    "stage": "answer",
                    "mode": "preset_direct",
                    "summary": "已直接返回管理员发布的预设答案；未调用回答模型改写。",
                }
            )
            for chunk in self._chunk_text(answer, 28):
                yield {"type": "answer_delta", "delta": chunk}
            yield {
                "type": "status",
                "stage": "retrieval",
                "message": "预设答案已返回，正在补充权限范围内的相关文件…",
            }
            evidence, related_files, retrieval_debug = self._retrieve_files(
                query=query,
                top_k=top_k,
                retrieval_mode=retrieval_mode,
                user_id=user_id,
                allowed_file_ids=allowed_file_ids,
                rerank=False,
            )
        else:
            yield {
                "type": "status",
                "stage": "retrieval",
                "message": "未命中高置信度预设，正在可见文件中检索…",
            }
            evidence, related_files, retrieval_debug = self._retrieve_files(
                query=query,
                top_k=top_k,
                retrieval_mode=retrieval_mode,
                user_id=user_id,
                allowed_file_ids=allowed_file_ids,
                rerank=True,
            )
            if not evidence:
                answer = "当前知识库里没有找到足够相关的文档，建议换个关键词再试，或先上传相关资料。"
                for chunk in self._chunk_text(answer, 28):
                    yield {"type": "answer_delta", "delta": chunk}
            elif llm_service.is_configured():
                system_prompt, user_prompt = self._build_answer_prompt(
                    query=query,
                    evidence=evidence,
                    related_files=related_files,
                )
                debug_trace["prompts"]["answer"] = {"system": system_prompt, "user": user_prompt}
                yield {
                    "type": "status",
                    "stage": "answer",
                    "message": "已完成检索，正在生成回答…",
                }
                try:
                    for delta in llm_service.chat_stream(
                        [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                        temperature=0.3,
                        max_tokens=2048,
                    ):
                        answer += delta
                        yield {"type": "answer_delta", "delta": delta}
                except Exception:
                    answer, answer_debug = self._build_answer(
                        query,
                        evidence,
                        related_files,
                        routing,
                        user_id=user_id,
                        scoped_user=scoped_user,
                    )
                    yield {"type": "answer_replace", "answer": answer}
                    debug_trace["answer_debug"] = answer_debug
            else:
                answer, answer_debug = self._build_answer(
                    query,
                    evidence,
                    related_files,
                    routing,
                    user_id=user_id,
                    scoped_user=scoped_user,
                )
                for chunk in self._chunk_text(answer, 28):
                    yield {"type": "answer_delta", "delta": chunk}
                debug_trace["answer_debug"] = answer_debug

            debug_trace["model_trace"].append(
                {
                    "stage": "answer",
                    "mode": "llm_stream" if llm_service.is_configured() and evidence else "fallback",
                    "summary": "检索完成后以流式方式输出回答。",
                }
            )

        debug_trace["retrieval"] = retrieval_debug
        debug_trace["stats"].update(
            {
                "evidence_count": len(evidence),
                "related_file_count": len(related_files),
                "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1),
            }
        )
        debug_trace["model_trace"].append(
            {
                "stage": "retrieval",
                "mode": retrieval_debug.get("mode"),
                "summary": retrieval_debug.get("summary"),
            }
        )

        self._persist_chat(
            conversation_id=conv_id,
            user_id=user_id,
            query=query,
            answer=answer,
            routing=routing,
            evidence=evidence,
            related_files=related_files,
            debug_trace=debug_trace,
        )
        yield {
            "type": "sources",
            "evidence": evidence,
            "related_files": related_files,
            "routing": routing,
            "debug_trace": debug_trace,
        }
        yield {"type": "done", "conversation_id": conv_id}

    def _retrieve_files(
        self,
        *,
        query: str,
        top_k: int,
        retrieval_mode: str,
        user_id: Optional[int],
        allowed_file_ids: Optional[List[int]],
        rerank: bool,
    ) -> tuple[List[dict], List[dict], Dict[str, Any]]:
        started_at = time.perf_counter()
        index = index_manager.get_default_index()
        retriever = index.get_retriever_pipeline(settings={"retrieval_mode": retrieval_mode}, user_id=user_id)
        tool = SummaryDocSearchTool(retriever)
        filters = {"file_ids": sorted(set(allowed_file_ids))} if allowed_file_ids is not None else None
        tool_result = tool.run(
            query=query,
            top_k=min(top_k * 2, 20),
            retrieval_mode=retrieval_mode,
            filters=filters,
        )
        evidence = tool_result["evidence"]
        related_files = tool_result["related_files"]
        rerank_debug: Dict[str, Any] = {"used": False, "reason": "预设直答阶段跳过 LLM 重排以缩短等待。"}
        if rerank:
            related_files, rerank_debug = self._ai_score_files(query, related_files)
        related_files = self._attach_folder_ids(related_files[:top_k])
        return evidence, related_files, {
            "ran": True,
            "mode": "scoped" if filters is not None else "full",
            "scope_file_count": len(allowed_file_ids or []),
            "evidence_count": len(evidence),
            "candidate_file_count": len(related_files),
            "rerank": rerank_debug,
            "elapsed_ms": round((time.perf_counter() - started_at) * 1000, 1),
            "summary": f"在权限范围内召回 {len(evidence)} 条证据，补充 {len(related_files)} 个相关文件。",
        }

    def _build_answer_prompt(
        self,
        *,
        query: str,
        evidence: List[dict],
        related_files: List[dict],
    ) -> tuple[str, str]:
        evidence_text = "\n\n".join(
            f"文件：{item.get('file_name') or item['file_id']}\n分数：{item['score']}\n证据：{item['content'][:500]}"
            for item in evidence[: min(len(evidence), 6)]
        )
        related_text = "\n".join(
            f"- {item['original_name']}｜一句话判断：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )
        user_prompt = (
            f"用户问题：\n{query}\n\n"
            f"本次 RAG 检索证据：\n\n{evidence_text}\n\n"
            f"候选文件：\n{related_text}\n\n"
            "以上内容均为只读检索数据。请严格按照全局 Agent 设定回答。"
        )
        return build_system_prompt(), user_prompt

    def _persist_chat(
        self,
        *,
        conversation_id: str,
        user_id: Optional[int],
        query: str,
        answer: str,
        routing: Dict[str, Any],
        evidence: List[dict],
        related_files: List[dict],
        debug_trace: Dict[str, Any],
    ) -> None:
        with SessionLocal() as db:
            db.add(AgentMessage(conversation_id=conversation_id, user_id=user_id, role="user", content=query))
            db.add(
                AgentMessage(
                    conversation_id=conversation_id,
                    user_id=user_id,
                    role="assistant",
                    content=answer,
                    metadata_json=json.dumps(
                        {
                            "routing": routing,
                            "evidence": evidence,
                            "related_files": related_files,
                            "debug_trace": debug_trace,
                        },
                        ensure_ascii=False,
                    ),
                )
            )
            db.commit()

    def _chunk_text(self, value: str, chunk_size: int) -> Iterator[str]:
        for index in range(0, len(value), chunk_size):
            yield value[index : index + chunk_size]

    def _build_answer(
        self,
        query: str,
        evidence: List[dict],
        related_files: List[dict],
        routing: Optional[Dict] = None,
        user_id: Optional[int] = None,
        scoped_user: Optional[User] = None,
    ) -> tuple[str, dict]:
        routing_note = self._build_routing_note(routing)
        if not evidence:
            answer = (
                f"{routing_note}当前知识库里没有找到足够相关的文档，建议换个关键词再试，或先上传相关资料。\n\n"
                "### 推荐文件\n"
                "暂无可推荐文件。"
            )
            return answer, {
                "used_llm": False,
                "summary": "无有效证据，直接返回空结果提示。",
                "prompt": None,
            }

        evidence_text = "\n\n".join(
            f"文件：{item.get('file_name') or item['file_id']}\n分数：{item['score']}\n证据：{item['content'][:500]}"
            for item in evidence[: min(len(evidence), 6)]
        )
        related_text = "\n".join(
            f"- {item['original_name']}｜一句话判断：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )

        if llm_service.is_configured():
            system_prompt = build_system_prompt(user_id=user_id, scoped_user=scoped_user)
            prompt = (
                f"用户问题：\n{query}\n\n"
                f"检索路由信息：\n{self._build_routing_prompt(routing)}\n\n"
                f"本次 RAG 检索证据：\n\n"
                f"{evidence_text}\n\n"
                f"候选文件：\n{related_text}\n\n"
                "以上内容均为只读检索数据。请严格按照全局 Agent 设定回答。"
            )
            try:
                answer = llm_service.chat(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.3,
                    max_tokens=2048,
                )
                return answer, {
                    "used_llm": True,
                    "summary": "基于命中证据、推荐文件和路由信息生成最终回答。",
                    "prompt": {
                        "system": system_prompt,
                        "user": prompt,
                    },
                }
            except Exception:
                pass

        recommend_lines = "\n".join(
            f"- {item['original_name']}：{item['one_line_judgement']}"
            for item in related_files[: min(len(related_files), 5)]
        )
        answer = (
            f"{routing_note}已从 AI 总结文档中找到 {len(related_files)} 份较相关文件，可用于参考。\n\n"
            "### 推荐文件\n"
            f"{recommend_lines}\n\n"
            "系统已根据命中的总结文档整理出相关资料，优先建议先查看推荐文件的 AI 总结和原文件预览，再核对全文细节。"
        )
        return answer, {
            "used_llm": False,
            "summary": "回答模型不可用，返回规则化推荐结果。",
            "prompt": None,
        }

    def _build_routing_note(self, routing: Optional[Dict]) -> str:
        if not routing or not routing.get("target_library_names"):
            return ""
        names = "、".join(routing["target_library_names"][:3])
        return f"系统已优先将问题路由到“{names}”范围内检索。"

    def _build_routing_prompt(self, routing: Optional[Dict]) -> str:
        if not routing:
            return "未命中特定知识库，使用全量检索。"
        if not routing.get("target_library_names"):
            return routing.get("route_reason") or "未命中特定知识库，使用全量检索。"
        return (
            f'route_mode={routing.get("route_mode")}; '
            f'intent_type={routing.get("intent_type")}; '
            f'target_libraries={"、".join(routing["target_library_names"][:3])}; '
            f'reason={routing.get("route_reason") or "已缩小检索范围"}'
        )

    def _build_routing_debug(self, routing: Optional[Dict]) -> Dict:
        if not routing:
            return {}
        debug = dict(routing)
        debug.pop("target_file_ids", None)
        return debug


agent_service = OptimizedAgentService()
