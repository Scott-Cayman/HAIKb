# HAIKb Agent + kotaemon RAG 管理系统改造执行方案

> 本文档用于交给 AI IDE / 编程智能体直接执行代码改造。  
> 当前项目：`HAIKb/enterprise-knowledge-drive`  
> 参考项目：`kotaemon-main`  
> 目标：在 HAIKb 现有企业知识云盘 Demo 上，接入一个“只基于 AI 总结文档做 RAG”的 Agent 能力，并借鉴 kotaemon 的 RAG 管理系统设计。

---

## 0. 核心结论

HAIKb 不要直接整套搬入 kotaemon 的 Gradio 应用，也不要把 300 页原文件全文直接丢给 RAG。  
本次改造要做的是：

```text
HAIKb 继续保持 FastAPI + React + SQLite 的企业云盘产品形态。

kotaemon 作为 RAG 管理系统参考底座，迁移/复刻它的核心分层：
IndexManager
BaseIndex
FileIndex 的 Source / Index 关系表设计
IndexDocumentPipeline
DocumentRetrievalPipeline
DocSearchTool
Simple / ReAct Reasoning 思路

但 HAIKb 的 RAG 语料只允许使用“前 10 页生成的 AI 总结文档”，不能直接索引原文件全文。
```

最终闭环：

```text
用户上传原文件
→ 系统保存原文件
→ 系统只解析前 10 页
→ 大模型生成 AI_DOCUMENT_SUMMARY 总结文档
→ 总结文档入库并写入 RAG 索引
→ 用户提问
→ Agent 只检索总结文档
→ Agent 根据总结文档回答
→ Agent 返回命中的原文件 file_id、预览链接、下载链接、两句话简介
```

---

## 1. 必须实现的三个核心功能

### 1.1 上传文件后，解析前 10 页并生成总结文档

要求：

```text
输入：PDF / Word / PPT 等标书类文件
处理：只解析前 10 页
输出：一份给大模型看的 AI 总结文档
存储：总结文档必须持久化到数据库和本地 markdown 文件
关联：总结文档必须和原文件 file_id 强关联
```

注意：

```text
禁止默认解析 300 页全文。
禁止把原文件全文切片进向量库。
禁止让 Agent 回答时直接读取原文件全文。
```

---

### 1.2 用户输入问题后，模型只基于总结文档做 RAG

要求：

```text
用户问题：找政府类项目 / 找文旅类标书 / 有没有活动执行案例
检索对象：只能是 AI_DOCUMENT_SUMMARY 总结文档
检索方式：向量检索 + 关键词检索 + 可选 rerank
回答依据：只能基于命中的总结文档
输出：回答 + 推荐文件列表 + 每个文件的两句话简介 + 原文件预览入口
```

RAG 语料边界：

```text
RAG Corpus = document_summaries.summary_markdown
RAG Corpus != files.storage_path 原文件全文
```

---

### 1.3 命中总结文档后，可直接抛出原文件给前端预览

要求：

```text
每一份总结文档必须有 file_id。
每一个 RAG chunk 必须有 summary_id 和 file_id。
每一个检索结果必须能反查原文件。
每一个 Agent 回答必须返回 related_files 数组。
前端根据 file_id 调用已有 /api/files/{file_id}/preview 进行预览。
```

返回结构示例：

```json
{
  "answer": "已找到 3 份政府类项目资料，主要集中在政府采购、文旅活动和政务会展服务方向。",
  "related_files": [
    {
      "file_id": 12,
      "summary_id": 8,
      "original_name": "某政府采购活动执行服务项目.pdf",
      "two_sentence_intro": "这是一份面向政府采购场景的活动执行类标书文件，核心内容包括项目背景、服务范围、执行要求、评分标准和响应方案。它适合作为公司后续承接政府类、文旅类、政务会展类项目时的参考资料。",
      "match_reason": "总结文档中包含客户类型=政府、项目类型=活动执行、关键词=政府采购/会务服务。",
      "score": 0.87,
      "preview_url": "/api/files/12/preview",
      "download_url": "/api/files/12/download"
    }
  ]
}
```

---

## 2. 当前项目与 kotaemon 的结合方式

### 2.1 HAIKb 当前结构

当前 HAIKb 后端核心路径：

```text
backend/app/main.py
backend/app/models/file.py
backend/app/models/folder.py
backend/app/routers/files.py
backend/app/routers/folders.py
backend/app/routers/auth.py
backend/app/routers/admin.py
```

当前前端核心路径：

```text
frontend/src/pages/Search.tsx
frontend/src/pages/FilePreview.tsx
frontend/src/services/api.ts
frontend/src/layouts/MainLayout.tsx
```

当前已有能力：

```text
文件上传
文件夹管理
文件预览
文件下载
Word / PPT 通过 LibreOffice 转 PDF 预览
SQLite 数据库
JWT 登录
```

---

### 2.2 需要重点参考的 kotaemon 文件

请 AI IDE 优先阅读以下 kotaemon 文件，不要盲目复制整个项目：

```text
kotaemon-main/libs/ktem/ktem/index/manager.py
kotaemon-main/libs/ktem/ktem/index/base.py
kotaemon-main/libs/ktem/ktem/index/file/index.py
kotaemon-main/libs/ktem/ktem/index/file/pipelines.py
kotaemon-main/libs/ktem/ktem/reasoning/simple.py
kotaemon-main/libs/ktem/ktem/reasoning/react.py
kotaemon-main/libs/kotaemon/kotaemon/indices/ingests/files.py
kotaemon-main/libs/kotaemon/kotaemon/indices/vectorindex.py
kotaemon-main/libs/kotaemon/kotaemon/indices/qa/citation_qa_inline.py
```

---

### 2.3 kotaemon 能力映射到 HAIKb

