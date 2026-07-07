# HAIKB Enterprise Knowledge Drive

企业知识云盘系统，支持文件管理、RAG智能检索和AI Agent对话。

- 快速查看开发与发布命令：[开发说明](file:///home/HAIKB/enterprise-knowledge-drive/开发说明.md)

## 📋 项目概述

HAIKB（企业知识云盘）是一个基于FastAPI和React构建的企业级知识管理系统，支持文件存储、智能检索和AI对话功能。

## 🌐 访问地址

### 正式访问
- **正式站点**: http://kb.himice.com:5180
- **健康检查**: http://kb.himice.com:5180/health
- **后端文档（本机）**: http://127.0.0.1:9090/docs

### 开发访问
- **前端 dev（本机默认）**: http://127.0.0.1:5173
- **前端 dev（内网示例）**: http://192.168.9.168:5173
- **后端 API（本机）**: http://127.0.0.1:9090

## 🔌 端口占用情况

| 服务 | 内网端口 | 公网映射端口 | 说明 |
|------|----------|--------------|------|
| 正式站点 | 5180 | 5180 | Nginx 托管前端静态资源并反代 `/api` |
| 开发前端 | 5173 | 无 | React + Vite dev server（默认） |
| 后端 | 9090 | 无 | FastAPI API 服务（由 Nginx 同源转发） |

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
│   │   └── dependencies/     # 依赖注入
│   ├── scripts/             # 工具脚本
│   ├── .env                 # 环境配置
│   └── requirements.txt     # Python依赖
├── frontend/                # 前端服务
│   ├── src/
│   │   ├── pages/           # 页面组件
│   │   ├── components/       # 通用组件
│   │   ├── layouts/         # 布局组件
│   │   ├── stores/           # 状态管理
│   │   └── services/         # API服务
│   └── package.json
├── storage/                 # 文件存储目录
│   ├── originals/            # 原始文件
│   ├── previews/             # 预览文件
│   ├── summaries/            # 文档摘要
│   └── rag/                  # RAG向量数据
├── logs/                    # 日志目录
├── data/                    # 数据目录
├── start_prod.sh            # 生产模式启动脚本 (build + backend + nginx)
├── stop_prod.sh             # 生产模式停止脚本
├── restart_prod.sh          # 生产模式重启脚本 (build + reload nginx)
├── status_prod.sh           # 生产模式状态查看脚本
├── haikb-backend.service    # 后端 systemd 服务文件
└── docs/                    # 补充文档
```

## 🚀 系统管理

### 模式说明

| 模式 | 管理方式 | 特点 |
|------|---------|------|
| 开发模式 | `npm run dev` + 生产后端 | 前端热重载、轻量调试、不额外起第二个后端 |
| 生产模式 | backend systemd + Nginx | 前端静态托管、同源 `/api`、对外统一入口 |

### 开发模式

```bash
# 在 frontend 目录启动前端开发服务（默认 5173）
cd frontend
npm run dev

# 如需自定义 HMR 地址
VITE_HMR_HOST=192.168.9.168 VITE_HMR_CLIENT_PORT=5173 npm run dev
```

### 生产模式

```bash
# 首次启动 / 更新部署
sudo ./start_prod.sh

# 停止后端服务
sudo ./stop_prod.sh

# 重新构建前端并重启后端 / 重载 Nginx
sudo ./restart_prod.sh

# 查看状态
./status_prod.sh

# 查看实时日志
journalctl -u haikb-backend.service -f
journalctl -u nginx -f

# 查看最近日志
journalctl -u haikb-backend.service -n 100 --no-pager
```

### 模式切换

```bash
# 开发时保持生产后端运行，仅启动前端 dev
sudo systemctl start haikb-backend.service
cd frontend && npm run dev

# 开发完成后重新构建并发布
sudo ./restart_prod.sh
```

### systemd 服务管理

```bash
# 手动管理后端服务
sudo systemctl start haikb-backend.service
sudo systemctl stop haikb-backend.service
sudo systemctl restart haikb-backend.service
sudo systemctl status haikb-backend.service

# Nginx 服务
sudo systemctl status nginx
sudo systemctl restart nginx

# 开机自启
sudo systemctl enable haikb-backend.service

# 取消开机自启
sudo systemctl disable haikb-backend.service

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
DINGTALK_REDIRECT_URI=http://kb.himice.com:5180/auth/dingtalk/callback
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

## 📝 日志

### 开发模式日志
日志文件存储在 `logs/` 目录：
```bash
tail -f logs/backend/backend-$(date +%Y-%m-%d).log
tail -f logs/frontend/frontend-$(date +%Y-%m-%d).log
```

### 生产模式日志
使用 journalctl 查看：
```bash
# 实时日志
journalctl -u haikb-backend.service -f
journalctl -u nginx -f

# 今天的所有日志
journalctl -u haikb-backend.service --since today

# 指定时间范围的日志
journalctl -u haikb-backend.service --since "2026-07-01 10:00" --until "2026-07-01 12:00"

# 查看错误级别以上日志
journalctl -p err -u haikb-backend.service
```

## 🔍 故障排查

### 检查服务状态
```bash
# 生产模式
./status_prod.sh

# 手动检查
systemctl status haikb-backend.service
systemctl status nginx

# 检查端口占用
ss -tulnp | grep -E '5173|5180|9090'
```

### 常见问题

**1. 后端启动失败**
```bash
# 检查依赖是否安装
cd backend && .venv/bin/pip install -r requirements.txt

# 检查数据库连接
psql -U postgres -h 127.0.0.1 -d haikb -c "SELECT 1"

# 查看启动日志
journalctl -u haikb-backend.service -n 50
```

**2. 前端启动失败**
```bash
# 检查node_modules
cd frontend && npm install

# 清除缓存
rm -rf node_modules/.vite
VITE_BACKEND_BASE_URL=http://127.0.0.1:9090 npm run dev -- --port 5173
```

**3. 端口被占用**
```bash
# 查看占用进程
fuser 5173/tcp
fuser 5180/tcp
fuser 9090/tcp

# 杀死占用进程
fuser -k 5173/tcp
fuser -k 9090/tcp
```

**4. 权限问题**
```bash
# 确保目录权限
chown -R root:root /home/HAIKB/enterprise-knowledge-drive
chmod -R 755 /home/HAIKB/enterprise-knowledge-drive
chmod -R 777 /home/HAIKB/enterprise-knowledge-drive/storage
chmod -R 777 /home/HAIKB/enterprise-knowledge-drive/logs
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

## 🔐 权限管理

### 角色说明

| 角色 | 说明 |
|------|------|
| 超级管理员 | 访问所有数据，管理所有用户 |
| 管理员 | 访问同部门数据，管理普通用户 |
| 普通用户 | 访问同部门数据 |

### 权限控制逻辑

- **超级管理员**: `is_super_admin=True`，可访问所有文件夹和文件
- **部门隔离**: 用户只能访问同部门的数据
- **跨部门访问**: 超级管理员创建的文件夹/文件可被所有人访问

## 📌 注意事项

1. **网络配置**: 正式访问统一走 `kb.himice.com:5180`，前端通过 Nginx 同源访问 `/api`
2. **数据库**: PostgreSQL需提前安装并运行
3. **Ollama**: 如需图片理解功能，确保Ollama服务正常运行
4. **权限**: 确保 `storage/` 和 `logs/` 目录有写入权限
5. **钉钉**: 确保钉钉应用配置正确，回调地址可访问
6. **生产模式**: 首次启动需要 root 权限安装 / 重载后端服务并执行 Nginx 操作

## 📄 License

内部项目，仅供公司内部使用。

## 📄 常用命令
# 开发模式
cd frontend && npm run dev

# 生产模式管理
./start_prod.sh    # build 前端并启动生产环境
./stop_prod.sh     # 停止生产后端服务
./restart_prod.sh  # 重新 build 并重载生产环境
./status_prod.sh   # 查看状态

# 实时日志
journalctl -u haikb-backend.service -f
journalctl -u nginx -f
