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
- **后端文档**: http://113.59.125.17:5181/docs

## 🔌 端口占用情况

| 服务 | 内网端口 | 公网映射端口 | 说明 |
|------|----------|--------------|------|
| 前端 | 5180 | 5180 | React + Vite 服务器 |
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
├── start.sh                 # 开发模式启动脚本
├── stop.sh                  # 开发模式停止脚本
├── start_prod.sh            # 生产模式启动脚本 (systemd)
├── stop_prod.sh             # 生产模式停止脚本 (systemd)
├── restart_prod.sh          # 生产模式重启脚本 (systemd)
├── status_prod.sh           # 生产模式状态查看脚本
├── haikb-backend.service    # 后端 systemd 服务文件
├── haikb-frontend.service   # 前端 systemd 服务文件
└── watchdog.sh              # 监控脚本
```

## 🚀 系统管理

### 模式说明

| 模式 | 管理方式 | 特点 |
|------|---------|------|
| 开发模式 | bash 脚本 | 热重载、实时日志、调试方便 |
| 生产模式 | systemd | 进程守护、开机自启、日志统一 |

### 开发模式

```bash
# 启动开发模式（热重载、实时日志）
./start.sh

# 停止开发模式
./stop.sh

# 停止看门狗
./stop_watchdog.sh
```

### 生产模式

```bash
# 首次启动（安装 systemd 服务）
sudo ./start_prod.sh

# 停止服务
sudo ./stop_prod.sh

# 重启服务
sudo ./restart_prod.sh

# 查看状态
./status_prod.sh

# 查看实时日志
journalctl -u haikb-backend.service -f
journalctl -u haikb-frontend.service -f

# 查看最近日志
journalctl -u haikb-backend.service -n 100 --no-pager
```

### 模式切换

```bash
# 从生产模式切换到开发模式
sudo ./stop_prod.sh      # 停止systemd服务
./start.sh               # 启动开发模式

# 从开发模式切换到生产模式
./stop.sh                # 停止开发模式
sudo ./start_prod.sh     # 启动systemd服务
```

### systemd 服务管理

```bash
# 手动管理服务
sudo systemctl start haikb-backend.service
sudo systemctl start haikb-frontend.service
sudo systemctl stop haikb-backend.service
sudo systemctl stop haikb-frontend.service
sudo systemctl restart haikb-backend.service
sudo systemctl status haikb-backend.service

# 开机自启
sudo systemctl enable haikb-backend.service
sudo systemctl enable haikb-frontend.service

# 取消开机自启
sudo systemctl disable haikb-backend.service
sudo systemctl disable haikb-frontend.service
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
systemctl status haikb-frontend.service

# 检查端口占用
ss -tulnp | grep -E '5180|9090'
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
npm run dev
```

**3. 端口被占用**
```bash
# 查看占用进程
fuser 5180/tcp
fuser 9090/tcp

# 杀死占用进程
fuser -k 5180/tcp
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

1. **网络配置**: 确保路由器端口映射正确（5180 -> 5180, 9090 -> 5181）
2. **数据库**: PostgreSQL需提前安装并运行
3. **Ollama**: 如需图片理解功能，确保Ollama服务正常运行
4. **权限**: 确保 `storage/` 和 `logs/` 目录有写入权限
5. **钉钉**: 确保钉钉应用配置正确，回调地址可访问
6. **生产模式**: 首次启动需要 root 权限安装 systemd 服务

## 📄 License

内部项目，仅供公司内部使用。

## 📄 常用命令
# 开发模式切换
./start.sh   # 停止systemd后以开发模式启动
./stop.sh    # 停止开发模式

# 生产模式管理
./start_prod.sh    # 安装并启动systemd服务
./stop_prod.sh     # 停止systemd服务
./restart_prod.sh  # 重启服务
./status_prod.sh   # 查看状态

# 实时日志
journalctl -u haikb-backend.service -f
journalctl -u haikb-frontend.service -f