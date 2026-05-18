# 企业知识云盘系统 (Enterprise Knowledge Drive)

企业知识云盘系统是一个基于 FastAPI + React 的企业级知识库管理系统：在“文件存储/管理”的基础上，集成了 RAG（Retrieval-Augmented Generation）能力，对文档自动生成 AI 摘要并建立索引，进一步支持智能问答与相关文件推荐。

## 核心理念

- 分层存储：原文件负责资产沉淀，AI 摘要负责检索与问答
- 成本控制：默认只解析文档前 10 页生成摘要，避免全文索引带来过高 token 消耗
- 双模式并存：传统云盘体验 + AI 智能检索（向量 + 关键词混合）

## 模块概览

### 后端 (FastAPI)

- 认证与权限：JWT 会话、模拟登录（管理员/普通用户）、钉钉 OAuth2 预留
- 文件夹管理：层级树、增删改查、软删除
- 文件管理：上传/下载、最近文件、标题搜索、文件预览
- 预览转换：Word/PPT 转 PDF（依赖 LibreOffice）
- RAG 摘要与索引：摘要生成、摘要切片、向量/关键词索引、索引重建
- Agent 智能问答：基于检索证据生成答案 + 推荐相关文件
- 管理后台接口：统计、全量文件/文件夹管理、RAG 管理入口

### 前端 (React)

- 前台页面：登录、首页、文件夹详情、文件预览（含 AI 摘要侧边栏）、智能搜索、最近文件
- 后台页面：仪表板、文件/文件夹管理、RAG 管理、设置（部分预留）
- 技术栈：React 18 + Vite、Tailwind CSS、Zustand、React Router v6

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         前端 (React)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 用户前台 │  │ 智能搜索 │  │ 文件预览 │  │ 管理后台  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                      后端 (FastAPI)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 认证模块 │  │ 文件模块 │  │ RAG 模块 │  │ Agent 模块│  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                        数据层 (SQLite)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 用户表   │  │ 文件表   │  │ 摘要表   │  │ RAG 索引  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 关键流程

### 文件上传 → 自动摘要 → 索引

```
1) 上传文件，保存原文件到 storage/originals/
2) Office 文档可触发 PDF 预览转换（LibreOffice）
3) 解析前 10 页文本 → 调用 LLM 生成 Markdown 摘要
4) 保存摘要到 document_summaries，并写入 storage/summaries/
5) 摘要切片 → 向量化/关键词化 → 写入 summary_chunks 与向量存储
```

### Agent 问答

```
1) 用户提问 → 向量化
2) 混合检索（Vector + Keyword）→ 结果合并/去重/重排
3) 抽取证据片段（Evidence）→ 调用 LLM 生成回答
4) 关联原文件 → 返回 related_files（两句话简介 + 推荐理由）
```

## 主要 API（节选）

### 认证

- `POST /api/auth/login-mock-admin`
- `POST /api/auth/login-mock-user`
- `GET /api/auth/me`

### 文件夹

- `GET /api/folders/`
- `GET /api/folders/tree`
- `GET /api/folders/{folder_id}`
- `POST /api/folders/`
- `PATCH /api/folders/{folder_id}`
- `DELETE /api/folders/{folder_id}`

### 文件

- `POST /api/files/upload`
- `GET /api/files/recent`
- `GET /api/files/folder/{folder_id}`
- `GET /api/files/title-search`
- `GET /api/files/{file_id}`
- `GET /api/files/{file_id}/download`
- `GET /api/files/{file_id}/preview`
- `PATCH /api/files/{file_id}`
- `DELETE /api/files/{file_id}`

### RAG

- `GET /api/rag/indices`
- `POST /api/rag/indices/default/rebuild`
- `POST /api/rag/files/{file_id}/summarize`
- `GET /api/rag/files/{file_id}/summary`
- `PUT /api/rag/files/{file_id}/tags`
- `POST /api/rag/files/{file_id}/reindex-summary`
- `GET /api/rag/status`

### Agent

- `POST /api/agent/chat`（query, conversation_id, top_k, retrieval_mode）

## 快速开始（开发环境）

### 前提条件

- Node.js >= 18
- Python >= 3.9
- 可选：LibreOffice（用于 Word/PPT 转 PDF 预览）

### 1) 启动后端

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

- 服务地址：`http://localhost:8000`
- Swagger：`http://localhost:8000/docs`

### 2) 启动前端

```bash
cd frontend
npm install
npm run dev
```

- 访问地址：`http://localhost:5173`

### 3) 一键脚本

```bash
./start.sh
./stop.sh
```

## 测试账号

前端登录页支持模拟账号登录，无需配置钉钉参数即可测试核心流程：

| 角色 | 账号 | 权限范围 |
| :--- | :--- | :--- |
| 系统管理员 | 点击【管理员】按钮 | 拥有后台管理权限和所有前台功能 |
| 普通用户 | 点击【普通用户】按钮 | 仅拥有前台浏览、上传等常规功能 |

## 环境变量（backend/.env）

后端通过 `backend/.env` 读取配置（文件不应提交到仓库）：

- `AUTH_MOCK`：是否启用模拟登录
- `JWT_SECRET`：JWT 签名密钥（生产环境必须修改）
- `DATABASE_URL`：数据库连接串（默认 SQLite）
- `STORAGE_DIR` / `PREVIEW_DIR` / `SUMMARY_DIR`：存储与预览/摘要目录
- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`：LLM 文本模型配置
- `LLM_EMBEDDING_MODEL`：Embedding 模型配置
- `ARK_BASE_URL` / `ARK_API_KEY` / `ARK_TEXT_MODEL`：可选的替代/覆盖 LLM 配置
- `VECTOR_STORE`：向量存储类型（默认 `local`）

## 目录结构

```
enterprise-knowledge-drive/
├── backend/
│   ├── app/
│   │   ├── config.py            # 配置读取与存储目录初始化
│   │   ├── database.py          # 数据库连接
│   │   ├── dependencies/        # 认证依赖等
│   │   ├── models/              # SQLAlchemy 模型
│   │   ├── rag/                 # RAG 核心：索引/检索/存储适配
│   │   ├── routers/             # API 路由：auth/files/folders/rag/agent/admin
│   │   ├── services/            # 摘要/索引/Agent 等服务层
│   │   └── main.py              # FastAPI 入口
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── layouts/
│   │   ├── pages/
│   │   ├── services/
│   │   ├── stores/
│   │   └── App.tsx
│   └── package.json
├── start.sh
└── stop.sh
```

## 参考资料

- `项目功能模块说明.md`
- `AGENTS.md`
