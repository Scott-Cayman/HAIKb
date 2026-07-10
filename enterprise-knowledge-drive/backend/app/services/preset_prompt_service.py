from __future__ import annotations

import json
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from app.database import SessionLocal
from app.models.user import User
from app.services.llm_service import llm_service


PRESET_PROMPTS_DIR = Path(__file__).parent / "preset_prompts"
PRESET_PROMPTS_GLOBAL_DIR = PRESET_PROMPTS_DIR / "global"
PRESET_PROMPTS_DEPARTMENT_DIR = PRESET_PROMPTS_DIR / "departments"
PRESET_PROMPTS_MANIFEST_PATH = PRESET_PROMPTS_DIR / "manifest.json"
PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH = PRESET_PROMPTS_DIR / "suggested_questions_cache.json"
LEGACY_OPERATIONS_GUIDE_PATH = Path(__file__).parent / "company_operations_guide.md"

DEFAULT_GLOBAL_RELATIVE_PATH = "global/group_default_preset_questions.md"
DEFAULT_CROSS_MARKETING_RELATIVE_PATH = "departments/cross_marketing_center_preset_questions.md"

DEFAULT_GLOBAL_CONTENT = """# 全集团统一预设问题

本文件用于沉淀全集团统一适用的 AI 回复规则、制度口径和业务提示词。

## 使用说明

1. 仅收录适用于全集团的统一规则。
2. 各部门、事业部的差异化规则，请维护在对应部门文件中。
3. 如果同一主题存在部门特殊规则，回答时应优先遵循部门文件，再补充全集团统一规则。
"""

DEFAULT_MANIFEST = [
    {
        "id": "group-default",
        "name": "全集团统一预设问题",
        "scope_type": "global",
        "department_name": None,
        "relative_path": DEFAULT_GLOBAL_RELATIVE_PATH,
        "description": "适用于全集团的统一提示词和通用规则。",
        "sort_order": 10,
    },
    {
        "id": "cross-marketing-center",
        "name": "跨界营销中心预设问题",
        "scope_type": "department",
        "department_name": "跨界营销中心",
        "relative_path": DEFAULT_CROSS_MARKETING_RELATIVE_PATH,
        "description": "跨界营销中心专属的运营指南与常见问题。",
        "sort_order": 20,
    },
]


