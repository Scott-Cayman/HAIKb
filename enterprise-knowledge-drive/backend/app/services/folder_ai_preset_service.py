from __future__ import annotations

import json
import hashlib
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.folder import Folder
from app.models.folder_ai_preset import FolderAiPreset, FolderAiPresetQuestion
from app.models.user import User
from app.services.embedding_service import embedding_service
from app.services.llm_service import llm_service
from app.services.preset_answerability_service import preset_answerability_service
from app.services.resource_access import get_folder_capabilities


DIRECT_SEMANTIC_THRESHOLD = settings.PRESET_SEMANTIC_THRESHOLD
DIRECT_SEMANTIC_MARGIN = settings.PRESET_SEMANTIC_MARGIN
DIRECT_LEXICAL_SIMILARITY = 0.88


@dataclass
class PresetMatch:
    matched: bool
    match_type: str = "none"
    score: float = 0.0
    margin: float = 0.0
    preset_id: Optional[int] = None
    question_id: Optional[int] = None
    folder_id: Optional[int] = None
    folder_name: Optional[str] = None
    preset_name: Optional[str] = None
    question: Optional[str] = None
    answer: Optional[str] = None
    inherited: bool = False
    candidate_count: int = 0
    trigger_id: Optional[int] = None
    trigger_text: Optional[str] = None
    trigger_type: Optional[str] = None
    evidence_text: Optional[str] = None
    verification_method: Optional[str] = None
    verification_ms: float = 0.0
    unsupported_qualifiers: Optional[List[str]] = None
    reason: str = "未命中文件夹预设问题，继续执行知识库检索。"

    def to_debug(self) -> Dict[str, Any]:
        return {
            "matched": self.matched,
            "match_type": self.match_type,
            "score": round(self.score, 4),
            "margin": round(self.margin, 4),
            "threshold": DIRECT_SEMANTIC_THRESHOLD,
            "preset_id": self.preset_id,
            "question_id": self.question_id,
            "folder_id": self.folder_id,
            "folder_name": self.folder_name,
            "preset_name": self.preset_name,
            "question": self.question,
            "inherited": self.inherited,
            "candidate_count": self.candidate_count,
            "trigger_id": self.trigger_id,
            "trigger_text": self.trigger_text,
            "trigger_type": self.trigger_type,
            "evidence_text": self.evidence_text,
            "verification_method": self.verification_method,
            "verification_ms": round(self.verification_ms, 2),
            "unsupported_qualifiers": self.unsupported_qualifiers or [],
            "reason": self.reason,
        }