| kotaemon 设计 | HAIKb 中要实现的模块 | 说明 |
|---|---|---|
| `IndexManager` | `backend/app/rag/index_manager.py` | 管理 RAG 索引创建、启动、删除、重建 |
| `BaseIndex` | `backend/app/rag/base_index.py` | 定义索引生命周期接口 |
| `FileIndex` | `backend/app/rag/summary_file_index.py` | 只管理“总结文档索引”，不是原文件全文索引 |
| `Source` 表 | `rag_sources` 表 | 记录每一份可检索的总结文档 |
| `Index` 关系表 | `rag_index_relations` 表 | 维护 summary source 与 chunk/vector/doc 的关系 |
| `DocStore` | `summary_chunks` 表 | 存放总结文档切片文本 |
| `VectorStore` | `VectorStoreAdapter` | 可接 Chroma / Qdrant / OpenViking / 其他向量库 |
| `IndexDocumentPipeline` | `SummaryIndexingPipeline` | 把总结文档切片、embedding、写入索引 |
| `DocumentRetrievalPipeline` | `SummaryRetrievalPipeline` | 只从总结文档中检索 |
| `DocSearchTool` | `SummaryDocSearchTool` | Agent 的文档搜索工具 |
| `FullQAPipeline` | `SummaryQAPipeline` | 普通 RAG 问答 |
| `ReactAgentPipeline` | `HAIKbAgentPipeline` | 可选：让 Agent 先思考再调用工具 |

---

## 3. 总体架构

### 3.1 后端新增目录

在 `backend/app` 下新增：

```text
backend/app/rag/
├── __init__.py
├── base_index.py
├── index_manager.py
├── summary_file_index.py
├── pipelines.py
├── vector_store.py
├── keyword_store.py
├── doc_store.py
├── retriever.py
├── tools.py
└── settings.py

backend/app/services/
├── __init__.py
├── document_parser.py
├── summary_generator.py
├── summary_index_service.py
├── agent_service.py
└── llm_service.py

backend/app/routers/
├── rag.py
└── agent.py

backend/app/models/
├── document_summary.py
├── rag_index.py
└── agent_message.py
```

---

### 3.2 前端新增或改造页面

```text
frontend/src/pages/Search.tsx                 # 改造为 AI 检索 / Agent 问答页
frontend/src/pages/FilePreview.tsx            # 增加右侧 AI 总结侧栏
frontend/src/pages/admin/RagManage.tsx        # 新增 RAG 管理页，可选但建议做
frontend/src/services/ragApi.ts               # 新增 RAG API 封装
frontend/src/services/agentApi.ts             # 新增 Agent API 封装
```

---

## 4. 数据库设计

### 4.1 原文件表 files 保持不变

当前已有：

```python
class File(Base):
    __tablename__ = "files"

    id = Column(Integer, primary_key=True, index=True)
    original_name = Column(String, index=True, nullable=False)
    stored_name = Column(String, nullable=False)
    file_ext = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    size = Column(Integer, default=0)
    storage_path = Column(String, nullable=False)
    preview_path = Column(String, nullable=True)
    preview_status = Column(String, default="pending")
    uploaded_by = Column(Integer, ForeignKey("users.id"))
```

可以新增几个状态字段，但不要破坏原有逻辑：

```python
summary_status = Column(String, default="pending")
# pending / processing / success / failed / unsupported

summary_error = Column(Text, nullable=True)
```

---

### 4.2 新增 document_summaries 表

文件：`backend/app/models/document_summary.py`

```python
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from app.database import Base

class DocumentSummary(Base):
    __tablename__ = "document_summaries"

    id = Column(Integer, primary_key=True, index=True)

    # 强关联原文件，这是最重要的字段
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, unique=True, index=True)

    # 总结文档内容
    summary_markdown = Column(Text, nullable=False)
    summary_file_path = Column(String, nullable=True)

    # 展示给前端和 Agent 用
    one_line_judgement = Column(Text, nullable=True)
    two_sentence_intro = Column(Text, nullable=True)

    # 结构化标签，建议 JSON 字符串保存，SQLite 兼容性更好
    client_type = Column(String, nullable=True)       # 政府 / 国企 / 民企 / 协会 / 品牌方
    project_type = Column(String, nullable=True)      # 会展 / 活动 / 文旅 / 会议 / 招商 / 宣传
    document_type = Column(String, nullable=True)     # 招标文件 / 投标文件 / 方案 / 合同 / 其他
    region_tags = Column(Text, nullable=True)         # JSON array string
    industry_tags = Column(Text, nullable=True)       # JSON array string
    keyword_tags = Column(Text, nullable=True)        # JSON array string

    # 解析信息
    parse_pages = Column(Integer, default=10)
    parse_status = Column(String, default="pending")
    parse_confidence = Column(String, nullable=True)  # high / medium / low
    parse_error = Column(Text, nullable=True)

    # RAG 索引状态
    index_status = Column(String, default="pending")
    index_error = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_deleted = Column(Boolean, default=False)
```

---

### 4.3 新增 rag_indices 表

借鉴 kotaemon `IndexManager` 里的 Index 概念。

文件：`backend/app/models/rag_index.py`

