# HAIKB Enterprise Knowledge Drive

企业知识云盘系统，支持文件管理、RAG智能检索和AI Agent对话。

## 📋 项目概述

HAIKB（企业知识云盘）是一个基于FastAPI和React构建的企业级知识管理系统，支持文件存储、智能检索和AI对话功能。

## 🌐 访问地址

### 局域网访问
- **前端**: http://192.168.9.168:5180
- **后端API**: http://192.168.9.168:9090
- **后端文档**: http://192.168.9.168:9090/docs

### 公网访问（端口映射）
- **前端**: http://113.59.125.17:5180
- **后端API**: http://113.59.125.17:5181

## 🔌 端口占用情况

| 服务 | 内网端口 | 公网映射端口 | 说明 |
|------|----------|--------------|------|
| 前端 | 5180 | 5180 | React + Vite开发服务器 |
| 后端 | 9090 | 5181 | FastAPI API服务 |

## 🛠️ 技术栈

### 后端
- **框架**: FastAPI 0.110.1
- **数据库**: PostgreSQL 12+
- **ORM**: SQLAlchemy 2.0.29
- **认证**: JWT + 钉钉OAuth
- **LLM**: 火山引擎Ark (豆包) / Ollama
- **OCR**: EasyOCR + Tesseract
- **文档处理**: PyMuPDF (PDF)

### 前端
- **框架**: React 19.2.5 + TypeScript
- **构建工具**: Vite 8.0.10
- **样式**: Tailwind CSS 3.4.19
- **路由**: React Router DOM 7.14.2
- **状态管理**: Zustand 5.0.12
- **HTTP客户端**: Axios 1.15.2

## ✨ 核心功能

### 用户功能
- **文件管理**: 上传、下载、预览、删除文件
- **文件夹管理**: 创建、重命名、删除文件夹
- **收藏功能**: 收藏常用文件和文件夹
- **最近文件**: 查看最近访问的文件
- **文件搜索**: 基于文件名和内容的搜索
- **PDF预览**: 内置PDF查看器
- **钉钉登录**: 钉钉OAuth单点登录

### 管理员功能
- **仪表盘**: 系统概览
- **用户管理**: 用户权限管理
- **文件管理**: 全局文件管理
- **文件夹管理**: 全局文件夹管理
- **RAG管理**: 向量索引管理
- **系统设置**: 配置管理

### AI功能
- **RAG检索**: 基于向量的文档检索
- **智能摘要**: 自动生成文档摘要
- **AI Agent**: 基于文档的智能对话
- **OCR识别**: 图片文字识别
- **图片理解**: 基于Ollama的图片分析

## 📁 项目结构

```
enterprise-knowledge-drive/
├── backend/                 # 后端服务
│   ├── app/
│   │   ├── models/          # 数据模型
│   │   ├── routers/         # API路由
│   │   ├── services/        # 业务逻辑
│   │   ├── rag/             # RAG相关
│   │   └── dependencies/    # 依赖注入
│   ├── scripts/             # 工具脚本
│   ├── .env                 # 环境配置
│   └── requirements.txt     # Python依赖
├── frontend/                # 前端服务
│   ├── src/
│   │   ├── pages/           # 页面组件
│   │   ├── components/      # 通用组件
│   │   ├── layouts/         # 布局组件
│   │   ├── stores/          # 状态管理
│   │   └── services/        # API服务
│   └── package.json
├── storage/                 # 文件存储目录
│   ├── originals/           # 原始文件
│   ├── previews/            # 预览文件
│   ├── summaries/           # 文档摘要
│   └── rag/                 # RAG向量数据
├── logs/                    # 日志目录
├── data/                    # 数据目录
├── start.sh                 # 启动脚本
├── stop.sh                  # 停止脚本
└── watchdog.sh              # 监控脚本
```

## 🚀 快速开始

### 启动服务

```bash
# 一键启动所有服务（后端、前端、看门狗）
./start.sh
```

### 停止服务

```bash
# 停止所有服务
./stop.sh
```

### 停止看门狗

```bash
./stop_watchdog.sh
```