class FolderAiPresetService:
    """Folder-bound preset Q&A conversion, publishing and fast matching."""

    def normalize_question(self, value: str) -> str:
        text = (value or "").strip().lower()
        text = re.sub(r"[\s\u3000]+", "", text)
        return re.sub(r"[，。！？；：、,.!?;:'\"`()（）\[\]【】<>《》—_-]+", "", text)

    def get_folder_or_404(self, db: Session, folder_id: int) -> Folder:
        folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
        if not folder:
            raise FileNotFoundError("文件夹不存在")
        return folder

    def require_manage(self, db: Session, folder: Folder, user: User) -> None:
        if not get_folder_capabilities(db, folder, user).can_manage_settings:
            raise PermissionError("没有权限配置该文件夹的 AI 预设问题")

    def folder_ancestor_ids(self, db: Session, folder_id: int) -> List[int]:
        result: List[int] = []
        visited: Set[int] = set()
        current_id: Optional[int] = folder_id
        while current_id and current_id not in visited:
            visited.add(current_id)
            folder = db.query(Folder).filter(Folder.id == current_id, Folder.is_deleted == False).first()
            if not folder:
                break
            result.append(folder.id)
            current_id = folder.parent_id
        return result

    def folder_descendant_ids(self, db: Session, folder_id: int) -> Set[int]:
        rows = db.query(Folder.id, Folder.parent_id).filter(Folder.is_deleted == False).all()
        children: Dict[Optional[int], List[int]] = {}
        for row_id, parent_id in rows:
            children.setdefault(parent_id, []).append(row_id)
        result: Set[int] = set()
        stack = [folder_id]
        while stack:
            current_id = stack.pop()
            if current_id in result:
                continue
            result.add(current_id)
            stack.extend(children.get(current_id, []))
        return result

    def list_for_folder(self, db: Session, folder_id: int, user: User) -> Dict[str, Any]:
        folder = self.get_folder_or_404(db, folder_id)
        self.require_manage(db, folder, user)
        presets = (
            db.query(FolderAiPreset)
            .filter(FolderAiPreset.folder_id == folder_id, FolderAiPreset.is_deleted == False)
            .order_by(FolderAiPreset.updated_at.desc(), FolderAiPreset.id.desc())
            .all()
        )
        return {
            "folder": {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id},
            "presets": [self._serialize_preset(db, preset, include_questions=True) for preset in presets],
        }

    def organize_content(self, source_content: str) -> Dict[str, Any]:
        source = (source_content or "").strip()
        if len(source) < 8:
            raise ValueError("请至少输入一段可整理的问题或知识内容")

        chunks = self._split_source(source)
        generated: List[Dict[str, Any]] = []
        warnings: List[str] = []
        if llm_service.is_configured():
            workers = min(3, len(chunks))
            with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
                jobs = {executor.submit(self._organize_chunk_with_llm, chunk): index for index, chunk in enumerate(chunks)}
                ordered: Dict[int, List[Dict[str, Any]]] = {}
                for future in as_completed(jobs):
                    index = jobs[future]
                    try:
                        ordered[index] = future.result()
                    except Exception as exc:
                        warnings.append(f"第 {index + 1} 段 AI 整理失败，已使用规则解析：{exc}")
                        ordered[index] = self._fallback_parse(chunks[index])
                for index in range(len(chunks)):
                    generated.extend(ordered.get(index, []))
        else:
            warnings.append("回答模型未配置，已使用规则解析；发布前请人工核对。")
            for chunk in chunks:
                generated.extend(self._fallback_parse(chunk))

        generated = self._merge_daily_schedule_questions(generated)
        questions = self._dedupe_questions(generated)
        if not questions:
            questions = self._fallback_parse(source)
        warnings.extend(self._quality_warnings(questions))
        warnings = list(dict.fromkeys(warnings))
        return {
            "questions": questions,
            "source_length": len(source),
            "chunk_count": len(chunks),
            "question_count": len(questions),
            "warnings": warnings,
            "prompt_version": "folder-preset-organizer-v2-atomic",
        }

    def publish(
        self,
        db: Session,
        *,
        folder_id: int,
        user: User,
        name: str,
        source_content: str,
        questions: Sequence[Dict[str, Any]],
        description: Optional[str] = None,
        inherit_to_children: bool = True,
        preset_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        folder = self.get_folder_or_404(db, folder_id)
        self.require_manage(db, folder, user)
        normalized_name = (name or "").strip()
        if not normalized_name:
            raise ValueError("预设名称不能为空")
        clean_questions = self._dedupe_questions(list(questions))
        if not clean_questions:
            raise ValueError("至少需要一条有效的预设问题")

        preset: Optional[FolderAiPreset] = None
        if preset_id:
            preset = (
                db.query(FolderAiPreset)
                .filter(
                    FolderAiPreset.id == preset_id,
                    FolderAiPreset.folder_id == folder_id,
                    FolderAiPreset.is_deleted == False,
                )
                .first()
            )
            if not preset:
                raise FileNotFoundError("预设配置不存在")
        if preset is None:
            preset = FolderAiPreset(folder_id=folder_id, created_by=user.id, version=0)
            db.add(preset)

        preset.name = normalized_name
        preset.description = (description or "").strip() or None
        preset.source_content = (source_content or "").strip()
        preset.inherit_to_children = bool(inherit_to_children)
        preset.status = "published"
        preset.version = int(preset.version or 0) + 1
        preset.updated_by = user.id
        db.flush()

        db.query(FolderAiPresetQuestion).filter(FolderAiPresetQuestion.preset_id == preset.id).delete(
            synchronize_session=False
        )
        embedding_texts = [self._embedding_text(item) for item in clean_questions]
        embeddings: List[List[float]] = []
        if embedding_service.is_configured():
            embeddings = embedding_service.embed_documents(embedding_texts)

        for index, item in enumerate(clean_questions):
            question = item["question"]
            db.add(
                FolderAiPresetQuestion(
                    preset_id=preset.id,
                    question=question,
                    normalized_question=self.normalize_question(question),
                    aliases_json=json.dumps(item.get("aliases") or [], ensure_ascii=False),
                    answer=item["answer"],
                    keywords_json=json.dumps(item.get("keywords") or [], ensure_ascii=False),
                    embedding_json=(json.dumps(embeddings[index]) if index < len(embeddings) else None),
                    priority=int(item.get("priority") or 100),
                    is_enabled=bool(item.get("is_enabled", True)),
                )
            )
        db.flush()
        self.rebuild_preset_trigger_index(db, preset.id)
        db.commit()
        db.refresh(preset)
        return self._serialize_preset(db, preset, include_questions=True)

    def delete(self, db: Session, *, folder_id: int, preset_id: int, user: User) -> None:
        folder = self.get_folder_or_404(db, folder_id)
        self.require_manage(db, folder, user)
        preset = (
            db.query(FolderAiPreset)
            .filter(
                FolderAiPreset.id == preset_id,
                FolderAiPreset.folder_id == folder_id,
                FolderAiPreset.is_deleted == False,
            )
            .first()
        )
        if not preset:
            raise FileNotFoundError("预设配置不存在")
        preset.is_deleted = True
        preset.status = "archived"
        preset.updated_by = user.id
        db.commit()

    def rebuild_all_published_trigger_indexes(self, db: Session) -> Dict[str, int]:
        preset_ids = [
            row[0]
            for row in db.query(FolderAiPreset.id)
            .filter(FolderAiPreset.status == "published", FolderAiPreset.is_deleted == False)
            .order_by(FolderAiPreset.id.asc())
            .all()
        ]
        trigger_count = 0
        for preset_id in preset_ids:
            trigger_count += self.rebuild_preset_trigger_index(db, preset_id)
            db.commit()
        return {"preset_count": len(preset_ids), "trigger_count": trigger_count}

    def rebuild_preset_trigger_index(self, db: Session, preset_id: int) -> int:
        """Build one independently embedded row per phrasing/fact for a preset."""

        questions = (
            db.query(FolderAiPresetQuestion)
            .filter(
                FolderAiPresetQuestion.preset_id == preset_id,
                FolderAiPresetQuestion.is_enabled == True,
            )
            .order_by(FolderAiPresetQuestion.id.asc())
            .all()
        )
        db.execute(text("DELETE FROM folder_ai_preset_triggers WHERE preset_id = :preset_id"), {"preset_id": preset_id})
        if not questions:
            return 0
        if not embedding_service.is_configured():
            raise RuntimeError("预设原子索引需要先配置向量模型。")

        question_specs: Dict[int, List[Dict[str, str]]] = {}
        all_embedding_texts: List[str] = []
        for question in questions:
            specs = self._build_trigger_specs(question)
            question_specs[question.id] = specs
            all_embedding_texts.extend(spec["text"] for spec in specs)
            all_embedding_texts.extend(spec["evidence"] for spec in specs if spec.get("evidence"))
            all_embedding_texts.extend(self._answer_clauses(question.answer))

        unique_texts = list(dict.fromkeys(item.strip() for item in all_embedding_texts if item.strip()))
        vectors = self._embed_documents_batched(unique_texts)
        vector_by_text = dict(zip(unique_texts, vectors))

        statement = text(
            """
            INSERT INTO folder_ai_preset_triggers (
                question_id, preset_id, trigger_text, normalized_trigger, trigger_type,
                evidence_text, evidence_hash, embedding_model, dimensions, embedding
            ) VALUES (
                :question_id, :preset_id, :trigger_text, :normalized_trigger, :trigger_type,
                :evidence_text, :evidence_hash, :embedding_model, :dimensions,
                CAST(:embedding AS vector)
            )
            ON CONFLICT (question_id, normalized_trigger) DO UPDATE SET
                trigger_text = EXCLUDED.trigger_text,
                trigger_type = EXCLUDED.trigger_type,
                evidence_text = EXCLUDED.evidence_text,
                evidence_hash = EXCLUDED.evidence_hash,
                embedding_model = EXCLUDED.embedding_model,
                dimensions = EXCLUDED.dimensions,
                embedding = EXCLUDED.embedding,
                updated_at = now()
            """
        )
        inserted = 0
        for question in questions:
            clauses = self._answer_clauses(question.answer) or [question.answer]
            for spec in question_specs.get(question.id, []):
                trigger_vector = vector_by_text.get(spec["text"])
                if not trigger_vector:
                    continue
                evidence = spec.get("evidence") or self._choose_atomic_evidence(
                    spec["text"],
                    clauses,
                    vector_by_text,
                )
                db.execute(
                    statement,
                    {
                        "question_id": question.id,
                        "preset_id": preset_id,
                        "trigger_text": spec["text"],
                        "normalized_trigger": self.normalize_question(spec["text"]),
                        "trigger_type": spec["type"],
                        "evidence_text": evidence,
                        "evidence_hash": hashlib.sha256(evidence.encode("utf-8")).hexdigest(),
                        "embedding_model": settings.EMBEDDING_MODEL,
                        "dimensions": settings.EMBEDDING_DIMENSIONS,
                        "embedding": self._vector_literal(trigger_vector),
                    },
                )
                inserted += 1
        return inserted

    def _build_trigger_specs(self, question: FolderAiPresetQuestion) -> List[Dict[str, str]]:
        result: List[Dict[str, str]] = []
        seen: Set[str] = set()

        def add(value: str, trigger_type: str, evidence: str = "") -> None:
            value = re.sub(r"\s+", " ", (value or "").strip())[:180]
            normalized = self.normalize_question(value)
            if len(normalized) < 2 or normalized in seen:
                return
            seen.add(normalized)
            result.append({"text": value, "type": trigger_type, "evidence": evidence})

        add(question.question, "canonical", question.answer)
        for fragment in self._atomic_trigger_fragments(question.question):
            add(fragment, "canonical_fragment", question.answer)

        for alias in self._load_string_list(question.aliases_json):
            add(alias, "alias")
            for fragment in self._atomic_trigger_fragments(alias):
                add(fragment, "alias_fragment")

        for keyword in self._load_string_list(question.keywords_json):
            add(keyword, "keyword")

        for raw_line in question.answer.splitlines():
            line = re.sub(r"^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)、]\s*)", "", raw_line).strip()
            if not line:
                continue
            for derived in self._derived_fact_triggers(line):
                add(derived, "derived_fact", line[:500])

        for clause in self._answer_clauses(question.answer):
            add(clause, "fact", clause)
            for derived in self._derived_fact_triggers(clause):
                add(derived, "derived_fact", clause)
        return result

    def _derived_fact_triggers(self, clause: str) -> List[str]:
        """Create deterministic questions for common time/count/threshold facts."""

        result: List[str] = []
        compact = re.sub(r"\s+", "", clause)
        if "上班时间" in compact:
            result.extend(
                [
                    "几点上班",
                    "上班时间是什么时候",
                    "早上几点到岗",
                    "最晚几点到岗",
                    "什么时候开始上班",
                    "公司几点开始办公",
                ]
            )
        if "下班时间" in compact:
            result.extend(
                [
                    "几点下班",
                    "下班时间是什么时候",
                    "下午几点下班",
                    "下午几点能走",
                    "什么时候可以下班",
                    "公司几点结束办公",
                ]
            )
        if "上班时间" in compact and "下班时间" in compact:
            start_match = re.search(r"上班时间(\d{1,2})(?::(\d{2}))?", compact)
            end_match = re.search(r"下班时间(\d{1,2})(?::(\d{2}))?", compact)
            if start_match and end_match:
                result.append(f"{start_match.group(1)}点上班{end_match.group(1)}点下班")
                if start_match.group(1) == "9" and end_match.group(1) == "18":
                    result.extend(["朝九晚六", "早九晚六是真的吗"])
            result.extend(["考勤时间", "公司考勤时间", "考勤时间是几点", "考勤几点到几点", "打卡时间"])
        if "打卡" in compact and re.search(r"(?:每天|每日).{0,8}(?:两次|2次|二次)", compact):
            result.extend(["一天打几次卡", "每天需要打卡几次", "上下班都要打卡吗", "打卡次数是多少"])
        if "迟到" in compact:
            minute_match = re.search(r"超过(\d+)分钟", compact)
            result.extend(["迟到怎么算", "迟到早退怎么计算", "晚到多久算迟到"])
            if minute_match:
                minutes = minute_match.group(1)
                result.extend([f"迟到{minutes}分钟算迟到吗", f"晚到{minutes}分钟会记迟到吗"])

        time_subject = re.search(r"([\u4e00-\u9fff]{2,12}(?:时间|日期))[:：为是]?(\d{1,2}(?::\d{2})?)", compact)
        if time_subject:
            subject = time_subject.group(1)
            result.extend([f"{subject}是什么时候", f"{subject}怎么规定"])
        return self._unique_strings(result, limit=16)

    def _atomic_trigger_fragments(self, value: str) -> List[str]:
        text_value = re.sub(r"\s+", "", value or "").strip("？?。！!")
        if not text_value:
            return []
        variants = [text_value]
        stripped = re.sub(
            r"(?:是什么时候|是什么|有哪些|有那些|怎么计算|怎么算|怎么做|如何办理|如何申请|如何|吗|呢)$",
            "",
            text_value,
        )
        stripped = re.sub(r"^(?:请问|想问一下|我想知道|我们公司|公司)", "", stripped)
        if stripped:
            variants.append(stripped)
        for part in re.split(r"(?:以及|或者|还是|和|与|及|、|/)", text_value):
            cleaned = re.sub(
                r"(?:是什么时候|是什么|有哪些|怎么计算|怎么算|怎么做|如何|吗|呢)$",
                "",
                part,
            ).strip()
            if cleaned:
                variants.append(cleaned)
        return self._unique_strings([item for item in variants if 3 <= len(item) <= 48], limit=10)

    def _answer_clauses(self, answer: str) -> List[str]:
        clauses: List[str] = []
        for raw_line in (answer or "").splitlines():
            line = re.sub(r"^\s*(?:#{1,6}\s*|[-*+]\s+|\d+[.)、]\s*)", "", raw_line).strip()
            if not line:
                continue
            for item in re.split(r"[。；;]|(?<=\S)，(?=\S)", line):
                cleaned = item.strip(" ，。；;：:")
                if len(cleaned) >= 4:
                    clauses.append(cleaned[:500])
        return list(dict.fromkeys(clauses))[:80]

    def _choose_atomic_evidence(
        self,
        trigger: str,
        clauses: Sequence[str],
        vector_by_text: Dict[str, List[float]],
    ) -> str:
        trigger_vector = vector_by_text.get(trigger) or []
        best_clause = clauses[0] if clauses else trigger
        best_score = -1.0
        for clause in clauses:
            lexical = self._lexical_similarity(trigger, clause)
            clause_vector = vector_by_text.get(clause) or []
            semantic = (
                sum(left * right for left, right in zip(trigger_vector, clause_vector))
                if trigger_vector and len(trigger_vector) == len(clause_vector)
                else 0.0
            )
            score = semantic * 0.72 + lexical * 0.28
            if score > best_score:
                best_score = score
                best_clause = clause
        return best_clause

    def _embed_documents_batched(self, values: Sequence[str]) -> List[List[float]]:
        batch_size = max(1, int(settings.EMBEDDING_BATCH_SIZE or 8))
        result: List[List[float]] = []
        for index in range(0, len(values), batch_size):
            result.extend(embedding_service.embed_documents(values[index : index + batch_size]))
        return result

    def _lexical_similarity(self, left: str, right: str) -> float:
        return SequenceMatcher(None, self.normalize_question(left), self.normalize_question(right)).ratio()

    def _vector_literal(self, vector: Sequence[float]) -> str:
        return "[" + ",".join(f"{float(value):.9g}" for value in vector) + "]"

    def match(
        self,
        db: Session,
        *,
        query: str,
        visible_folder_ids: Iterable[int],
        current_folder_id: Optional[int] = None,
    ) -> PresetMatch:
        visible_ids = {int(item) for item in visible_folder_ids}
        if not visible_ids:
            return PresetMatch(matched=False, reason="当前账号没有可用于 AI 检索的文件夹。")

        ancestors: List[int] = []
        if current_folder_id is not None:
            if current_folder_id not in visible_ids:
                return PresetMatch(matched=False, reason="当前目录不在账号可见范围内。")
            ancestors = self.folder_ancestor_ids(db, current_folder_id)
            candidate_folder_ids = set(ancestors) & visible_ids
        else:
            candidate_folder_ids = visible_ids

        if not candidate_folder_ids:
            return PresetMatch(matched=False)

        rows = (
            db.query(FolderAiPresetQuestion, FolderAiPreset, Folder)
            .join(FolderAiPreset, FolderAiPreset.id == FolderAiPresetQuestion.preset_id)
            .join(Folder, Folder.id == FolderAiPreset.folder_id)
            .filter(
                FolderAiPreset.folder_id.in_(candidate_folder_ids),
                FolderAiPreset.status == "published",
                FolderAiPreset.is_deleted == False,
                FolderAiPresetQuestion.is_enabled == True,
                Folder.is_deleted == False,
            )
            .all()
        )
        if current_folder_id is not None:
            rows = [
                row
                for row in rows
                if row[1].folder_id == current_folder_id or row[1].inherit_to_children
            ]
        if not rows:
            return PresetMatch(matched=False, candidate_count=0)

        normalized_query = self.normalize_question(query)
        exact_rows = []
        for question, preset, folder in rows:
            aliases = self._load_string_list(question.aliases_json)
            candidates = [question.normalized_question] + [self.normalize_question(alias) for alias in aliases]
            if normalized_query and normalized_query in candidates:
                exact_rows.append((question, preset, folder))
        if exact_rows:
            question, preset, folder = self._choose_specific(exact_rows, ancestors)
            return self._build_match(
                question,
                preset,
                folder,
                match_type="exact" if normalized_query == question.normalized_question else "alias",
                score=1.0,
                margin=1.0,
                candidate_count=len(rows),
                current_folder_id=current_folder_id,
                reason="命中已发布的文件夹预设答案，先直接回答，再异步补充相关文件。",
            )

        atomic_match = self._match_atomic_triggers(
            db,
            query=query,
            candidate_folder_ids=candidate_folder_ids,
            current_folder_id=current_folder_id,
            ancestors=ancestors,
            candidate_count=len(rows),
        )
        if atomic_match is not None:
            return atomic_match

        if not embedding_service.is_configured():
            return PresetMatch(matched=False, candidate_count=len(rows), reason="预设语义模型未配置，已继续执行知识库检索。")
        query_vector = embedding_service.embed_query(query)
        scored = []
        for question, preset, folder in rows:
            vector = self._load_vector(question.embedding_json)
            if not vector or len(vector) != len(query_vector):
                continue
            score = sum(left * right for left, right in zip(query_vector, vector))
            scored.append((score, question, preset, folder))
        scored.sort(key=lambda item: (item[0], item[1].priority), reverse=True)
        if not scored:
            return PresetMatch(matched=False, candidate_count=len(rows), reason="预设问题尚未生成向量，已继续执行知识库检索。")

        best_score, question, preset, folder = scored[0]
        second_score = scored[1][0] if len(scored) > 1 else 0.0
        margin = best_score - second_score
        matched = best_score >= DIRECT_SEMANTIC_THRESHOLD and margin >= DIRECT_SEMANTIC_MARGIN
        if not matched:
            return PresetMatch(
                matched=False,
                match_type="semantic_candidate",
                score=best_score,
                margin=margin,
                preset_id=preset.id,
                question_id=question.id,
                folder_id=folder.id,
                folder_name=folder.name,
                preset_name=preset.name,
                question=question.question,
                candidate_count=len(rows),
                reason="发现相似预设问题，但置信度或区分度不足，已继续执行知识库检索，避免错误直答。",
            )
        return self._build_match(
            question,
            preset,
            folder,
            match_type="semantic",
            score=best_score,
            margin=margin,
            candidate_count=len(rows),
            current_folder_id=current_folder_id,
            reason="高置信度命中文件夹预设答案，先直接回答，再异步补充相关文件。",
        )

    def _match_atomic_triggers(
        self,
        db: Session,
        *,
        query: str,
        candidate_folder_ids: Set[int],
        current_folder_id: Optional[int],
        ancestors: Sequence[int],
        candidate_count: int,
    ) -> Optional[PresetMatch]:
        params: Dict[str, Any] = {
            "folder_ids": sorted(candidate_folder_ids),
            "current_folder_id": current_folder_id,
        }
        base_select = """
            SELECT
                t.id AS trigger_id,
                t.trigger_text,
                t.normalized_trigger,
                t.trigger_type,
                t.evidence_text,
                t.evidence_hash,
                q.id AS question_id,
                q.question,
                q.answer,
                q.priority,
                p.id AS preset_id,
                p.name AS preset_name,
                p.folder_id,
                p.inherit_to_children,
                f.name AS folder_name
            FROM folder_ai_preset_triggers AS t
            JOIN folder_ai_preset_questions AS q ON q.id = t.question_id
            JOIN folder_ai_presets AS p ON p.id = t.preset_id
            JOIN folders AS f ON f.id = p.folder_id
            WHERE p.folder_id = ANY(:folder_ids)
              AND p.status = 'published'
              AND p.is_deleted = false
              AND q.is_enabled = true
              AND f.is_deleted = false
              AND (
                  :current_folder_id IS NULL
                  OR p.folder_id = :current_folder_id
                  OR p.inherit_to_children = true
              )
        """
        trigger_rows = db.execute(text(base_select), params).mappings().all()
        if not trigger_rows:
            return None

        normalized_query = self.normalize_question(query)
        ancestor_rank = {folder_id: len(ancestors) - index for index, folder_id in enumerate(ancestors)}
        lexical_candidates: List[tuple] = []
        for row in trigger_rows:
            normalized_trigger = str(row["normalized_trigger"] or "")
            if not normalized_trigger:
                continue
            similarity = self._lexical_similarity(normalized_query, normalized_trigger)
            mode = ""
            rank = 0
            if normalized_query == normalized_trigger:
                mode, rank, similarity = "atomic_exact", 4, 1.0
            elif min(len(normalized_query), len(normalized_trigger)) >= 4 and (
                normalized_query in normalized_trigger or normalized_trigger in normalized_query
            ):
                mode, rank, similarity = "atomic_phrase", 3, max(similarity, 0.96)
            elif similarity >= DIRECT_LEXICAL_SIMILARITY:
                mode, rank = "atomic_lexical", 2
            if mode:
                lexical_candidates.append(
                    (
                        rank,
                        similarity,
                        ancestor_rank.get(int(row["folder_id"]), 0),
                        int(row["priority"] or 0),
                        row,
                        mode,
                    )
                )
        if lexical_candidates:
            _rank, similarity, _scope_rank, _priority, row, mode = max(lexical_candidates, key=lambda item: item[:4])
            return self._build_trigger_match(
                row,
                match_type=mode,
                score=similarity,
                margin=1.0,
                candidate_count=candidate_count,
                current_folder_id=current_folder_id,
                reason="命中预设的原子问法索引，已跳过大模型并直接返回管理员发布的答案。",
                verification_method="published_trigger",
            )

        if not embedding_service.is_configured():
            return PresetMatch(
                matched=False,
                candidate_count=candidate_count,
                reason="原子问法未文字命中且向量模型未配置，继续执行知识库检索。",
            )

        query_vector = embedding_service.embed_query(query)
        semantic_sql = base_select.replace(
            "FROM folder_ai_preset_triggers AS t",
            ", 1 - (t.embedding <=> CAST(:embedding AS vector)) AS score\n"
            "            FROM folder_ai_preset_triggers AS t",
        ) + " ORDER BY t.embedding <=> CAST(:embedding AS vector) LIMIT 40"
        semantic_params = dict(params)
        semantic_params["embedding"] = self._vector_literal(query_vector)
        semantic_rows = db.execute(text(semantic_sql), semantic_params).mappings().all()
        if not semantic_rows:
            return PresetMatch(matched=False, candidate_count=candidate_count)

        best_by_question: Dict[int, Any] = {}
        for row in semantic_rows:
            key = int(row["question_id"])
            previous = best_by_question.get(key)
            if previous is None or float(row["score"]) > float(previous["score"]):
                best_by_question[key] = row
        ranked = sorted(best_by_question.values(), key=lambda row: float(row["score"]), reverse=True)
        best = ranked[0]
        best_score = float(best["score"])
        second_score = float(ranked[1]["score"]) if len(ranked) > 1 else 0.0
        margin = best_score - second_score
        if best_score < DIRECT_SEMANTIC_THRESHOLD or margin < DIRECT_SEMANTIC_MARGIN:
            return self._build_trigger_candidate(
                best,
                score=best_score,
                margin=margin,
                candidate_count=candidate_count,
                reason="发现相似的原子预设，但置信度或区分度不足，已回退到权限范围内的知识库检索。",
            )

        verification = preset_answerability_service.verify(query, str(best["evidence_text"]))
        if verification.answerable is False or (
            verification.answerable is None and verification.method not in {"disabled"}
        ):
            return self._build_trigger_candidate(
                best,
                score=best_score,
                margin=margin,
                candidate_count=candidate_count,
                reason=verification.reason or "原子预设未通过答案覆盖校验，已回退到知识库检索。",
                verification_method=verification.method,
                verification_ms=verification.latency_ms,
                unsupported_qualifiers=verification.unsupported_qualifiers,
            )

        verification_method = (
            verification.method
            if verification.answerable is True
            else "semantic_threshold_and_qualifier_guard"
        )
        return self._build_trigger_match(
            best,
            match_type="atomic_semantic_verified",
            score=best_score,
            margin=margin,
            candidate_count=candidate_count,
            current_folder_id=current_folder_id,
            reason="语义命中原子预设且通过答案覆盖校验，已优先返回管理员发布的答案。",
            verification_method=verification_method,
            verification_ms=verification.latency_ms,
        )

    def _build_trigger_match(
        self,
        row: Any,
        *,
        match_type: str,
        score: float,
        margin: float,
        candidate_count: int,
        current_folder_id: Optional[int],
        reason: str,
        verification_method: str,
        verification_ms: float = 0.0,
    ) -> PresetMatch:
        trigger_type = str(row["trigger_type"])
        # Atomic evidence explains why this preset matched, but every successful
        # hit must return the complete administrator-published answer.
        answer = str(row["answer"])
        return PresetMatch(
            matched=True,
            match_type=match_type,
            score=score,
            margin=margin,
            preset_id=int(row["preset_id"]),
            question_id=int(row["question_id"]),
            folder_id=int(row["folder_id"]),
            folder_name=str(row["folder_name"]),
            preset_name=str(row["preset_name"]),
            question=str(row["question"]),
            answer=answer,
            inherited=bool(current_folder_id and int(row["folder_id"]) != current_folder_id),
            candidate_count=candidate_count,
            trigger_id=int(row["trigger_id"]),
            trigger_text=str(row["trigger_text"]),
            trigger_type=trigger_type,
            evidence_text=str(row["evidence_text"]),
            verification_method=verification_method,
            verification_ms=verification_ms,
            reason=reason,
        )

    def _build_trigger_candidate(
        self,
        row: Any,
        *,
        score: float,
        margin: float,
        candidate_count: int,
        reason: str,
        verification_method: Optional[str] = None,
        verification_ms: float = 0.0,
        unsupported_qualifiers: Optional[List[str]] = None,
    ) -> PresetMatch:
        return PresetMatch(
            matched=False,
            match_type="atomic_semantic_candidate",
            score=score,
            margin=margin,
            preset_id=int(row["preset_id"]),
            question_id=int(row["question_id"]),
            folder_id=int(row["folder_id"]),
            folder_name=str(row["folder_name"]),
            preset_name=str(row["preset_name"]),
            question=str(row["question"]),
            candidate_count=candidate_count,
            trigger_id=int(row["trigger_id"]),
            trigger_text=str(row["trigger_text"]),
            trigger_type=str(row["trigger_type"]),
            evidence_text=str(row["evidence_text"]),
            verification_method=verification_method,
            verification_ms=verification_ms,
            unsupported_qualifiers=unsupported_qualifiers,
            reason=reason,
        )

    def suggested_questions(
        self,
        db: Session,
        *,
        visible_folder_ids: Iterable[int],
        current_folder_id: Optional[int] = None,
        limit: int = 12,
    ) -> List[str]:
        visible_ids = {int(item) for item in visible_folder_ids}
        if current_folder_id is not None:
            folder_ids = set(self.folder_ancestor_ids(db, current_folder_id)) & visible_ids
        else:
            folder_ids = visible_ids
        if not folder_ids:
            return []
        rows = (
            db.query(FolderAiPresetQuestion.question, FolderAiPreset.folder_id, FolderAiPresetQuestion.priority)
            .join(FolderAiPreset, FolderAiPreset.id == FolderAiPresetQuestion.preset_id)
            .filter(
                FolderAiPreset.folder_id.in_(folder_ids),
                FolderAiPreset.status == "published",
                FolderAiPreset.is_deleted == False,
                FolderAiPresetQuestion.is_enabled == True,
            )
            .order_by(FolderAiPresetQuestion.priority.desc(), FolderAiPresetQuestion.id.asc())
            .limit(max(limit * 3, 24))
            .all()
        )
        result: List[str] = []
        for question, _folder_id, _priority in rows:
            if question not in result:
                result.append(question)
            if len(result) >= limit:
                break
        return result

    def _serialize_preset(self, db: Session, preset: FolderAiPreset, include_questions: bool) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "id": preset.id,
            "folder_id": preset.folder_id,
            "name": preset.name,
            "description": preset.description,
            "source_content": preset.source_content,
            "inherit_to_children": preset.inherit_to_children,
            "status": preset.status,
            "version": preset.version,
            "updated_at": preset.updated_at,
        }
        if include_questions:
            rows = (
                db.query(FolderAiPresetQuestion)
                .filter(FolderAiPresetQuestion.preset_id == preset.id)
                .order_by(FolderAiPresetQuestion.priority.desc(), FolderAiPresetQuestion.id.asc())
                .all()
            )
            payload["questions"] = [
                {
                    "id": row.id,
                    "question": row.question,
                    "aliases": self._load_string_list(row.aliases_json),
                    "answer": row.answer,
                    "keywords": self._load_string_list(row.keywords_json),
                    "priority": row.priority,
                    "is_enabled": row.is_enabled,
                    "has_embedding": bool(row.embedding_json),
                }
                for row in rows
            ]
        return payload

    def _build_match(
        self,
        question: FolderAiPresetQuestion,
        preset: FolderAiPreset,
        folder: Folder,
        *,
        match_type: str,
        score: float,
        margin: float,
        candidate_count: int,
        current_folder_id: Optional[int],
        reason: str,
    ) -> PresetMatch:
        return PresetMatch(
            matched=True,
            match_type=match_type,
            score=score,
            margin=margin,
            preset_id=preset.id,
            question_id=question.id,
            folder_id=folder.id,
            folder_name=folder.name,
            preset_name=preset.name,
            question=question.question,
            answer=question.answer,
            inherited=bool(current_folder_id and folder.id != current_folder_id),
            candidate_count=candidate_count,
            reason=reason,
        )

    def _choose_specific(self, rows: Sequence[tuple], ancestors: Sequence[int]):
        ancestor_rank = {folder_id: len(ancestors) - index for index, folder_id in enumerate(ancestors)}
        return max(rows, key=lambda row: (ancestor_rank.get(row[1].folder_id, 0), row[0].priority, row[0].id))

    def _split_source(self, source: str, max_chars: int = 1400) -> List[str]:
        """Split authored text into semantic units before asking the LLM to organize it.

        Markdown headings provide context, while numbered policy items remain separate
        units. This prevents one large FAQ-generation call from merging unrelated rules.
        """

        sections = re.split(r"(?=^#{1,6}\s+)", source, flags=re.MULTILINE)
        sections = [section.strip() for section in sections if section.strip()]
        if not sections:
            sections = [source]

        numbered_item = re.compile(
            r"^\s*(?:\d+[.)、]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*(.+)$"
        )
        units: List[str] = []
        for section in sections:
            lines = section.splitlines()
            heading = lines[0].strip() if lines and re.match(r"^#{1,6}\s+", lines[0].strip()) else ""
            body_lines = lines[1:] if heading else lines
            preamble: List[str] = []
            items: List[List[str]] = []
            current_item: List[str] = []

            for raw_line in body_lines:
                line = raw_line.strip()
                if not line:
                    continue
                if numbered_item.match(line):
                    if current_item:
                        items.append(current_item)
                    current_item = [line]
                    continue
                if current_item:
                    current_item.append(line)
                else:
                    preamble.append(line)
            if current_item:
                items.append(current_item)

            if items:
                context = ([heading] if heading else []) + preamble
                for item in items:
                    units.append("\n".join(context + item).strip())
            else:
                units.append(section)

        chunks: List[str] = []
        for unit in units:
            if len(unit) <= max_chars:
                chunks.append(unit)
                continue
            paragraphs = [item.strip() for item in re.split(r"\n\s*\n", unit) if item.strip()]
            if len(paragraphs) == 1:
                chunks.extend(unit[index : index + max_chars] for index in range(0, len(unit), max_chars))
                continue
            buffer = ""
            for paragraph in paragraphs:
                if buffer and len(buffer) + len(paragraph) + 2 > max_chars:
                    chunks.append(buffer)
                    buffer = paragraph
                else:
                    buffer = f"{buffer}\n\n{paragraph}".strip()
            if buffer:
                chunks.append(buffer)
        return chunks or [source[:max_chars]]

    def _organize_chunk_with_llm(self, source: str) -> List[Dict[str, Any]]:
        system_prompt = (
            "你是企业知识库预设问答整理器。管理员会输入普通文本、流程说明或零散问题。"
            "只依据原文拆分为可快速命中的问答，不得补写原文没有的制度、金额、入口或步骤。"
            "输出严格 JSON 数组，每项字段为 question、aliases、answer、keywords、priority。"
            "先逐句提取事实，再生成问答；一个 question 只能有一个业务概念、判断条件或操作意图。"
            "次数与方式、定义与处罚、统计周期与核算日期、申请动作与提交期限必须分别成条。"
            "禁止用“和、以及、及、/、顿号”把多个可独立提问的事项合并；也禁止一个 question 出现两个问句。"
            "同一概念的起止时间可以合并，例如上班与下班共同组成每日考勤时间；但考勤时间、考勤统计周期、"
            "考勤核算日是三个不同概念，绝不能互作别名或合并答案。"
            "question 是员工最可能直接提问的标准问题；aliases 给 4 到 8 个真实自然的口语改写，"
            "同时覆盖简短问法、同义词和带场景的问法。每日上下班安排必须覆盖“考勤时间”；"
            "考勤周期只能使用“考勤周期、考勤统计周期、考勤核算周期”等周期表达。"
            "answer 保留原文事实与 Markdown 层级；keywords 为 2 到 6 个词；priority 为 1 到 100。"
            "每个 answer 必须可以脱离上下文独立阅读，不能省略主语，例如不能只写“每月三次视为缺勤”。"
        )
        user_prompt = (
            "请把下面内容整理为结构化预设问答。若某段只有规则而没有显式问题，请根据该段主题生成一个自然问题；"
            "若原文标注待确认，答案必须保留待确认提示。不要输出代码围栏。\n\n"
            f"原始内容：\n{source}"
        )
        response = llm_service.chat(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.1,
            max_tokens=3200,
        )
        parsed = self._extract_json_array(response)
        questions = self._sanitize_questions(parsed)
        issues = self._quality_warnings(questions)
        if not issues:
            return questions

        repair_prompt = (
            "下面是一组根据制度原文生成的预设问答，但原子性检查发现问题。"
            "请严格修复：把复合问题拆成独立问答，保持答案主语完整，不遗漏数字、条件、处罚和期限；"
            "每日考勤时间与考勤统计周期、考勤核算日必须分开。"
            "输出严格 JSON 数组，每项只包含 question、aliases、answer、keywords、priority，不要代码围栏。\n\n"
            f"原文：\n{source}\n\n检查问题：\n- "
            + "\n- ".join(issues)
            + "\n\n待修复 JSON：\n"
            + json.dumps(questions, ensure_ascii=False)
        )
        repaired_response = llm_service.chat(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": repair_prompt}],
            temperature=0,
            max_tokens=3200,
        )
        repaired = self._sanitize_questions(self._extract_json_array(repaired_response))
        return repaired or questions

    def _fallback_parse(self, source: str) -> List[Dict[str, Any]]:
        lines = source.splitlines()
        numbered_statements = []
        numbered_pattern = re.compile(
            r"^\s*(?:\d+[.)、]|[（(]\d+[)）]|[一二三四五六七八九十]+[、.])\s*(.+)$"
        )
        for line in lines:
            match = numbered_pattern.match(line.strip())
            if match:
                numbered_statements.append(match.group(1).strip())
        if numbered_statements:
            return self._sanitize_questions(
                [
                    {
                        "question": self._fallback_question_for_statement(statement),
                        "aliases": [],
                        "answer": statement,
                        "keywords": [],
                        "priority": 60,
                    }
                    for statement in numbered_statements
                ]
            )

        current_question: Optional[str] = None
        answer_lines: List[str] = []
        result: List[Dict[str, Any]] = []

        def flush() -> None:
            nonlocal current_question, answer_lines
            answer = "\n".join(answer_lines).strip()
            if current_question and answer:
                result.append({"question": current_question, "aliases": [], "answer": answer, "keywords": [], "priority": 80})
            current_question = None
            answer_lines = []

        for line in lines:
            heading = re.match(r"^#{2,6}\s+(.+)$", line.strip())
            question_line = re.match(r"^(?:Q|问题|问)\s*[:：]\s*(.+)$", line.strip(), flags=re.IGNORECASE)
            if heading or question_line:
                flush()
                current_question = (heading or question_line).group(1).strip()
                if not current_question.endswith(("？", "?")):
                    current_question = f"{current_question}？"
                continue
            if current_question:
                answer_lines.append(line)
        flush()
        if result:
            return result
        compact = source.strip()
        first_line = next((line.strip() for line in lines if line.strip()), "这段知识说明了什么")
        question = re.sub(r"^#+\s*", "", first_line)[:40]
        if not question.endswith(("？", "?")):
            question += "？"
        return [{"question": question, "aliases": [], "answer": compact, "keywords": [], "priority": 60}]

    def _fallback_question_for_statement(self, statement: str) -> str:
        compact = re.sub(r"\s+", "", statement)
        if "上班时间" in compact and "下班时间" in compact:
            return "考勤时间是怎么规定的？"
        if "考勤" in compact and "统计周期" in compact:
            return "考勤统计周期是多久？"
        if "迟到" in compact and "分钟" in compact:
            return "迟到时间是怎么规定的？"
        if "迟到" in compact and "缺勤" in compact:
            return "迟到多少次算缺勤？"
        if "早退" in compact:
            return "早退是怎么规定的？"
        if "旷工" in compact and "自动离职" in compact:
            return "旷工多少天视为自动离职？"
        if "旷工" in compact:
            return "旷工是怎么规定的？"
        if "缺勤" in compact:
            return "缺勤是怎么规定的？"
        if any(term in compact for term in ("调休", "外出", "出差")):
            return "调休、外出或出差需要怎么申请？"
        summary = re.sub(r"[。；;]+$", "", statement).strip()[:32]
        return f"{summary}的相关规定是什么？"

    def _extract_json_array(self, raw: str) -> List[Any]:
        text = (raw or "").strip()
        try:
            parsed = json.loads(text)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            match = re.search(r"\[[\s\S]*\]", text)
            if not match:
                return []
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, list) else []

    def _sanitize_questions(self, values: Sequence[Any]) -> List[Dict[str, Any]]:
        result: List[Dict[str, Any]] = []
        for value in values:
            if not isinstance(value, dict):
                continue
            question = re.sub(r"\s+", " ", str(value.get("question") or "").strip())
            answer = str(value.get("answer") or "").strip()
            if len(question) < 2 or not answer:
                continue
            aliases = [re.sub(r"\s+", " ", str(item).strip()) for item in (value.get("aliases") or [])]
            keywords = [re.sub(r"\s+", " ", str(item).strip()) for item in (value.get("keywords") or [])]
            aliases = self._augment_aliases(question, answer, aliases)
            result.append(
                {
                    "question": question[:160],
                    "aliases": aliases,
                    "answer": answer,
                    "keywords": self._unique_strings(keywords, limit=8),
                    "priority": max(1, min(100, int(value.get("priority") or 80))),
                    "is_enabled": bool(value.get("is_enabled", True)),
                }
            )
        return result

    def _augment_aliases(self, question: str, answer: str, aliases: Sequence[str]) -> List[str]:
        """Add conservative domain aliases that the organizer commonly omits."""

        context = f"{question}\n{answer}"
        compact = re.sub(r"\s+", "", context)
        generated: List[str] = []
        filtered_aliases = [str(item).strip() for item in aliases if str(item).strip()]

        is_daily_schedule = "上班时间" in compact and "下班时间" in compact
        is_attendance_cycle = "考勤" in compact and (
            "统计周期" in compact or "核算周期" in compact or "一个月为周期" in compact
        )
        is_settlement_day = "考勤" in compact and ("核算日" in compact or "结算日" in compact)

        if is_daily_schedule:
            generated.extend(["考勤时间", "公司考勤时间", "考勤时间是几点", "考勤几点到几点", "打卡时间"])
        if is_attendance_cycle:
            generated.extend(["考勤周期", "考勤统计周期", "考勤核算周期", "考勤多久统计一次"])
            blocked = {
                self.normalize_question(item)
                for item in ("考勤时间", "公司考勤时间", "打卡时间", "上下班时间")
            }
            filtered_aliases = [
                item for item in filtered_aliases if self.normalize_question(item) not in blocked
            ]
        if is_settlement_day:
            generated.extend(["考勤核算日", "考勤结算日", "每月哪天核算考勤"])

        return self._unique_strings(generated + filtered_aliases, limit=12)

    def _merge_daily_schedule_questions(self, values: Sequence[Any]) -> List[Dict[str, Any]]:
        """Keep the start and end of the same daily schedule in one complete answer."""

        items = [dict(item) for item in values if isinstance(item, dict)]
        start_index: Optional[int] = None
        end_index: Optional[int] = None
        start_pattern = re.compile(r"上班时间(?:为|是|[:：]|\s)*\s*\d{1,2}(?::\d{2})?")
        end_pattern = re.compile(r"下班时间(?:为|是|[:：]|\s)*\s*\d{1,2}(?::\d{2})?")

        for index, item in enumerate(items):
            context = re.sub(r"\s+", "", f"{item.get('question', '')}{item.get('answer', '')}")
            has_start = bool(start_pattern.search(context))
            has_end = bool(end_pattern.search(context))
            if has_start and has_end:
                return items
            if has_start and start_index is None:
                start_index = index
            if has_end and end_index is None:
                end_index = index

        if start_index is None or end_index is None or start_index == end_index:
            return items

        start_item = items[start_index]
        end_item = items[end_index]
        start_answer = str(start_item.get("answer") or "").strip().rstrip("。；; ")
        end_answer = str(end_item.get("answer") or "").strip().rstrip("。；; ")
        merged = {
            "question": "考勤时间是怎么规定的？",
            "aliases": self._unique_strings(
                [
                    "考勤时间",
                    "公司考勤时间",
                    "上下班时间",
                    "几点上班",
                    "几点下班",
                    "考勤几点到几点",
                    "打卡时间",
                ]
                + list(start_item.get("aliases") or [])
                + list(end_item.get("aliases") or []),
                limit=12,
            ),
            "answer": f"{start_answer}；{end_answer}。",
            "keywords": self._unique_strings(
                ["考勤时间", "上班时间", "下班时间"]
                + list(start_item.get("keywords") or [])
                + list(end_item.get("keywords") or []),
                limit=8,
            ),
            "priority": max(int(start_item.get("priority") or 80), int(end_item.get("priority") or 80)),
            "is_enabled": bool(start_item.get("is_enabled", True)) and bool(end_item.get("is_enabled", True)),
        }

        first_index = min(start_index, end_index)
        merged_items: List[Dict[str, Any]] = []
        for index, item in enumerate(items):
            if index == first_index:
                merged_items.append(merged)
            if index not in (start_index, end_index):
                merged_items.append(item)
        return merged_items

    def _quality_warnings(self, questions: Sequence[Dict[str, Any]]) -> List[str]:
        """Report organizer output that is syntactically valid but not safely atomic."""

        warnings: List[str] = []
        for index, item in enumerate(questions, start=1):
            question = str(item.get("question") or "").strip()
            answer = str(item.get("answer") or "").strip()
            aliases = [str(value) for value in (item.get("aliases") or [])]
            compact = re.sub(r"\s+", "", f"{question}{answer}")
            daily_schedule = "上班时间" in compact and "下班时间" in compact
            question_marks = question.count("？") + question.count("?")
            enumerated_intents = bool(re.search(r"[、/]", question))
            compound_prompt = bool(
                re.search(r"(?:几次|多少次|多久|哪天|什么|怎么|如何).*(?:几次|多少次|多久|哪天|什么|怎么|如何)", question)
            )
            if question_marks > 1 or compound_prompt or (enumerated_intents and not daily_schedule):
                warnings.append(f"第 {index} 条可能包含多个提问意图，请拆成独立问答：{question}")

            if "考勤" in compact and "统计周期" in compact and ("核算日" in compact or "结算日" in compact):
                warnings.append(f"第 {index} 条同时包含考勤周期和核算日期，请分别成条：{question}")
            if "视为旷工" in compact and ("扣除" in compact or "扣薪" in compact or "工资" in compact):
                warnings.append(f"第 {index} 条同时包含旷工定义和处罚，请分别成条：{question}")
            if "视为缺勤" in compact and ("扣除" in compact or "扣薪" in compact or "工资" in compact):
                warnings.append(f"第 {index} 条同时包含缺勤定义和处罚，请分别成条：{question}")
            if "提前告知" in compact and ("当天提交" in compact or "提交期限" in compact):
                warnings.append(f"第 {index} 条同时包含申请动作和提交期限，请分别成条：{question}")

            normalized_aliases = {self.normalize_question(value) for value in aliases}
            if (
                "考勤" in compact
                and ("统计周期" in compact or "核算周期" in compact)
                and self.normalize_question("考勤时间") in normalized_aliases
            ):
                warnings.append(f"第 {index} 条把考勤时间误作考勤周期别名，请删除该别名：{question}")
        return list(dict.fromkeys(warnings))

    def _dedupe_questions(self, values: Sequence[Any]) -> List[Dict[str, Any]]:
        sanitized = self._sanitize_questions(values)
        result: List[Dict[str, Any]] = []
        seen: Set[str] = set()
        for item in sanitized:
            key = self.normalize_question(item["question"])
            if not key or key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    def _embedding_text(self, item: Dict[str, Any]) -> str:
        aliases = "；".join(item.get("aliases") or [])
        keywords = "、".join(item.get("keywords") or [])
        return f"标准问题：{item['question']}\n口语问法：{aliases}\n关键词：{keywords}".strip()

    def _load_string_list(self, raw: Optional[str]) -> List[str]:
        try:
            parsed = json.loads(raw or "[]")
        except (TypeError, json.JSONDecodeError):
            return []
        return [str(item) for item in parsed if str(item).strip()] if isinstance(parsed, list) else []

    def _load_vector(self, raw: Optional[str]) -> List[float]:
        try:
            parsed = json.loads(raw or "[]")
        except (TypeError, json.JSONDecodeError):
            return []
        if not isinstance(parsed, list):
            return []
        try:
            return [float(item) for item in parsed]
        except (TypeError, ValueError):
            return []

    def _unique_strings(self, values: Sequence[str], limit: int) -> List[str]:
        result: List[str] = []
        seen: Set[str] = set()
        for value in values:
            normalized = value.strip()
            key = self.normalize_question(normalized)
            if not normalized or not key or key in seen:
                continue
            seen.add(key)
            result.append(normalized[:160])
            if len(result) >= limit:
                break
        return result


folder_ai_preset_service = FolderAiPresetService()