```python
class RagIndex(Base):
    __tablename__ = "rag_indices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    index_type = Column(String, nullable=False, default="summary_file_index")
    config_json = Column(Text, nullable=True)
    status = Column(String, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

默认创建一个索引：

```text
name = "HAIKb Summary RAG Index"
index_type = "summary_file_index"
```

---

### 4.4 新增 rag_sources 表

借鉴 kotaemon `FileIndex.Source`，但这里的 source 不是原文件，而是“总结文档”。

```python
class RagSource(Base):
    __tablename__ = "rag_sources"

    id = Column(String, primary_key=True, index=True)  # uuid
    index_id = Column(Integer, ForeignKey("rag_indices.id"), nullable=False, index=True)

    # 强关联总结文档和原文件
    summary_id = Column(Integer, ForeignKey("document_summaries.id"), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, index=True)

    name = Column(String, nullable=False)       # 原文件名或总结文档名
    path = Column(String, nullable=True)        # summary_file_path
    size = Column(Integer, default=0)
    note_json = Column(Text, nullable=True)     # JSON string，记录 tags、tokens 等

    status = Column(String, default="active")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
```

---

### 4.5 新增 summary_chunks 表

借鉴 kotaemon 的 DocStore。

```python
class SummaryChunk(Base):
    __tablename__ = "summary_chunks"

    id = Column(String, primary_key=True, index=True)  # uuid
    index_id = Column(Integer, ForeignKey("rag_indices.id"), nullable=False, index=True)
    source_id = Column(String, ForeignKey("rag_sources.id"), nullable=False, index=True)
    summary_id = Column(Integer, ForeignKey("document_summaries.id"), nullable=False, index=True)
    file_id = Column(Integer, ForeignKey("files.id"), nullable=False, index=True)

    chunk_index = Column(Integer, default=0)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

---

### 4.6 新增 rag_index_relations 表

借鉴 kotaemon `FileIndex.Index` 关系表。

