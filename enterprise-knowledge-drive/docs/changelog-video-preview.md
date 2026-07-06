# 在线视频播放功能更新日志

**日期：** 2026-07-03
**版本：** v2026-07-03-video-preview
**影响范围：** 文件预览模块（后端 + 前端）

---

## 一、功能概述

新增对 `.mp4`、`.webm`、`.ogg`、`.mov` 等常见视频格式的在线预览播放支持。用户点击视频文件后可直接在浏览器内播放，支持播放控制和进度条拖动。

## 二、技术要点

### 2.1 核心设计

- **无需额外依赖**：使用浏览器原生 HTML5 `<video>` 标签，不引入任何新的 npm 包或 Python 库
- **流式播放**：通过独立的 `/api/files/{id}/stream` 接口实现，避免将整个视频文件下载到内存（blob 方式对大视频不可行）
- **HTTP Range 支持**：手动实现 HTTP 206 Partial Content 响应，支持浏览器视频拖动进度条
- **分块读取**：每次读取 8KB，避免大文件占用过多内存

### 2.2 关键问题与解决

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 旧 MP4 文件无法预览 | 已有文件在功能上线前上传，数据库中 `preview_status` 为 `"unsupported"` | `get_file` 接口检测到视频文件状态为 `unsupported`/`failed` 时自动修正为 `"success"` |
| 视频停在封面无法播放 | Starlette 0.37.2 的 `FileResponse` 不自动处理 HTTP Range 请求 | 手动解析 `Range` 请求头，使用 `StreamingResponse` 返回 206 Partial Content |
| 进度条无法拖动 | 同上，浏览器视频播放器必须通过 Range 请求实现拖动 | 同上 |
| `<video>` 标签无法携带认证头 | HTML5 `<video>` 标签不支持自定义 HTTP 请求头（如 `Authorization`） | 新增 `GET /files/{id}/stream?token=xxx` 接口，通过 URL query 参数接收 JWT token |

## 三、变更文件清单

### 后端（2 个文件修改）

| 文件 | 改动内容 | 改动量 |
|------|----------|--------|
| `backend/app/routers/files.py` | 上传逻辑：新增视频扩展名分支（`.mp4`/`.webm`/`.ogg`/`.mov` → `preview_status="success"`） | ~3 行 |
| `backend/app/routers/files.py` | `get_file` 接口：旧视频文件自动修复 `preview_status` | ~5 行 |
| `backend/app/routers/files.py` | 新增 `GET /{id}/stream?token=xxx` 流式播放接口（手动实现 HTTP Range / 206） | ~75 行 |
| `backend/app/routers/files.py` | 新增 import：`Request`、`StreamingResponse`、`jose.jwt` | ~3 行 |

### 前端（1 个文件修改）

| 文件 | 改动内容 | 改动量 |
|------|----------|--------|
| `frontend/src/pages/FilePreview.tsx` | 新增 `API_BASE_URL` 导入 | ~1 行 |
| `frontend/src/pages/FilePreview.tsx` | 新增 `VIDEO_EXTS` 常量 + `VideoPlayer` 组件（原生 `<video>` 标签） | ~25 行 |
| `frontend/src/pages/FilePreview.tsx` | 修改 blob 下载逻辑：视频文件跳过 blob 全量下载 | ~3 行 |
| `frontend/src/pages/FilePreview.tsx` | 修改 `renderPreview()`：新增视频分支判断 | ~5 行 |

### 新增依赖

无。全部基于浏览器原生能力和项目已有依赖实现。

## 四、API 接口说明

### `GET /api/files/{file_id}/stream?token={jwt_token}`

视频流式播放专用接口。

**请求参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_id` | int (path) | 文件 ID |
| `token` | string (query) | JWT 认证 token |

**请求头：**

| Header | 说明 |
|--------|------|
| `Range` | 可选，格式 `bytes=start-end`，浏览器视频播放器自动发送 |

**响应：**

| 场景 | 状态码 | Content-Type | 说明 |
|------|--------|--------------|------|
| 无 Range 请求 | 200 OK | video/mp4 | 返回完整文件流 |
| 有 Range 请求 | 206 Partial Content | video/mp4 | 返回指定字节范围，含 `Content-Range` 头 |

**验证命令：**

```bash
# 获取 token
TOKEN=$(cd backend && .venv/bin/python -c "
from app.config import settings
from jose import jwt
print(jwt.encode({'sub': '1'}, settings.JWT_SECRET, algorithm=settings.ALGORITHM))
")

# 测试 Range 请求（应返回 206）
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" \
  "http://127.0.0.1:9090/api/files/{FILE_ID}/stream?token=$TOKEN"
```

## 五、支持的视频格式

| 格式 | 浏览器兼容性 | 说明 |
|------|-------------|------|
| `.mp4` (H.264) | 全平台 | 最推荐，兼容性最好 |
| `.webm` (VP8/VP9) | Chrome / Firefox / Edge | Safari 部分支持 |
| `.ogg` | Chrome / Firefox | Safari 不支持 |
| `.mov` | 取决于内部编码 | 若内部是 H.264 则可以播放 |

**不支持的格式**（需要服务端转码，属于后续优化）：

| 格式 | 原因 |
|------|------|
| `.avi` | 浏览器无法解码 |
| `.mkv` | 大多数浏览器不支持 |

## 六、已知限制

1. **公网 5180 端口不可达**：外部浏览器无法访问 `http://113.59.125.17:5180`（内网 `192.168.9.168:5180` 正常），疑似 ISP 封锁入站端口。5181（后端）可达，建议临时将路由器端口映射改为 `8080 → 5180` 验证。
2. **不支持 `.avi` / `.mkv`**：需要后续引入 `ffmpeg` 进行服务端转码。
3. **视频不生成 AI 摘要**：当前 `generate_summary_and_index_task` 对视频文件的处理取决于 `document_parser.py` 中的支持列表，视频文件会被标记为 `summary_status="pending"` 但实际不会生成摘要。
