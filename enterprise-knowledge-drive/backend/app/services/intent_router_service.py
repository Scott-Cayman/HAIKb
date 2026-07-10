from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.file import File
from app.models.folder import Folder
from app.models.folder_summary import FolderSummary
from app.models.user import User
from app.services.folder_access import can_view_folder
from app.services.llm_service import llm_service

LIBRARY_PRESETS = [
    {
        "intent_type": "proposal_library",
        "display_name": "方案库",
        "aliases": ["方案", "方案库", "投标", "标书", "案例", "提案", "项目方案", "投标方案"],
    },
    {
        "intent_type": "design_library",
        "display_name": "设计员文件库",
        "aliases": ["设计", "设计员", "创意", "视觉", "海报", "排版", "创意文件", "设计资料"],
    },
    {
        "intent_type": "onboarding_library",
        "display_name": "新人知识库",
        "aliases": ["新人", "入职", "培训", "上手", "适应", "手册", "新人知识库", "入门"],
    },
    {
        "intent_type": "operations_library",
        "display_name": "运营知识库",
        "aliases": ["报销", "考勤", "行政", "财务", "流程", "制度", "运营", "审批"],
    },
]

NAVIGATION_PHRASES = [
    "找什么",
    "去哪找",
    "在哪里",
    "在哪看",
    "看什么",
    "看哪里",
    "去哪看",
    "资料在哪",
    "怎么找",
]

GENERIC_QUERY_TERMS = {
    "找",
    "找什么",
    "什么",
    "哪里",
    "在哪",
    "在哪里",
    "看什么",
    "看哪里",
    "资料",
    "文件",
    "内容",
}