```python
class RagIndexRelation(Base):
    __tablename__ = "rag_index_relations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    index_id = Column(Integer, ForeignKey("rag_indices.id"), nullable=False, index=True)
    source_id = Column(String, ForeignKey("rag_sources.id"), nullable=False, index=True)

    # target_id 可以是 summary_chunk.id，也可以是向量库里的 vector_id
    target_id = Column(String, nullable=False, index=True)
    relation_type = Column(String, nullable=False)  # document / vector

    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

---

### 4.7 新增 agent_messages 表

```python
class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(String, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    role = Column(String, nullable=False)  # user / assistant / tool
    content = Column(Text, nullable=False)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

---

## 5. 总结文档格式

生成的总结文档必须稳定、结构化、适合大模型检索和判断。

### 5.1 总结文档 Markdown 模板

```markdown
# AI_DOCUMENT_SUMMARY

## 0. 机器可读元数据
- file_id: {{file_id}}
- original_name: {{original_name}}
- document_type: {{document_type}}
- parse_scope: first_10_pages
- parse_pages: 10
- parse_confidence: high/medium/low

## 1. 文件一句话判断
{{one_line_judgement}}

## 2. 两句话简介
{{two_sentence_intro}}

## 3. 标签
- 客户类型：{{client_type}}
- 项目类型：{{project_type}}
- 文件类型：{{document_type}}
- 行业标签：{{industry_tags}}
- 区域标签：{{region_tags}}
- 关键词标签：{{keyword_tags}}

## 4. 重要信息摘要
- 项目名称：{{project_name}}
- 采购方 / 甲方：{{client_name}}
- 项目背景：{{project_background}}
- 服务范围：{{service_scope}}
- 关键要求：{{key_requirements}}
- 评分重点：{{scoring_points}}
- 时间节点：{{timeline}}
- 预算金额：{{budget}}
- 资质要求：{{qualification_requirements}}

## 5. 可复用价值
{{reuse_value}}

## 6. 适合被以下问题检索到
- 找政府类项目
- 找文旅类标书
- 找活动执行方案
- 找会展会务项目案例
- 找政务客户投标文件
- 找有评分标准的招标文件

## 7. 检索关键词扩展
{{search_keywords}}

## 8. 解析限制
本总结仅基于原文件前 10 页生成，可能无法覆盖全文所有细节。如需查看完整内容，请打开原文件预览。
```

---

### 5.2 两句话简介生成要求

两句话简介必须在总结阶段生成，并保存到 `document_summaries.two_sentence_intro`。

格式要求：

```text
第一句：说明这个文件是什么项目、服务对象是谁、核心任务是什么。
第二句：说明这个文件对公司后续复用有什么价值。
```

示例：

```text
这是一份面向政府采购场景的活动执行类标书文件，核心内容包括项目背景、服务范围、执行要求、评分标准和响应方案。它适合作为公司后续承接政府类、文旅类、政务会展类项目时的参考资料，尤其适合用于方案结构、评分点拆解和执行服务标准复用。
```

---

## 6. 文件解析服务

### 6.1 新增 document_parser.py

文件：`backend/app/services/document_parser.py`

职责：

```text
输入 file_id
找到 files.storage_path
如果是 PDF：直接提取前 10 页文本
如果是 Word / PPT：优先使用已有 LibreOffice 转 PDF，再提取前 10 页文本
如果是 Excel：MVP 阶段可标记 unsupported，后续再做
如果是图片：MVP 阶段可标记 unsupported，后续再接 OCR
```

推荐依赖：

```txt
pymupdf
python-dotenv
```

如果原项目已经通过 LibreOffice 生成了 `preview_path`，优先解析 `preview_path`。

伪代码：

```python
def extract_first_pages_text(file: File, max_pages: int = 10) -> dict:
    pdf_path = ensure_pdf_available(file)

    import fitz
    doc = fitz.open(pdf_path)
    page_count = len(doc)
    pages_to_parse = min(max_pages, page_count)

    texts = []
    for i in range(pages_to_parse):
        page = doc[i]
        texts.append(f"\n\n--- PAGE {i + 1} ---\n" + page.get_text("text"))

    return {
        "text": "\n".join(texts),
        "page_count": page_count,
        "parsed_pages": pages_to_parse,
    }
```

注意：

```text
前 10 页文本为空时，parse_confidence=low。
如果前 10 页提取失败，parse_status=failed，并写入 parse_error。
```

---

## 7. 总结生成服务

### 7.1 新增 llm_service.py

文件：`backend/app/services/llm_service.py`

职责：

```text
封装大模型调用
支持 OpenAI 兼容接口
支持 DeepSeek / 通义千问 / 本地模型，只要符合 OpenAI Chat Completions 格式即可
```

环境变量建议：

```env
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=xxx
LLM_MODEL=gpt-4.1-mini
EMBEDDING_MODEL=text-embedding-3-small
```

---

### 7.2 新增 summary_generator.py

文件：`backend/app/services/summary_generator.py`

职责：

```text
输入：file metadata + 前 10 页文本
输出：AI_DOCUMENT_SUMMARY markdown + 结构化字段
```

Prompt：

```text
你是 HAIKb 企业知识库的文档理解器。你的任务不是写给人看的文章，而是生成一份给大模型检索、判断、复用的结构化总结文档。

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
- parse_confidence: high/medium/low

## 1. 文件一句话判断
用一句话判断该文件是什么类型、面向什么客户、解决什么任务。

## 2. 两句话简介
第一句说明这个文件是什么项目、服务对象是谁、核心任务是什么。
第二句说明这个文件对公司后续复用有什么价值。

## 3. 标签
- 客户类型：政府/国企/民企/协会/品牌方/未识别
- 项目类型：会展/活动/文旅/会议/招商/宣传/运营/其他/未识别
- 文件类型：招标文件/投标文件/方案/合同/其他/未识别
- 行业标签：用 JSON 数组输出
- 区域标签：用 JSON 数组输出
- 关键词标签：用 JSON 数组输出

## 4. 重要信息摘要
- 项目名称：
- 采购方 / 甲方：
- 项目背景：
- 服务范围：
- 关键要求：
- 评分重点：
- 时间节点：
- 预算金额：
- 资质要求：

## 5. 可复用价值
说明这个文件可以在公司后续哪些业务场景被复用。

## 6. 适合被以下问题检索到
列出 5-10 个用户可能会问的问题。

## 7. 检索关键词扩展
输出一组适合向量检索和关键词检索的扩展关键词。

## 8. 解析限制
固定写：本总结仅基于原文件前 10 页生成，可能无法覆盖全文所有细节。如需查看完整内容，请打开原文件预览。
```

---

### 7.3 结构化字段提取

生成 Markdown 后，需要从 Markdown 里抽取字段写入数据库：

```text
one_line_judgement
 two_sentence_intro
client_type
project_type
document_type
region_tags
industry_tags
keyword_tags
parse_confidence
```

MVP 可以用正则抽取；后续可以要求 LLM 同时输出 JSON。

---

## 8. 结合 kotaemon 的 RAG 管理系统设计

这一部分是本次改造重点。

### 8.1 新增 BaseIndex

文件：`backend/app/rag/base_index.py`

参考：`kotaemon-main/libs/ktem/ktem/index/base.py`

```python
from abc import ABC, abstractmethod
from typing import Any, Optional

class BaseIndex(ABC):
    def __init__(self, id: int, name: str, config: dict):
        self.id = id
        self.name = name
        self.config = config

    def on_create(self):
        pass

    def on_start(self):
        pass

    def on_delete(self):
        pass

    @abstractmethod
    def get_indexing_pipeline(self, settings: dict, user_id: Optional[int] = None):
        pass

    @abstractmethod
    def get_retriever_pipeline(self, settings: dict, user_id: Optional[int] = None):
        pass
```

---

### 8.2 新增 IndexManager

文件：`backend/app/rag/index_manager.py`

参考：`kotaemon-main/libs/ktem/ktem/index/manager.py`

职责：

```text
创建默认 Summary RAG Index
启动时加载所有 RagIndex
提供 build_index / start_index / delete_index / get_default_index
```

伪代码：

```python
class IndexManager:
    def __init__(self, db_factory):
        self.db_factory = db_factory
        self.indices = {}
        self.index_types = {
            "summary_file_index": SummaryFileIndex,
        }

    def ensure_default_index(self):
        # 如果 rag_indices 为空，创建默认索引
        pass

    def build_index(self, name: str, config: dict, index_type: str):
        # 写入 rag_indices
        # 实例化 SummaryFileIndex
        # 调用 on_create
        pass

    def start_index(self, index_record):
        # 实例化索引并 on_start
        pass

    def on_application_startup(self):
        self.ensure_default_index()
        # 读取 rag_indices 并启动
        pass

    def get_default_index(self):
        return first active index
```

在 `app/main.py` 启动时调用：

```python
from app.rag.index_manager import index_manager

@app.on_event("startup")
def startup_event():
    index_manager.on_application_startup()
```

---

### 8.3 新增 SummaryFileIndex

文件：`backend/app/rag/summary_file_index.py`

参考：`kotaemon-main/libs/ktem/ktem/index/file/index.py`

职责：

```text
管理“总结文档”的 Source / DocStore / VectorStore / IndexRelation。
注意：它不是原文件全文索引。
```

伪代码：

```python
class SummaryFileIndex(BaseIndex):
    def on_create(self):
        # 确保 rag_sources / summary_chunks / rag_index_relations 表存在
        # 当前项目用 Base.metadata.create_all 已经可以处理
        pass

    def on_start(self):
        self.vector_store = VectorStoreAdapter(collection_name=f"summary_index_{self.id}")
        self.doc_store = SummaryDocStore(index_id=self.id)

    def get_indexing_pipeline(self, settings: dict, user_id=None):
        return SummaryIndexingPipeline(
            index_id=self.id,
            vector_store=self.vector_store,
            doc_store=self.doc_store,
            settings=settings,
        )

    def get_retriever_pipeline(self, settings: dict, user_id=None):
        return SummaryRetrievalPipeline(
            index_id=self.id,
            vector_store=self.vector_store,
            doc_store=self.doc_store,
            settings=settings,
        )
```

---

## 9. SummaryIndexingPipeline

文件：`backend/app/rag/pipelines.py`

参考：`kotaemon-main/libs/ktem/ktem/index/file/pipelines.py` 的 `IndexDocumentPipeline` 和 `IndexPipeline`。

### 9.1 输入输出

输入：

```text
DocumentSummary.id
DocumentSummary.summary_markdown
DocumentSummary.file_id
```

输出：

```text
rag_sources 一条记录
summary_chunks 多条记录
rag_index_relations 多条 document 关系
vector store 多条向量
rag_index_relations 多条 vector 关系
```

---

### 9.2 切片规则

因为总结文档不长，切片可以简单：

```text
chunk_size = 800-1200 中文字符
chunk_overlap = 100-150 中文字符
优先按 Markdown 标题切分
每个 chunk 必须保留 file_id、summary_id、source_id、original_name、tags
```

---

### 9.3 伪代码

```python
class SummaryIndexingPipeline:
    def run(self, summary_id: int, reindex: bool = True):
        summary = db.query(DocumentSummary).filter_by(id=summary_id).first()
        file = db.query(File).filter_by(id=summary.file_id).first()

        if reindex:
            self.delete_existing(summary_id)

        source = RagSource(
            id=str(uuid.uuid4()),
            index_id=self.index_id,
            summary_id=summary.id,
            file_id=summary.file_id,
            name=file.original_name,
            path=summary.summary_file_path,
            note_json=json.dumps({
                "client_type": summary.client_type,
                "project_type": summary.project_type,
                "keyword_tags": summary.keyword_tags,
            }, ensure_ascii=False),
        )
        db.add(source)
        db.commit()

        chunks = split_markdown_summary(summary.summary_markdown)

        for idx, text in enumerate(chunks):
            chunk_id = str(uuid.uuid4())
            metadata = {
                "index_id": self.index_id,
                "source_id": source.id,
                "summary_id": summary.id,
                "file_id": summary.file_id,
                "file_name": file.original_name,
                "client_type": summary.client_type,
                "project_type": summary.project_type,
                "document_type": summary.document_type,
                "two_sentence_intro": summary.two_sentence_intro,
                "type": "ai_summary_chunk",
            }

            db.add(SummaryChunk(
                id=chunk_id,
                index_id=self.index_id,
                source_id=source.id,
                summary_id=summary.id,
                file_id=summary.file_id,
                chunk_index=idx,
                content=text,
                metadata_json=json.dumps(metadata, ensure_ascii=False),
            ))

            db.add(RagIndexRelation(
                index_id=self.index_id,
                source_id=source.id,
                target_id=chunk_id,
                relation_type="document",
            ))

            vector_id = self.vector_store.add_text(
                id=chunk_id,
                text=text,
                metadata=metadata,
            )

            db.add(RagIndexRelation(
                index_id=self.index_id,
                source_id=source.id,
                target_id=vector_id,
                relation_type="vector",
            ))

        summary.index_status = "success"
        db.commit()
```

---

## 10. VectorStoreAdapter

文件：`backend/app/rag/vector_store.py`

参考 kotaemon 的 vectorstore 抽象，不要把具体向量库调用散落在业务代码里。

### 10.1 接口定义

```python
class VectorStoreAdapter:
    def __init__(self, collection_name: str):
        self.collection_name = collection_name

    def add_text(self, id: str, text: str, metadata: dict) -> str:
        raise NotImplementedError

    def search(self, query: str, top_k: int = 10, filters: dict | None = None) -> list[dict]:
        raise NotImplementedError

    def delete(self, ids: list[str]):
        raise NotImplementedError

    def drop_collection(self):
        raise NotImplementedError
```

### 10.2 MVP 实现建议

优先级：

```text
1. 如果项目已有 OpenViking，则实现 OpenVikingVectorStoreAdapter
2. 如果只是本地 Demo，则先实现 ChromaVectorStoreAdapter
3. 兜底实现 SQLiteKeywordOnlyRetriever，保证没有向量库时也能跑通
```

建议在 `.env` 增加：

```env
VECTOR_STORE=chroma
VECTOR_COLLECTION_PREFIX=haikb_summary
CHROMA_PERSIST_DIR=./data/chroma
OPENVIKING_API_KEY=
OPENVIKING_BASE_URL=
```

---

## 11. KeywordStore / 混合检索

kotaemon 的 `DocumentRetrievalPipeline` 支持 `retrieval_mode=hybrid`。HAIKb 也要保留这个思想。

### 11.1 检索模式

```text
vector：只向量检索
keyword：只关键词检索
hybrid：向量检索 + 关键词检索，然后合并重排
```

### 11.2 keyword 检索 MVP

可以先用 SQL LIKE：

```python
SELECT * FROM summary_chunks
WHERE content LIKE '%政府%'
   OR content LIKE '%文旅%'
   OR content LIKE '%标书%'
```

后续再升级 SQLite FTS5。

---

## 12. SummaryRetrievalPipeline

文件：`backend/app/rag/retriever.py`

参考：`kotaemon-main/libs/ktem/ktem/index/file/pipelines.py` 的 `DocumentRetrievalPipeline`。

### 12.1 输入输出

输入：

```text
query: 用户问题
selected_file_ids: 可选，限制只查某些文件
retrieval_mode: vector / keyword / hybrid
```

输出：

```text
RetrievedSummaryDocument[]
```

每个结果必须包含：

```python
{
    "chunk_id": "xxx",
    "summary_id": 1,
    "file_id": 12,
    "content": "...",
    "score": 0.87,
    "metadata": {
        "file_name": "xxx.pdf",
        "two_sentence_intro": "...",
        "client_type": "政府",
        "project_type": "活动",
    }
}
```

### 12.2 伪代码

```python
class SummaryRetrievalPipeline:
    def run(self, query: str, top_k: int = 8, retrieval_mode: str = "hybrid", filters: dict | None = None):
        vector_results = []
        keyword_results = []

        if retrieval_mode in ["vector", "hybrid"]:
            vector_results = self.vector_store.search(query, top_k=top_k, filters=filters)

        if retrieval_mode in ["keyword", "hybrid"]:
            keyword_results = self.keyword_store.search(query, top_k=top_k, filters=filters)

        merged = merge_and_deduplicate(vector_results, keyword_results)
        reranked = simple_rerank(query, merged)
        return reranked[:top_k]
```

---

## 13. SummaryDocSearchTool

文件：`backend/app/rag/tools.py`

参考：`kotaemon-main/libs/ktem/ktem/reasoning/react.py` 的 `DocSearchTool`。

### 13.1 工具职责

```text
Agent 不能直接访问数据库查文件。
Agent 只能通过 SummaryDocSearchTool 搜索总结文档。
SummaryDocSearchTool 返回检索证据和 related_files。
```

### 13.2 伪代码

```python
class SummaryDocSearchTool:
    name = "summary_doc_search"
    description = "搜索 HAIKb 中由原文件前 10 页生成的 AI 总结文档。只允许搜索总结文档，不允许搜索原文件全文。"

    def __init__(self, retriever: SummaryRetrievalPipeline):
        self.retriever = retriever

    def run(self, query: str) -> dict:
        docs = self.retriever.run(query=query, top_k=8, retrieval_mode="hybrid")

        evidence = []
        related_files_map = {}

        for doc in docs:
            evidence.append({
                "summary_id": doc["summary_id"],
                "file_id": doc["file_id"],
                "content": doc["content"],
                "score": doc["score"],
                "file_name": doc["metadata"].get("file_name"),
            })

            file_id = doc["file_id"]
            if file_id not in related_files_map:
                related_files_map[file_id] = build_related_file_payload(file_id, doc)

        return {
            "evidence": evidence,
            "related_files": list(related_files_map.values()),
        }
```

---

## 14. Agent 问答服务

文件：`backend/app/services/agent_service.py`

参考：

```text
kotaemon-main/libs/ktem/ktem/reasoning/simple.py
kotaemon-main/libs/ktem/ktem/reasoning/react.py
```

### 14.1 MVP 使用 Simple RAG，不强制复杂 ReAct

第一版建议实现：

```text
用户问题
→ SummaryDocSearchTool 检索总结文档
→ 组织 evidence
→ LLM 基于 evidence 回答
→ 返回 related_files
```

### 14.2 后续可切换 ReAct Agent

可以在配置中加：

```env
AGENT_REASONING_MODE=simple
# simple / react
```

---

### 14.3 Agent 系统提示词

```text
你是 HAIKb 企业知识库 Agent，负责帮助用户从公司历史文件中找到可复用的项目资料、标书文件、投标方案和案例文件。

你必须遵守以下规则：
1. 你不能直接读取或检索原文件全文。
2. 你只能基于系统提供的 AI_DOCUMENT_SUMMARY 总结文档回答。
3. 如果总结文档不足以支持明确结论，你必须说明“当前仅基于前 10 页总结判断”。
4. 用户要求找文件时，你必须返回相关原文件，而不是只给文字回答。
5. 每个推荐文件都必须包含两句话简介。
6. 不要编造不存在的文件、客户、项目、金额、评分标准。
7. 如果没有找到高匹配文件，要说明未找到，并可以推荐相近文件。

输出格式：

## 匹配结论
说明是否找到相关文件，以及整体判断。

## 推荐文件
逐条列出：
- 文件名
- 两句话简介
- 推荐理由
- 匹配标签

## 回答
基于总结文档回答用户问题。

## 注意
如果需要，提醒用户该回答仅基于原文件前 10 页总结。
```

---

### 14.4 回答 Prompt

```text
用户问题：
{query}

下面是从 HAIKb 总结文档索引中检索到的证据。注意：这些证据来自原文件前 10 页生成的 AI 总结文档，不是原文件全文。

{evidence}

请基于证据回答用户问题。
要求：
1. 只基于证据回答，不要编造。
2. 如果证据不足，请明确说明。
3. 如果涉及推荐文件，请根据 related_files 输出文件推荐理由。
4. 每个文件必须保留两句话简介。
5. 回答要面向企业内部业务使用，简洁、清楚、可执行。
```

---

## 15. 后端 API 设计

### 15.1 文件上传后自动总结

修改：`backend/app/routers/files.py`

当前上传接口：

```python
@router.post("/upload", response_model=FileResponseModel)
async def upload_file(...):
```

在 `db_file` 创建成功后增加：

```python
background_tasks.add_task(generate_summary_and_index_task, db_file.id)
```

注意：

```text
如果 Word/PPT 需要先转 PDF，确保总结任务能等待或主动生成 PDF。
不要因为总结失败影响原文件上传成功。
```

---

### 15.2 新增 rag.py

文件：`backend/app/routers/rag.py`

接口：

```text
GET /api/rag/indices
查看 RAG 索引列表

POST /api/rag/indices/default/rebuild
重建默认总结索引

POST /api/rag/files/{file_id}/summarize
手动生成 / 重新生成某个文件的总结文档

GET /api/rag/files/{file_id}/summary
查看某个文件的总结文档

POST /api/rag/files/{file_id}/reindex-summary
重新把某个文件的总结文档写入 RAG 索引

GET /api/rag/status
查看总结生成队列、成功数、失败数、索引状态
```

---

### 15.3 新增 agent.py

文件：`backend/app/routers/agent.py`

接口：

```text
POST /api/agent/chat
```

请求：

```json
{
  "query": "找一下我们公司政府类项目",
  "conversation_id": "optional",
  "top_k": 8,
  "retrieval_mode": "hybrid"
}
```

响应：

```json
{
  "conversation_id": "xxx",
  "answer": "...",
  "evidence": [
    {
      "summary_id": 1,
      "file_id": 12,
      "chunk_id": "xxx",
      "content": "...",
      "score": 0.87
    }
  ],
  "related_files": [
    {
      "file_id": 12,
      "summary_id": 1,
      "original_name": "xxx.pdf",
      "two_sentence_intro": "...",
      "match_reason": "...",
      "score": 0.87,
      "preview_url": "/api/files/12/preview",
      "download_url": "/api/files/12/download"
    }
  ]
}
```

---

### 15.4 main.py 注册路由

修改：`backend/app/main.py`

```python
from app.routers import rag, agent
from app.models import DocumentSummary, RagIndex, RagSource, SummaryChunk, RagIndexRelation, AgentMessage

app.include_router(rag.router, prefix="/api/rag", tags=["rag"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
```

---

## 16. 后台任务设计

新增：`backend/app/services/summary_index_service.py`

### 16.1 总任务

```python
def generate_summary_and_index_task(file_id: int):
    # 1. 设置 file.summary_status = processing
    # 2. 解析前 10 页
    # 3. 调用 LLM 生成总结 markdown
    # 4. 保存 DocumentSummary
    # 5. 保存 markdown 文件到 storage/summaries/{file_id}.md
    # 6. 调用 SummaryIndexingPipeline 入库和向量化
    # 7. 设置 file.summary_status = success
```

### 16.2 状态流转

```text
files.summary_status:
pending → processing → success
pending → processing → failed
unsupported

document_summaries.parse_status:
pending → processing → success / failed

document_summaries.index_status:
pending → processing → success / failed
```

---

## 17. 前端改造

### 17.1 Search.tsx 改造为 Agent 问答页

当前 `Search.tsx` 是待实现，需要改成：

```text
顶部：AI 搜索输入框
中部：Agent 回答区
下方：推荐文件卡片
右侧或折叠区域：检索证据 evidence
```

推荐交互：

```text
用户输入：找政府类项目
点击搜索
调用 POST /api/agent/chat
展示 answer
展示 related_files
每个文件卡片提供：预览 / 下载 / 查看总结
```

文件卡片字段：

```text
文件名
两句话简介
推荐理由
匹配分数
标签
预览按钮
下载按钮
查看 AI 总结按钮
```

---

### 17.2 FilePreview.tsx 增加 AI 总结侧栏

页面打开原文件时，右侧请求：

```text
GET /api/rag/files/{file_id}/summary
```

展示：

```text
文件一句话判断
两句话简介
标签
重要信息摘要
可复用价值
解析限制
```

如果总结还在生成中：

```text
显示：AI 总结生成中
按钮：重新生成总结
```

---

### 17.3 管理后台增加 RagManage.tsx

建议新增后台 RAG 管理页：

```text
索引名称
索引类型
总结文档数量
已索引数量
失败数量
默认 embedding 模型
检索模式 vector / keyword / hybrid
重建索引按钮
失败重试按钮
```

这部分对应 kotaemon 的 RAG 管理系统思想。

---

## 18. 权限与安全

### 18.1 检索权限

第一版可以沿用当前登录权限。后续如果文件夹权限严格，需要在检索时过滤：

```text
用户只能检索自己有权限访问的 file_id 对应的 summary chunks。
```

实现方式：

```text
SummaryRetrievalPipeline 返回结果后，根据当前用户权限过滤 file_id。
或者检索前传入 allowed_file_ids 作为 filter。
```

---

### 18.2 原文件不能越权预览

Agent 返回 `preview_url` 后，前端打开仍然走：

```text
GET /api/files/{file_id}/preview
```

这个接口必须继续校验登录态和文件权限。

---

## 19. 验收标准

### 19.1 文件上传验收

上传一个 300 页 PDF 后：

```text
1. files 表出现原文件记录
2. document_summaries 表出现一条记录
3. document_summaries.file_id = files.id
4. summary_markdown 中明确写 parse_scope: first_10_pages
5. two_sentence_intro 不为空
6. rag_sources 表出现一条 source
7. summary_chunks 表出现若干 chunk
8. rag_index_relations 出现 document/vector 关系
9. 原文件仍可通过 /api/files/{file_id}/preview 预览
```

---

### 19.2 RAG 边界验收

必须验证：

```text
1. 向量库中只写入 summary_markdown 切片
2. 不写入原文件全文切片
3. 用户问详细问题时，如果总结文档没有证据，Agent 必须说证据不足
4. Agent 不能声称已经阅读 300 页全文
```

---

### 19.3 Agent 回答验收

用户输入：

```text
找一下我们公司关于政府类的项目
```

系统必须返回：

```text
1. 匹配结论
2. 推荐文件列表
3. 每个文件两句话简介
4. 推荐理由
5. 原文件 preview_url
6. 原文件 download_url
```

---

### 19.4 前端验收

```text
1. Search 页面可以输入问题并展示 Agent 回答
2. Search 页面可以展示相关文件卡片
3. 点击预览可以打开原文件
4. 点击查看总结可以看到 AI_DOCUMENT_SUMMARY
5. FilePreview 页面可以看到右侧 AI 总结
```

---

## 20. 推荐开发顺序

### 第一步：补数据库模型

```text
新增 document_summary.py
新增 rag_index.py
新增 agent_message.py
更新 models/__init__.py
更新 main.py import，确保 Base.metadata.create_all 能创建表
```

---

### 第二步：做前 10 页解析

```text
新增 document_parser.py
安装 pymupdf
实现 PDF 前 10 页解析
复用现有 LibreOffice 转 PDF 逻辑处理 Word/PPT
```

---

### 第三步：做总结生成

```text
新增 llm_service.py
新增 summary_generator.py
实现 generate_summary(file_id)
保存 document_summaries
保存 storage/summaries/{file_id}.md
```

---

### 第四步：做 kotaemon 风格 RAG 管理层

```text
新增 rag/base_index.py
新增 rag/index_manager.py
新增 rag/summary_file_index.py
新增 rag/pipelines.py
新增 rag/vector_store.py
新增 rag/retriever.py
新增 rag/tools.py
```

---

### 第五步：把总结文档写入 RAG

```text
实现 SummaryIndexingPipeline
实现 summary markdown 切片
实现 SummaryChunk 写入
实现 VectorStoreAdapter 写入
实现 RagIndexRelation 写入
```

---

### 第六步：实现 Agent 问答

```text
实现 SummaryDocSearchTool
实现 AgentService.chat()
实现 /api/agent/chat
```

---

### 第七步：改前端

```text
改造 Search.tsx
新增 ragApi.ts
新增 agentApi.ts
改造 FilePreview.tsx
可选新增 RagManage.tsx
```

---

### 第八步：做验收测试

```text
上传政府类标书
确认自动生成总结
搜索“政府类项目”
确认返回原文件
确认前端可预览
确认 Agent 没有直接引用原文件全文
```

---

## 21. 关键注意事项

### 21.1 不要直接把 kotaemon UI 搬进来

kotaemon 是 Gradio 应用，HAIKb 是 React + FastAPI。  
本项目只借鉴它的 RAG 管理思想和后端分层。

禁止：

```text
把 kotaemon 的 app.py / Gradio 页面直接塞进 HAIKb
让 HAIKb 前端跳转到 kotaemon 页面
```

---

### 21.2 不要做全文 RAG

用户明确要求：

```text
用户输入问题后，模型可以看的文件只有前面得出的总结文档。
```

所以：

```text
原文件只用于预览和下载
原文件全文不进入 RAG
总结文档才是 RAG 语料
```

---

### 21.3 总结文档和原文件必须强关联

核心字段链路：

```text
files.id
↓
document_summaries.file_id
↓
rag_sources.file_id + rag_sources.summary_id
↓
summary_chunks.file_id + summary_chunks.summary_id
↓
retrieval result.file_id
↓
/api/files/{file_id}/preview
```

这条链路必须完整。

---

### 21.4 回答要说明信息边界

因为只解析前 10 页，Agent 回答中遇到细节问题必须提醒：

```text
当前判断仅基于原文件前 10 页生成的总结文档，如需核对全文细节，请打开原文件预览。
```

---

## 22. 最终交付物

AI IDE 执行完成后，应至少新增/修改以下文件。

### 后端

```text
backend/app/models/document_summary.py
backend/app/models/rag_index.py
backend/app/models/agent_message.py
backend/app/models/__init__.py
backend/app/services/document_parser.py
backend/app/services/llm_service.py
backend/app/services/summary_generator.py
backend/app/services/summary_index_service.py
backend/app/services/agent_service.py
backend/app/rag/base_index.py
backend/app/rag/index_manager.py
backend/app/rag/summary_file_index.py
backend/app/rag/pipelines.py
backend/app/rag/vector_store.py
backend/app/rag/keyword_store.py
backend/app/rag/doc_store.py
backend/app/rag/retriever.py
backend/app/rag/tools.py
backend/app/routers/rag.py
backend/app/routers/agent.py
backend/app/routers/files.py
backend/app/main.py
backend/requirements.txt
```

### 前端

```text
frontend/src/pages/Search.tsx
frontend/src/pages/FilePreview.tsx
frontend/src/pages/admin/RagManage.tsx
frontend/src/services/ragApi.ts
frontend/src/services/agentApi.ts
frontend/src/App.tsx
```

---

## 23. 最小可运行版本定义

如果时间有限，只要先完成以下 6 件事，就算第一版闭环成功：

```text
1. 上传文件后可以解析前 10 页
2. 可以生成 AI_DOCUMENT_SUMMARY
3. 总结文档可以保存到 document_summaries
4. 总结文档可以被切片并写入 RAG 索引
5. 用户提问后只检索总结文档
6. Agent 返回相关原文件 file_id、预览链接、下载链接、两句话简介
```

---

## 24. AI 编程智能体执行指令

请按照以下方式执行：

```text
1. 先阅读 HAIKb 当前代码结构，尤其是 backend/app/routers/files.py、backend/app/models/file.py、frontend/src/pages/Search.tsx。
2. 再阅读 kotaemon 的 index/manager.py、index/base.py、index/file/index.py、index/file/pipelines.py、reasoning/react.py、reasoning/simple.py。
3. 不要直接搬 kotaemon UI，不要破坏 HAIKb 现有上传、预览、下载功能。
4. 优先实现 HAIKb 自己的 Summary RAG Index 管理层。
5. 所有 RAG 检索必须只面向 AI_DOCUMENT_SUMMARY。
6. 所有返回给前端的推荐文件必须能通过 file_id 找回原文件。
7. 完成后提供测试步骤：上传文件、查看总结、提问检索、预览原文件。
```

---

## 25. 一句话目标

把 HAIKb 从“企业知识云盘 Demo”升级为：

```text
基于 kotaemon RAG 管理思想的企业标书知识库 Agent：
原文件负责沉淀资产，AI 总结负责进入 RAG，Agent 负责检索判断，前端负责把相关原文件重新抛给用户预览和复用。
```
