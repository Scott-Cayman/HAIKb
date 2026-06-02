from __future__ import annotations

from pathlib import Path
import json
from typing import List

from app.config import settings
from app.database import SessionLocal
from app.models.folder import Folder
from app.models.file import File
from app.models.document_summary import DocumentSummary
from app.models.folder_summary import FolderSummary


class FolderSummaryService:
    """文件夹总结服务：负责为文件夹生成、更新和管理总结文档"""

    def create_initial_folder_summary(self, folder_id: int) -> dict:
        """为新创建的一级文件夹生成初始总结文档"""
        with SessionLocal() as db:
            folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
            if not folder:
                raise ValueError(f"文件夹 {folder_id} 不存在")

            # 检查是否已经有总结文档
            existing_summary = db.query(FolderSummary).filter(FolderSummary.folder_id == folder_id).first()
            if existing_summary:
                return {"folder_id": folder_id, "status": "already_exists"}

            # 生成初始总结文档
            initial_summary = self._generate_initial_summary(folder)
            summary_file_path = self._write_summary_markdown(folder.id, initial_summary)

            summary = FolderSummary(
                folder_id=folder.id,
                summary_markdown=initial_summary,
                summary_file_path=str(summary_file_path),
                file_count=0,
                subfolder_count=0,
                summary_status="success"
            )
            db.add(summary)
            db.commit()

            return {"folder_id": folder_id, "status": "created"}

    def update_folder_summary(self, folder_id: int) -> dict:
        """更新文件夹总结文档（根据子文件夹和文件总结）"""
        with SessionLocal() as db:
            folder = db.query(Folder).filter(Folder.id == folder_id, Folder.is_deleted == False).first()
            if not folder:
                raise ValueError(f"文件夹 {folder_id} 不存在")

            # 获取文件夹内的所有文件和子文件夹
            files = db.query(File).filter(
                File.folder_id == folder_id,
                File.is_deleted == False
            ).all()

            subfolders = db.query(Folder).filter(
                Folder.parent_id == folder_id,
                Folder.is_deleted == False
            ).all()

            # 获取所有文件的总结
            file_ids = [f.id for f in files]
            file_summaries = db.query(DocumentSummary).filter(
                DocumentSummary.file_id.in_(file_ids),
                DocumentSummary.is_deleted == False
            ).all()

            # 获取所有子文件夹的总结
            subfolder_ids = [sf.id for sf in subfolders]
            subfolder_summaries = db.query(FolderSummary).filter(
                FolderSummary.folder_id.in_(subfolder_ids),
                FolderSummary.is_deleted == False
            ).all()

            # 生成总结文档
            summary_content = self._generate_folder_summary(
                folder=folder,
                files=files,
                subfolders=subfolders,
                file_summaries=file_summaries,
                subfolder_summaries=subfolder_summaries
            )

            summary_file_path = self._write_summary_markdown(folder.id, summary_content)

            # 更新或创建总结文档
            summary = db.query(FolderSummary).filter(FolderSummary.folder_id == folder_id).first()
            if not summary:
                summary = FolderSummary(folder_id=folder.id, summary_markdown="")
                db.add(summary)

            summary.summary_markdown = summary_content
            summary.summary_file_path = str(summary_file_path)
            summary.file_count = len(files)
            summary.subfolder_count = len(subfolders)
            summary.summary_status = "success"
            summary.summary_error = None
            db.commit()

            # 如果是二级文件夹，需要更新父级文件夹（一级文件夹）的总结
            if folder.parent_id is not None:
                self.update_folder_summary(folder.parent_id)

            return {"folder_id": folder_id, "status": "updated"}

    def _generate_initial_summary(self, folder: Folder) -> str:
        """生成文件夹初始总结文档"""
        return f"""# AI_FOLDER_SUMMARY

## 0. 机器可读元数据
- folder_id: {folder.id}
- folder_name: {folder.name}
- summary_type: initial
- file_count: 0
- subfolder_count: 0

## 1. 文件夹一句话判断
这是一个新创建的文件夹，当前包含 0 个文件。

## 2. 两句话简介
该文件夹名为 "{folder.name}"，目前为空，没有任何文件或子文件夹。它可以用于存储相关的企业文档。

## 3. 文件夹内容概览
- 文件数量：0
- 子文件夹数量：0
- 文件类型分布：暂无文件
- 标签汇总：暂无标签

## 4. 重要信息摘要
暂无文件，暂无重要信息。

## 5. 可复用价值
该文件夹目前为空，待添加文件后可用于企业知识检索与项目复用。

## 6. 适合被以下问题检索到
- 找关于 {folder.name} 的内容
- 查看空文件夹
- 查找新创建的文件夹

## 7. 检索关键词扩展
{folder.name}, 新建文件夹, 空文件夹

## 8. 总结限制
本总结为初始总结，待文件夹内添加文件后会自动更新。
"""

    def _generate_folder_summary(
        self,
        folder: Folder,
        files: List[File],
        subfolders: List[Folder],
        file_summaries: List[DocumentSummary],
        subfolder_summaries: List[FolderSummary]
    ) -> str:
        """根据文件夹内容生成总结文档"""
        file_count = len(files)
        subfolder_count = len(subfolders)

        # 统计文件类型分布
        file_types = {}
        for f in files:
            ext = f.file_ext or "unknown"
            file_types[ext] = file_types.get(ext, 0) + 1

        type_distribution = ", ".join([f"{ext}({count})" for ext, count in file_types.items()])

        # 收集标签
        all_keywords = set()
        all_industry_tags = set()
        all_region_tags = set()
        all_client_types = set()
        all_project_types = set()
        all_document_types = set()

        for fs in file_summaries:
            if fs.keyword_tags:
                all_keywords.update(self._parse_tag_list(fs.keyword_tags))
            if fs.industry_tags:
                all_industry_tags.update(self._parse_tag_list(fs.industry_tags))
            if fs.region_tags:
                all_region_tags.update(self._parse_tag_list(fs.region_tags))
            if fs.client_type and fs.client_type != "未识别":
                all_client_types.add(fs.client_type)
            if fs.project_type and fs.project_type != "未识别":
                all_project_types.add(fs.project_type)
            if fs.document_type and fs.document_type != "未识别":
                all_document_types.add(fs.document_type)

        # 收集子文件夹信息
        subfolder_info = []
        for sfs in subfolder_summaries:
            sf = next((f for f in subfolders if f.id == sfs.folder_id), None)
            if sf:
                subfolder_info.append(f"- {sf.name}: {sfs.file_count}个文件, {sfs.subfolder_count}个子文件夹")

        # 生成一句话判断
        one_line = f"这是名为'{folder.name}'的文件夹，包含{file_count}个文件和{subfolder_count}个子文件夹，涵盖了{', '.join(all_document_types) if all_document_types else '各种类型'}的文档。"

        # 生成两句话简介
        if file_count > 0:
            two_sentence = (
                f"该文件夹包含{file_count}个文件，涉及{', '.join(all_client_types) if all_client_types else '多种'}客户类型和{', '.join(all_project_types) if all_project_types else '多个'}项目场景。"
                f"它包含{type_distribution}等类型的文件，适合用于快速判断文件夹内容和检索相关项目资料。"
            )
        else:
            two_sentence = (
                f"该文件夹名为'{folder.name}'，包含{subfolder_count}个子文件夹，但当前没有直接存储的文件。"
                f"它可用于组织和管理相关的企业文档资料。"
            )

        # 生成问题列表
        questions = [
            f"找关于 {folder.name} 的内容",
            f"查看 {folder.name} 文件夹",
        ]
        if all_project_types:
            questions.append(f"找 {', '.join(list(all_project_types)[:3])} 类资料")
        if all_client_types:
            questions.append(f"找 {', '.join(list(all_client_types)[:3])} 类项目")

        question_lines = "\n".join(f"- {item}" for item in questions)

        # 生成关键词
        keywords = [folder.name] + list(all_keywords) + list(all_industry_tags) + list(all_region_tags)
        keywords_str = "、".join(keywords[:20]) if keywords else folder.name

        return f"""# AI_FOLDER_SUMMARY

## 0. 机器可读元数据
- folder_id: {folder.id}
- folder_name: {folder.name}
- summary_type: auto_generated
- file_count: {file_count}
- subfolder_count: {subfolder_count}

## 1. 文件夹一句话判断
{one_line}

## 2. 两句话简介
{two_sentence}

## 3. 文件夹内容概览
- 文件数量：{file_count}
- 子文件夹数量：{subfolder_count}
- 文件类型分布：{type_distribution if type_distribution else '暂无文件'}
- 客户类型：{', '.join(all_client_types) if all_client_types else '未识别'}
- 项目类型：{', '.join(all_project_types) if all_project_types else '未识别'}
- 文档类型：{', '.join(all_document_types) if all_document_types else '未识别'}
- 行业标签：{', '.join(all_industry_tags) if all_industry_tags else '未识别'}
- 区域标签：{', '.join(all_region_tags) if all_region_tags else '未识别'}

## 4. 子文件夹概览
{'\n'.join(subfolder_info) if subfolder_info else '暂无子文件夹'}

## 5. 重要信息摘要
- 文件夹名称：{folder.name}
- 总文件数：{file_count}
- 总子文件夹数：{subfolder_count}
- 主要文档类型：{', '.join(all_document_types) if all_document_types else '未识别'}
- 关键内容：包含{', '.join(list(all_keywords)[:10]) if all_keywords else '各种类型'}的相关内容

## 6. 可复用价值
该文件夹可作为{folder.name}相关资料的统一入口，包含{file_count}个文件和{subfolder_count}个子文件夹，涵盖{', '.join(all_document_types) if all_document_types else '多种类型'}的文档，适合用于快速判断是否需要深入查看其中的文件。

## 7. 适合被以下问题检索到
{question_lines}

## 8. 检索关键词扩展
{keywords_str}

## 9. 总结限制
本总结基于文件夹内的文件和子文件夹总结自动生成，可能无法覆盖所有细节。如需查看完整内容，请打开文件夹内的具体文件。
"""

    def _write_summary_markdown(self, folder_id: int, markdown: str) -> Path:
        """将总结文档写入文件"""
        summary_dir = Path(settings.SUMMARY_DIR)
        summary_dir.mkdir(parents=True, exist_ok=True)
        output = summary_dir / f"folder_{folder_id}.md"
        output.write_text(markdown, encoding="utf-8")
        return output

    def _parse_tag_list(self, raw_value: str) -> List[str]:
        if not raw_value:
            return []
        try:
            parsed = json.loads(raw_value)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item).strip() and str(item).strip() != "未识别"]
        except json.JSONDecodeError:
            pass
        return [item.strip() for item in raw_value.split(",") if item.strip() and item.strip() != "未识别" and item.strip() != "[]"]


folder_summary_service = FolderSummaryService()