class IntentRouterService:
    """在进入 RAG 前先判断问题该优先落到哪些知识库。"""

    def route(self, query: str, user_id: Optional[int], user_context: Optional[User] = None) -> dict:
        if not user_id and not user_context:
            return self._default_route(query)

        query = (query or "").strip()
        if not query:
            return self._default_route(query)

        with SessionLocal() as db:
            user = user_context
            if user is None and user_id:
                user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
            if not user:
                return self._default_route(query)

            preset = self._match_preset(query)
            root_folders = self._list_accessible_root_folders(db, user)
            summary_map = self._load_folder_summaries(db, root_folders)
            scored_folders = self._score_root_folders(query, root_folders, summary_map, preset)
            selected_folders = self._pick_target_folders(scored_folders)
            route_source = "rules"
            llm_route_debug = None

            if self._should_try_llm_router(selected_folders):
                llm_selection, llm_route_debug = self._route_with_llm(query, root_folders, summary_map)
                if llm_selection:
                    selected_folders = llm_selection
                    route_source = "llm"

            if not selected_folders:
                return self._default_route(query)

            target_root_ids = [item["folder_id"] for item in selected_folders]
            target_folder_ids = self._collect_descendant_folder_ids(db, target_root_ids)
            target_file_ids = self._collect_file_ids(db, target_folder_ids)
            target_library_names = [item["folder_name"] for item in selected_folders]
            route_mode = "scoped_retrieval"
            preset_answer = None

            if self._is_navigation_query(query, preset):
                route_mode = "preset_navigation"
                preset_answer = self._build_preset_answer(query, target_library_names)

            return {
                "query": query,
                "intent_type": (preset or {}).get("intent_type") or "scoped_search",
                "route_mode": route_mode,
                "target_library_names": target_library_names,
                "target_root_folder_ids": target_root_ids,
                "target_folder_ids": target_folder_ids,
                "target_file_ids": target_file_ids,
                "scoped_file_count": len(target_file_ids),
                "should_short_circuit": route_mode == "preset_navigation" and self._should_short_circuit(query),
                "preset_answer": preset_answer,
                "route_reason": self._build_route_reason(selected_folders, preset, route_source, llm_route_debug),
                "route_source": route_source,
                "llm_route_debug": llm_route_debug,
                "matched_folders": [
                    {
                        "folder_id": item["folder_id"],
                        "folder_name": item["folder_name"],
                        "score": item["score"],
                    }
                    for item in selected_folders
                ],
            }

    def _default_route(self, query: str) -> dict:
        return {
            "query": query,
            "intent_type": "full_search",
            "route_mode": "full_retrieval",
            "target_library_names": [],
            "target_root_folder_ids": [],
            "target_folder_ids": [],
            "target_file_ids": [],
            "scoped_file_count": 0,
            "should_short_circuit": False,
            "preset_answer": None,
            "route_reason": "未命中明确知识库，保持全量检索。",
            "matched_folders": [],
        }

    def _list_accessible_root_folders(self, db: Session, user: User) -> List[Folder]:
        folders = (
            db.query(Folder)
            .filter(Folder.parent_id == None, Folder.is_deleted == False)
            .order_by(Folder.sort_order.asc(), Folder.id.asc())
            .all()
        )
        return [folder for folder in folders if can_view_folder(db, folder, user)]

    def _load_folder_summaries(self, db: Session, folders: List[Folder]) -> Dict[int, FolderSummary]:
        if not folders:
            return {}
        summary_rows = (
            db.query(FolderSummary)
            .filter(
                FolderSummary.folder_id.in_([folder.id for folder in folders]),
                FolderSummary.is_deleted == False,
            )
            .all()
        )
        return {row.folder_id: row for row in summary_rows}

    def _score_root_folders(
        self,
        query: str,
        folders: List[Folder],
        summary_map: Dict[int, FolderSummary],
        preset: Optional[dict],
    ) -> List[dict]:
        if not folders:
            return []

        query_terms = self._extract_query_terms(query)
        scored: List[dict] = []

        for folder in folders:
            summary = summary_map.get(folder.id)
            score, reasons = self._score_folder(folder, summary, query_terms, preset)
            if score <= 0:
                continue
            scored.append(
                {
                    "folder_id": folder.id,
                    "folder_name": folder.name,
                    "score": round(score, 4),
                    "reasons": reasons,
                }
            )

        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored

    def _score_folder(
        self,
        folder: Folder,
        summary: Optional[FolderSummary],
        query_terms: List[str],
        preset: Optional[dict],
    ) -> Tuple[float, List[str]]:
        score = 0.0
        reasons: List[str] = []

        name_text = (folder.name or "").lower()
        desc_text = (folder.description or "").lower()
        summary_text = (summary.summary_markdown or "").lower() if summary else ""

        if preset:
            for alias in preset["aliases"]:
                alias = alias.lower()
                if alias in name_text:
                    score += 4.0
                    reasons.append(f"文件夹名命中“{alias}”")
                elif alias in desc_text:
                    score += 2.5
                    reasons.append(f"文件夹描述命中“{alias}”")
                elif alias in summary_text:
                    score += 2.0
                    reasons.append(f"文件夹总结命中“{alias}”")

        for term in query_terms:
            if term in name_text:
                score += 1.4
            elif term in desc_text:
                score += 0.8
            elif term in summary_text:
                score += 0.6

        return score, reasons

    def _should_try_llm_router(self, selected_folders: List[dict]) -> bool:
        if not llm_service.is_configured():
            return False
        if not selected_folders:
            return True
        if len(selected_folders) == 1 and selected_folders[0]["score"] >= 3.5:
            return False
        if len(selected_folders) >= 2:
            gap = selected_folders[0]["score"] - selected_folders[1]["score"]
            return gap < 1.0
        return selected_folders[0]["score"] < 3.5

    def _pick_target_folders(self, scored_folders: List[dict]) -> List[dict]:
        if not scored_folders:
            return []

        top_score = scored_folders[0]["score"]
        if top_score < 1.5:
            return []

        selected: List[dict] = []
        for item in scored_folders[:3]:
            if item["score"] >= max(top_score - 1.2, 1.5):
                selected.append(item)
        return selected

    def _route_with_llm(
        self,
        query: str,
        folders: List[Folder],
        summary_map: Dict[int, FolderSummary],
    ) -> Tuple[List[dict], Optional[dict]]:
        folder_cards: List[str] = []
        folder_lookup: Dict[int, Folder] = {folder.id: folder for folder in folders}

        for folder in folders[:8]:
            summary = summary_map.get(folder.id)
            summary_text = (summary.summary_markdown or "") if summary else ""
            summary_excerpt = summary_text[:500].replace("\n", " ")
            folder_cards.append(
                f"文件夹ID: {folder.id}\n"
                f"名称: {folder.name}\n"
                f"描述: {folder.description or '暂无'}\n"
                f"总结摘要: {summary_excerpt or '暂无总结'}"
            )

        router_prompt = (
            "你是企业知识库的路由助手，只负责判断用户问题应该优先加载哪些知识库文件夹，不直接回答问题。\n"
            "请从候选文件夹中选择最相关的 1 到 3 个文件夹。\n"
            "输出 JSON，格式如下：\n"
            '{"folder_ids":[1,2],"reason":"...", "intent_type":"..."}\n'
            "要求：\n"
            "1. 只输出 JSON。\n"
            "2. 如果不确定，也要尽量给出最可能的 folder_ids。\n"
            "3. 不要编造不存在的文件夹ID。"
        )
        user_prompt = f"用户问题：{query}\n\n候选文件夹：\n\n" + "\n\n---\n\n".join(folder_cards)

        try:
            response = llm_service.chat(
                [
                    {"role": "system", "content": router_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=400,
            )
            parsed = self._parse_llm_route_response(response)
            folder_ids = [folder_id for folder_id in parsed.get("folder_ids", []) if folder_id in folder_lookup]
            if not folder_ids:
                return [], {
                    "used": True,
                    "prompt": {"system": router_prompt, "user": user_prompt},
                    "response": response,
                    "reason": "AI 选库未返回有效文件夹。",
                }

            selected = [
                {
                    "folder_id": folder_id,
                    "folder_name": folder_lookup[folder_id].name,
                    "score": round(3.2 - index * 0.2, 4),
                    "reasons": [parsed.get("reason") or "AI 判断该文件夹更相关"],
                }
                for index, folder_id in enumerate(folder_ids[:3])
            ]
            return selected, {
                "used": True,
                "prompt": {"system": router_prompt, "user": user_prompt},
                "response": response,
                "reason": parsed.get("reason") or "AI 判断这些知识库与问题更匹配。",
                "intent_type": parsed.get("intent_type") or "llm_scoped_search",
            }
        except Exception as exc:
            return [], {
                "used": True,
                "prompt": {"system": router_prompt, "user": user_prompt},
                "response": "",
                "reason": f"AI 选库失败，回退规则路由：{exc}",
            }

    def _parse_llm_route_response(self, response: str) -> dict:
        import json

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", response)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass
        return {"folder_ids": []}

    def _collect_descendant_folder_ids(self, db: Session, root_folder_ids: List[int]) -> List[int]:
        queue = list(root_folder_ids)
        visited = set()
        collected: List[int] = []

        while queue:
            folder_id = queue.pop(0)
            if folder_id in visited:
                continue
            visited.add(folder_id)
            collected.append(folder_id)

            child_rows = (
                db.query(Folder.id)
                .filter(Folder.parent_id == folder_id, Folder.is_deleted == False)
                .all()
            )
            queue.extend([row[0] for row in child_rows])

        return collected

    def _collect_file_ids(self, db: Session, folder_ids: List[int]) -> List[int]:
        if not folder_ids:
            return []

        rows = (
            db.query(File.id)
            .filter(File.folder_id.in_(folder_ids), File.is_deleted == False)
            .all()
        )
        return [row[0] for row in rows]

    def _match_preset(self, query: str) -> Optional[dict]:
        query_text = query.lower()
        scored: List[Tuple[int, dict]] = []

        for preset in LIBRARY_PRESETS:
            hits = sum(1 for alias in preset["aliases"] if alias.lower() in query_text)
            if hits:
                scored.append((hits, preset))

        if not scored:
            return None

        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[0][1]

    def _is_navigation_query(self, query: str, preset: Optional[dict]) -> bool:
        query_text = query.lower()
        if any(phrase in query_text for phrase in NAVIGATION_PHRASES):
            return True
        if preset and len(query_text) <= 12:
            return True
        return False

    def _should_short_circuit(self, query: str) -> bool:
        terms = [term for term in self._extract_query_terms(query) if term not in GENERIC_QUERY_TERMS]
        return len(terms) <= 2 and len(query) <= 16

    def _build_preset_answer(self, query: str, target_library_names: List[str]) -> str:
        library_text = "、".join(target_library_names[:3]) if target_library_names else "对应知识库"
        return (
            f'你这个问题更适合先从“{library_text}”进入查看，我已优先把检索范围缩小到相关资料。'
            "如果你愿意，可以继续补充行业、客户类型、项目场景或文件类型，我再给你更精确的文件推荐。"
        )

    def _build_route_reason(
        self,
        selected_folders: List[dict],
        preset: Optional[dict],
        route_source: str,
        llm_route_debug: Optional[dict],
    ) -> str:
        folder_names = "、".join(item["folder_name"] for item in selected_folders[:3])
        if route_source == "llm":
            return llm_route_debug.get("reason") if llm_route_debug else f"AI 选库后优先路由到：{folder_names}。"
        if preset:
            return f'问题先命中“{preset["display_name"]}”意图，优先路由到：{folder_names}。'
        return f"根据文件夹名称与文件夹总结命中情况，优先路由到：{folder_names}。"

    def _extract_query_terms(self, query: str) -> List[str]:
        query_text = (query or "").strip().lower()
        if not query_text:
            return []

        terms = set(re.findall(r"[a-z0-9_]{2,}", query_text))
        chinese_parts = re.findall(r"[\u4e00-\u9fff]{2,}", query_text)
        for part in chinese_parts:
            terms.add(part)
            if len(part) <= 8:
                for width in (2, 3):
                    if len(part) >= width:
                        for index in range(len(part) - width + 1):
                            terms.add(part[index : index + width])

        return sorted(
            [term for term in terms if term and term not in GENERIC_QUERY_TERMS],
            key=len,
            reverse=True,
        )[:20]


intent_router_service = IntentRouterService()