class PresetPromptService:
    """管理全集团与部门级预设问题文件。"""

    def __init__(self) -> None:
        self._ensure_storage()

    def _ensure_storage(self) -> None:
        PRESET_PROMPTS_GLOBAL_DIR.mkdir(parents=True, exist_ok=True)
        PRESET_PROMPTS_DEPARTMENT_DIR.mkdir(parents=True, exist_ok=True)

        global_path = PRESET_PROMPTS_DIR / DEFAULT_GLOBAL_RELATIVE_PATH
        if not global_path.exists():
            global_path.write_text(DEFAULT_GLOBAL_CONTENT, encoding="utf-8")

        dept_path = PRESET_PROMPTS_DIR / DEFAULT_CROSS_MARKETING_RELATIVE_PATH
        if not dept_path.exists() and LEGACY_OPERATIONS_GUIDE_PATH.exists():
            dept_path.write_text(LEGACY_OPERATIONS_GUIDE_PATH.read_text(encoding="utf-8"), encoding="utf-8")

        if not PRESET_PROMPTS_MANIFEST_PATH.exists():
            self._write_manifest(DEFAULT_MANIFEST)
            return

        manifest = self._read_manifest()
        manifest_changed = False
        existing_ids = {item.get("id") for item in manifest}

        for default_item in DEFAULT_MANIFEST:
            if default_item["id"] in existing_ids:
                continue
            manifest.append(default_item)
            manifest_changed = True

        if manifest_changed:
            self._write_manifest(manifest)

        if not PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH.exists():
            PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH.write_text("{}\n", encoding="utf-8")

    def _read_manifest(self) -> List[Dict[str, Any]]:
        if not PRESET_PROMPTS_MANIFEST_PATH.exists():
            return [dict(item) for item in DEFAULT_MANIFEST]
        raw = json.loads(PRESET_PROMPTS_MANIFEST_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            raise ValueError("预设问题配置文件格式不正确")
        normalized: List[Dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "id": str(item.get("id") or "").strip(),
                    "name": str(item.get("name") or "").strip(),
                    "scope_type": str(item.get("scope_type") or "department").strip(),
                    "department_name": (str(item.get("department_name")).strip() if item.get("department_name") else None),
                    "relative_path": str(item.get("relative_path") or "").strip(),
                    "description": (str(item.get("description")).strip() if item.get("description") else None),
                    "sort_order": int(item.get("sort_order") or 999),
                }
            )
        normalized.sort(key=lambda item: (item["sort_order"], item["name"], item["id"]))
        return normalized

    def _write_manifest(self, items: List[Dict[str, Any]]) -> None:
        ordered = sorted(items, key=lambda item: (int(item.get("sort_order") or 999), item.get("name") or "", item.get("id") or ""))
        PRESET_PROMPTS_MANIFEST_PATH.write_text(
            json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _resolve_content_path(self, relative_path: str) -> Path:
        path = (PRESET_PROMPTS_DIR / relative_path).resolve()
        if PRESET_PROMPTS_DIR.resolve() not in path.parents and path != PRESET_PROMPTS_DIR.resolve():
            raise ValueError("预设问题文件路径不合法")
        return path

    def _file_updated_at(self, path: Path) -> Optional[datetime]:
        if not path.exists():
            return None
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)

    def _managed_department_name(self, user: Optional[User]) -> Optional[str]:
        if not user:
            return None
        if user.root_department_name:
            return user.root_department_name.strip()
        if user.full_department_path:
            return user.full_department_path.split("/")[0].strip()
        if user.department_name:
            return user.department_name.strip()
        return None

    def _can_edit_preset(self, user: User, item: Dict[str, Any]) -> bool:
        if user.is_super_admin:
            return True
        if not user.is_admin:
            return False
        if item.get("scope_type") != "department":
            return False
        managed_department = self._managed_department_name(user)
        return bool(managed_department and managed_department == item.get("department_name"))

    def _can_view_preset(self, user: User, item: Dict[str, Any]) -> bool:
        return bool(user.is_admin or user.is_super_admin)

    def _serialize_item(self, user: User, item: Dict[str, Any]) -> Dict[str, Any]:
        path = self._resolve_content_path(item["relative_path"])
        return {
            "id": item["id"],
            "name": item["name"],
            "scope_type": item["scope_type"],
            "department_name": item.get("department_name"),
            "relative_path": item["relative_path"],
            "description": item.get("description"),
            "sort_order": item.get("sort_order", 999),
            "updated_at": self._file_updated_at(path),
            "can_edit": self._can_edit_preset(user, item),
        }

    def list_presets(self, user: User) -> List[Dict[str, Any]]:
        items = self._read_manifest()
        return [self._serialize_item(user, item) for item in items if self._can_view_preset(user, item)]

    def get_preset(self, preset_id: str, user: User) -> Dict[str, Any]:
        item = self._get_manifest_item(preset_id)
        if not self._can_view_preset(user, item):
            raise PermissionError("没有权限查看该预设问题")
        path = self._resolve_content_path(item["relative_path"])
        content = path.read_text(encoding="utf-8") if path.exists() else ""
        payload = self._serialize_item(user, item)
        payload["content"] = content
        return payload

    def create_preset(
        self,
        *,
        user: User,
        name: str,
        scope_type: str,
        content: str,
        department_name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        normalized_scope = (scope_type or "").strip()
        normalized_name = (name or "").strip()
        normalized_content = self._normalize_content(content)
        normalized_description = description.strip() if description else None

        if normalized_scope not in {"global", "department"}:
            raise ValueError("scope_type 仅支持 global 或 department")
        if not normalized_name:
            raise ValueError("名称不能为空")
        if not normalized_content.strip():
            raise ValueError("预设问题内容不能为空")

        if normalized_scope == "global":
            if not user.is_super_admin:
                raise PermissionError("只有超级管理员可以新增全集团预设问题")
            final_department = None
        else:
            if user.is_super_admin:
                final_department = (department_name or "").strip()
                if not final_department:
                    raise ValueError("部门预设问题必须填写 department_name")
            else:
                final_department = self._managed_department_name(user)
                if not final_department:
                    raise ValueError("当前管理员未绑定部门，无法新增部门预设问题")

        manifest = self._read_manifest()
        new_id = self._build_unique_id(manifest, normalized_scope, final_department, normalized_name)
        relative_path = self._build_relative_path(manifest, normalized_scope, final_department, normalized_name)
        content_path = self._resolve_content_path(relative_path)
        content_path.parent.mkdir(parents=True, exist_ok=True)
        content_path.write_text(normalized_content, encoding="utf-8")

        next_sort_order = max([int(item.get("sort_order") or 0) for item in manifest] + [0]) + 10
        item = {
            "id": new_id,
            "name": normalized_name,
            "scope_type": normalized_scope,
            "department_name": final_department,
            "relative_path": relative_path,
            "description": normalized_description,
            "sort_order": next_sort_order,
        }
        manifest.append(item)
        self._write_manifest(manifest)
        return self.get_preset(new_id, user)

    def update_preset(
        self,
        *,
        preset_id: str,
        user: User,
        name: Optional[str] = None,
        content: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        manifest = self._read_manifest()
        item = next((row for row in manifest if row["id"] == preset_id), None)
        if not item:
            raise FileNotFoundError("预设问题不存在")
        if not self._can_edit_preset(user, item):
            raise PermissionError("没有权限编辑该预设问题")

        changed = False
        if name is not None:
            normalized_name = name.strip()
            if not normalized_name:
                raise ValueError("名称不能为空")
            item["name"] = normalized_name
            changed = True

        if description is not None:
            item["description"] = description.strip() or None
            changed = True

        if content is not None:
            normalized_content = self._normalize_content(content)
            if not normalized_content.strip():
                raise ValueError("预设问题内容不能为空")
            path = self._resolve_content_path(item["relative_path"])
            path.write_text(normalized_content, encoding="utf-8")

        if changed:
            self._write_manifest(manifest)

        return self.get_preset(preset_id, user)

    def build_prompt_context_for_user_id(self, user_id: Optional[int]) -> str:
        if not user_id:
            return self.build_prompt_context_for_user(None)
        with SessionLocal() as db:
            user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        return self.build_prompt_context_for_user(user)

    def build_prompt_context_for_user(self, user: Optional[User]) -> str:
        items = self._read_manifest()
        managed_department = self._managed_department_name(user)
        sections: List[str] = []

        for item in items:
            scope_type = item.get("scope_type")
            if scope_type == "global":
                pass
            elif scope_type == "department":
                if not managed_department or managed_department != item.get("department_name"):
                    continue
            else:
                continue

            path = self._resolve_content_path(item["relative_path"])
            if not path.exists():
                continue
            content = path.read_text(encoding="utf-8").strip()
            if not content:
                continue

            scope_text = "全集团" if scope_type == "global" else f"部门：{item.get('department_name')}"
            sections.append(f"### {item['name']}（{scope_text}）\n\n{content}")

        return "\n\n---\n\n".join(sections)

    def get_suggested_questions_for_user(self, user: Optional[User], limit: int = 12) -> List[str]:
        applicable_items = self._get_applicable_items_for_user(user)
        department_titles: List[str] = []
        fallback_titles: List[str] = []
        cache_materials: List[Dict[str, str]] = []

        for item in applicable_items:
            path = self._resolve_content_path(item["relative_path"])
            if not path.exists():
                continue
            content = path.read_text(encoding="utf-8")
            cache_materials.append(
                {
                    "relative_path": item["relative_path"],
                    "scope_type": str(item.get("scope_type") or ""),
                    "department_name": str(item.get("department_name") or ""),
                    "content": content,
                }
            )
            extracted = self._extract_question_titles(content)
            if item.get("scope_type") == "department":
                department_titles.extend(extracted)
            else:
                fallback_titles.extend(extracted)

        suggestions = self._unique_preserve_order(department_titles + fallback_titles)
        cache_key = self._build_suggestions_cache_key(user)
        cache_signature = self._build_suggestions_signature(cache_materials)
        cached_questions = self._read_cached_suggestions(cache_key, cache_signature)
        if cached_questions:
            merged = self._unique_preserve_order(suggestions + cached_questions)
            return merged[: max(1, limit)]

        ai_suggestions = self._generate_ai_questions(
            department_name=self._managed_department_name(user),
            seed_questions=suggestions,
            limit=max(4, min(limit, 6)),
        )
        merged = self._unique_preserve_order(suggestions + ai_suggestions)
        self._write_cached_suggestions(cache_key, cache_signature, ai_suggestions)
        return merged[: max(1, limit)]

    def _get_manifest_item(self, preset_id: str) -> Dict[str, Any]:
        item = next((row for row in self._read_manifest() if row["id"] == preset_id), None)
        if not item:
            raise FileNotFoundError("预设问题不存在")
        return item

    def _get_applicable_items_for_user(self, user: Optional[User]) -> List[Dict[str, Any]]:
        items = self._read_manifest()
        managed_department = self._managed_department_name(user)
        applicable: List[Dict[str, Any]] = []
        for item in items:
            scope_type = item.get("scope_type")
            if scope_type == "global":
                applicable.append(item)
                continue
            if scope_type == "department" and managed_department and managed_department == item.get("department_name"):
                applicable.append(item)
        return applicable

    def _extract_question_titles(self, content: str) -> List[str]:
        lines = (content or "").splitlines()
        titles: List[str] = []
        for line in lines:
            stripped = line.strip()
            if not stripped.startswith("#"):
                continue
            match = re.match(r"^(#{2,6})\s+(.*)$", stripped)
            if not match:
                continue
            level = len(match.group(1))
            title = re.sub(r"\s+", " ", match.group(2).strip())
            if not title or title in {"AI 回答规则（必须遵守）", "使用说明", "待扩充知识点（暂无标准答案）"}:
                continue
            if level >= 3:
                titles.append(title)
        return self._unique_preserve_order(titles)

    def _generate_ai_questions(
        self,
        *,
        department_name: Optional[str],
        seed_questions: Sequence[str],
        limit: int,
    ) -> List[str]:
        if not llm_service.is_configured():
            return []

        visible_seed_questions = list(seed_questions[:10])
        department_text = department_name or "全集团"
        try:
            response = llm_service.chat(
                [
                    {
                        "role": "system",
                        "content": (
                            "你是企业知识库首页的提示问题生成助手。"
                            "请根据给定部门和已有题目，生成适合点击检索的简短中文问题。"
                            "只输出 JSON 数组，数组元素必须是字符串，不要输出任何额外文字。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"当前部门：{department_text}\n"
                            f"已有题目：{json.dumps(visible_seed_questions, ensure_ascii=False)}\n"
                            f"请生成 {limit} 个新的“猜你想问”问题，要求：\n"
                            "1. 长度控制在 6 到 16 个字。\n"
                            "2. 风格像员工会直接点的问题。\n"
                            "3. 尽量覆盖制度、流程、协作、业务技能等主题。\n"
                            "4. 不要与已有题目重复。\n"
                        ),
                    },
                ],
                temperature=0.8,
                max_tokens=220,
            )
        except Exception:
            return []

        parsed = self._parse_llm_question_array(response)
        return [item for item in parsed if item not in visible_seed_questions][:limit]

    def _read_suggestions_cache(self) -> Dict[str, Dict[str, Any]]:
        if not PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH.exists():
            return {}
        try:
            raw = json.loads(PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        if not isinstance(raw, dict):
            return {}
        cache: Dict[str, Dict[str, Any]] = {}
        for key, value in raw.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            cache[key] = value
        return cache

    def _write_suggestions_cache(self, cache: Dict[str, Dict[str, Any]]) -> None:
        PRESET_PROMPTS_SUGGESTIONS_CACHE_PATH.write_text(
            json.dumps(cache, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _build_suggestions_cache_key(self, user: Optional[User]) -> str:
        department_name = self._managed_department_name(user)
        return department_name or "__global__"

    def _build_suggestions_signature(self, materials: Sequence[Dict[str, str]]) -> str:
        payload = [
            {
                "relative_path": item["relative_path"],
                "scope_type": item["scope_type"],
                "department_name": item["department_name"],
                "content_hash": hashlib.sha256(item["content"].encode("utf-8")).hexdigest(),
            }
            for item in materials
        ]
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(serialized.encode("utf-8")).hexdigest()

    def _read_cached_suggestions(self, cache_key: str, signature: str) -> List[str]:
        cache = self._read_suggestions_cache()
        entry = cache.get(cache_key)
        if not entry or entry.get("signature") != signature:
            return []
        questions = entry.get("questions")
        if not isinstance(questions, list):
            return []
        return self._sanitize_question_list(questions)

    def _write_cached_suggestions(self, cache_key: str, signature: str, questions: Sequence[str]) -> None:
        cache = self._read_suggestions_cache()
        cache[cache_key] = {
            "signature": signature,
            "questions": self._sanitize_question_list(questions),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._write_suggestions_cache(cache)

    def _parse_llm_question_array(self, raw: str) -> List[str]:
        text = (raw or "").strip()
        if not text:
            return []

        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return self._sanitize_question_list(parsed)
        except json.JSONDecodeError:
            pass

        fenced_match = re.search(r"\[[\s\S]*\]", text)
        if fenced_match:
            try:
                parsed = json.loads(fenced_match.group(0))
                if isinstance(parsed, list):
                    return self._sanitize_question_list(parsed)
            except json.JSONDecodeError:
                pass

        lines = [line.strip(" -1234567890.").strip() for line in text.splitlines()]
        return self._sanitize_question_list(lines)

    def _sanitize_question_list(self, values: Sequence[Any]) -> List[str]:
        normalized: List[str] = []
        for value in values:
            if not isinstance(value, str):
                continue
            text = re.sub(r"\s+", " ", value.strip())
            if len(text) < 2 or len(text) > 24:
                continue
            normalized.append(text)
        return self._unique_preserve_order(normalized)

    def _unique_preserve_order(self, values: Sequence[str]) -> List[str]:
        deduped: List[str] = []
        seen = set()
        for value in values:
            if value in seen:
                continue
            seen.add(value)
            deduped.append(value)
        return deduped

    def _build_unique_id(
        self,
        manifest: List[Dict[str, Any]],
        scope_type: str,
        department_name: Optional[str],
        name: str,
    ) -> str:
        id_seed = department_name or name or "preset"
        base = self._slugify_ascii(f"{scope_type}_{id_seed}")
        existing = {item["id"] for item in manifest}
        candidate = base
        index = 2
        while candidate in existing:
            candidate = f"{base}_{index}"
            index += 1
        return candidate

    def _build_relative_path(
        self,
        manifest: List[Dict[str, Any]],
        scope_type: str,
        department_name: Optional[str],
        name: str,
    ) -> str:
        folder = "global" if scope_type == "global" else "departments"
        filename_seed = department_name or name or "preset_questions"
        base = self._slugify_ascii(f"{filename_seed}_{name}_preset_questions")
        existing = {item["relative_path"] for item in manifest}
        candidate = f"{folder}/{base}.md"
        index = 2
        while candidate in existing:
            candidate = f"{folder}/{base}_{index}.md"
            index += 1
        return candidate

    def _slugify_ascii(self, value: str) -> str:
        parts: List[str] = []
        for char in value.strip().lower():
            if char.isascii() and (char.isalnum() or char in {"-", "_"}):
                parts.append(char)
            elif char in {" ", "-", "_", "/"}:
                parts.append("_")
            else:
                parts.append(f"u{ord(char):x}")
        slug = re.sub(r"_+", "_", "".join(parts)).strip("_")
        return slug or "preset_questions"

    def _normalize_content(self, content: str) -> str:
        normalized = (content or "").replace("\r\n", "\n").replace("\r", "\n").rstrip()
        return normalized + "\n"


preset_prompt_service = PresetPromptService()
