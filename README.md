# 企业知识云盘系统 (Enterprise Knowledge Drive)

基于 FastAPI 和 React 开发的企业级知识云盘系统，提供文件存储、权限管理、多视图展示等功能。

## 🌟 特性

### 后端 (Backend)
- 🚀 **FastAPI**: 高性能的现代 Python Web 框架
- 🗄️ **SQLAlchemy**: 强大的数据库 ORM，默认使用 SQLite 方便快速启动
- 🔐 **JWT 认证**: 安全的 Token 机制，支持模拟登录（管理员/普通用户）和钉钉登录预留接口
- 📁 **层级文件夹**: 支持多级文件夹嵌套和权限控制
- 📄 **文件管理**: 支持文件上传、下载、搜索和基础信息管理

### 前端 (Frontend)
- ⚛️ **React 18 + Vite**: 极速的开发体验和现代化的组件化架构
- 🎨 **Tailwind CSS**: 原子化 CSS 引擎，结合 `AGENTS.md` 美学指南设计的独特非标 UI
- 🐻 **Zustand**: 轻量级且强大的状态管理
- 🛣️ **React Router v6**: 支持受保护路由和多布局（前台/后台）
- 📱 **响应式设计**: 适配不同尺寸设备的界面交互，丰富的微动画和过渡效果

---

## 🛠️ 快速开始

### 前提条件
- Node.js >= 18
- Python >= 3.9
- 建议在 Windows PowerShell 环境下运行

### 1. 后端服务启动

```bash
cd backend

# 安装依赖
pip install -r requirements.txt

# 启动服务 (支持热重载)
python -m uvicorn app.main:app --reload
```

后端服务将在 `http://localhost:8000` 启动。

**API 文档**:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

### 2. 前端服务启动

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端服务将在 `http://localhost:5173` 启动。

---

## 🔑 测试账号

前端登录页支持直接使用模拟账号登录，无需配置钉钉参数即可测试核心流程。

| 角色 | 账号 | 权限范围 |
| :--- | :--- | :--- |
| **系统管理员** | 点击【管理员】按钮 | 拥有后台管理权限和所有前台功能 |
| **普通用户** | 点击【普通用户】按钮 | 仅拥有前台浏览、上传等常规功能 |

---

## 📁 目录结构说明

```
enterprise-knowledge-drive/
├── backend/                  # FastAPI 后端服务
│   ├── app/
│   │   ├── core/             # 核心配置 (Config, Security)
│   │   ├── db/               # 数据库连接和基础模型
│   │   ├── models/           # SQLAlchemy 数据模型 (User, Folder, File 等)
│   │   ├── routers/          # API 路由分组 (Auth, Folders, Files 等)
│   │   ├── schemas/          # Pydantic 验证模型
│   │   └── main.py           # FastAPI 应用入口
│   ├── uploads/              # 文件上传默认存储目录
│   └── requirements.txt      # Python 依赖
└── frontend/                 # React 前端应用
    ├── src/
    │   ├── components/       # 可复用基础组件
    │   ├── layouts/          # 页面布局 (MainLayout, AdminLayout)
    │   ├── pages/            # 路由页面 (Home, Login, AdminDashboard 等)
    │   ├── services/         # API 请求封装 (axios 实例)
    │   ├── stores/           # Zustand 状态管理
    │   └── App.tsx           # 路由配置
    ├── tailwind.config.js    # Tailwind 配置文件
    └── package.json          # Node 依赖
```

---

## 🎨 设计说明 (遵循 AGENTS.md)

本项目的前端设计严格遵循了提供的 `AGENTS.md` 美学指南，放弃了千篇一律的 "AI 流水线" 审美，采用了：

1. **字体排版**: 引入了 `Plus Jakarta Sans` (英文) 和 `Noto Sans SC` (中文) 的组合，提供更具现代感和几何感的阅读体验。
2. **色彩与主题**: 使用了低饱和度的背景（Slate 系列）搭配明亮的强调色（Indigo/Blue），在后台管理界面采用了具有科技感的深色主题。
3. **空间与动效**: 放弃了传统的死板网格，采用了悬浮卡片、毛玻璃效果（Backdrop Blur）、平滑的 Transform 过渡和 Hover 状态的微交互。
4. **组件差异化**: 登录页采用了非传统的左右分栏设计（预留了宣传图位置）和现代化的卡片堆叠效果。后台侧边栏引入了顶部渐变条和层级化的菜单设计。

## 🔜 后续待完善功能

系统骨架已搭建完毕，以下是为达到生产级别可继续迭代的功能点：

1. **文件夹与文件详情页**: 完善 `FolderDetail` 和 `FilePreview` 组件的具体业务逻辑。
2. **文件上传**: 联调前端的拖拽上传组件与后端的 `/files/upload` 接口。
3. **真实钉钉接入**: 在后端 `app/routers/auth.py` 中填写真实的钉钉 OAuth2 回调逻辑。
4. **后台管理列表**: 完善 `FoldersManage`、`FilesManage` 等页面的数据表格展示和操作。
5. **权限控制**: 细化前端的组件级权限拦截。