## ⚙️ 配置说明

配置文件位于 `backend/.env`，主要配置项：

### 钉钉认证配置
```env
AUTH_MOCK=false
DINGTALK_CLIENT_ID=your_client_id
DINGTALK_CLIENT_SECRET=your_client_secret
DINGTALK_CORP_ID=your_corp_id
DINGTALK_AGENT_ID=your_agent_id
DINGTALK_REDIRECT_URI=http://113.59.125.17:5180/auth/dingtalk/callback
DINGTALK_ALLOWED_EMAIL_DOMAINS=@himice.com
```

### 数据库配置
```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=haikb
POSTGRES_URL=postgresql+psycopg2://postgres:postgres@127.0.0.1:5432/haikb
```

### LLM配置
```env
ARK_API_KEY=your_ark_api_key
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_TEXT_MODEL=doubao-seed-1-8-251228
ARK_IMAGE_MODEL=gemma4:e4b
OLLAMA_BASE_URL=http://192.168.9.161:11434
QWEN_AGENT_ENABLED=true
```

### 管理员配置
```env
SUPER_ADMIN_EMAILS=liuqingyu@himice.com
ADMIN_EMAILS=chenjingxia@himice.com,zhangxia@himice.com,fanhongyan@himice.com
```

## 📊 数据库模型

主要数据表：
- **users**: 用户表
- **folders**: 文件夹表
- **files**: 文件表
- **document_summaries**: 文档摘要表
- **folder_summaries**: 文件夹摘要表
- **rag_indexes**: RAG索引表
- **agent_messages**: Agent对话消息表
- **audit_logs**: 审计日志表
- **system_settings**: 系统设置表

## 🔧 API接口

### 认证模块 (`/api/auth`)
- `POST /login`: 登录
- `GET /me`: 获取当前用户
- `GET /dingtalk/authorize`: 钉钉授权
- `GET /dingtalk/callback`: 钉钉回调

### 文件夹模块 (`/api/folders`)
- `GET /`: 获取文件夹列表
- `POST /`: 创建文件夹
- `GET /{id}`: 获取文件夹详情
- `PATCH /{id}`: 更新文件夹
- `DELETE /{id}`: 删除文件夹

### 文件模块 (`/api/files`)
- `GET /`: 获取文件列表
- `POST /upload`: 上传文件
- `GET /{id}`: 获取文件详情
- `GET /{id}/download`: 下载文件
- `GET /{id}/preview`: 获取预览
- `DELETE /{id}`: 删除文件
- `GET /recent`: 最近文件

### RAG模块 (`/api/rag`)
- `POST /search`: 搜索文档
- `POST /index`: 构建索引
- `GET /indexes`: 获取索引列表

### Agent模块 (`/api/agent`)
- `POST /chat`: AI对话
- `GET /history`: 对话历史

### 管理员模块 (`/api/admin`)
- `GET /stats`: 系统统计
- `GET /users`: 用户列表
- `PATCH /users/{id}/role`: 更新用户角色
- `GET /files`: 所有文件
- `GET /settings`: 系统设置
- `PATCH /settings`: 更新设置

## 📝 日志文件

日志自动按天切换，存储在 `logs/` 目录：
- `logs/backend/backend-YYYY-MM-DD.log`: 后端日志
- `logs/frontend/frontend-YYYY-MM-DD.log`: 前端日志
- `logs/watchdog/watchdog-YYYY-MM-DD.log`: 看门狗日志

## 🔍 进程检查

```bash
# 检查看门狗
ps aux | grep watchdog.sh

# 检查后端
ps aux | grep uvicorn

# 检查前端
ps aux | grep vite
```

## 📌 注意事项

1. **网络配置**: 确保路由器端口映射正确
2. **数据库**: PostgreSQL需提前安装并运行
3. **Ollama**: 如需图片理解功能，确保Ollama服务正常运行
4. **权限**: 确保 `storage/` 和 `logs/` 目录有写入权限
5. **钉钉**: 确保钉钉应用配置正确，回调地址可访问

## 📄 License

内部项目，仅供公司内部使用。
