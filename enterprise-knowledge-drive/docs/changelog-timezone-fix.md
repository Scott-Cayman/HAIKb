# 更新日志：修复数据库时间戳时区偏移问题

**日期：** 2026-07-03
**作者：** 系统自动生成
**影响范围：** 后端 Model 层 + API 序列化，前端无需改动

---

## 一、问题描述

知识库系统中所有时间字段（如文件上传时间、文件夹创建时间、用户登录时间等）在前端显示时，比实际系统时间**慢约 8 小时**，跨日场景下显示为"前一天"。

## 二、根因分析

SQLite 的 `CURRENT_TIMESTAMP` / `func.now()` 始终返回 **UTC 时间且不带时区标识**（naive datetime）。

| 环节 | 实际值 | 问题 |
|------|--------|------|
| 系统时间 (CST, UTC+8) | `2026-07-03 10:38:59` | 正确 |
| SQLite `CURRENT_TIMESTAMP` | `2026-07-03 02:38:59` | UTC，无时区标记 |
| API JSON 输出 | `2026-07-03T02:39:39` | 无时区后缀，前端无法判断时区 |
| 前端 `new Date()` 解析 | `2026-07-03T02:39:39` 当作 CST | 误判为本地时间，比真实慢 8 小时 |
| 跨日场景（如 08:00 前） | UTC 还在"昨天" | 前端显示少一天 |

**受影响的代码：**
- 所有 Model 使用 `DateTime(timezone=True)` + `server_default=func.now()`
- `admin.py` 中 `_get_time_filter()` 使用已废弃的 `datetime.utcnow()`（naive UTC）

## 三、修复方案

### 核心思路

创建 SQLAlchemy 自定义类型 `AwareDateTime`，在从 SQLite 读取 naive datetime 时自动附加 UTC 时区。API 序列化输出从 `2026-07-03T02:39:39` 变为 `2026-07-03T02:39:39+00:00`，前端 `new Date()` 即可正确识别为 UTC 并自动转换为本地时间。

### 为什么此方案最优

- **改动最小**：仅替换列类型声明，不改写入逻辑
- **向后兼容**：SQLite 中存储的数据格式不变，仅读取时附加时区
- **前端零改动**：`new Date()` 原生支持带时区的 ISO 8601 字符串
- **未来友好**：若迁移到 PostgreSQL，`AwareDateTime` 也能正确处理

## 四、新增文件

| 文件 | 说明 |
|------|------|
| `backend/app/models/types.py` | 自定义 SQLAlchemy 类型 `AwareDateTime`（约 25 行） |

## 五、修改文件

| 文件 | 改动内容 |
|------|----------|
| `backend/app/models/user.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/folder.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/file.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/setting.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/audit_log.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/document_summary.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/folder_summary.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/rag_index.py` | `DateTime(timezone=True)` → `AwareDateTime`（4 处） |
| `backend/app/models/agent_message.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/favorite.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/permission.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/models/user_file_view.py` | `DateTime(timezone=True)` → `AwareDateTime` |
| `backend/app/routers/admin.py` | `datetime.utcnow()` → `datetime.now(timezone.utc)` |

## 六、技术设计要点

### 6.1 AwareDateTime 实现

```python
class AwareDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value
```

- 继承 `TypeDecorator`，不破坏 SQLAlchemy 原生 `DateTime` 的行为
- 仅在 `process_result_value`（读取）阶段附加时区，写入阶段保持不变
- `cache_ok = True` 消除 SQLAlchemy 的缓存警告

### 6.2 admin.py 时间过滤修复

- 旧代码：`datetime.utcnow()` 返回 naive datetime，Python 3.12+ 已标记废弃
- 新代码：`datetime.now(timezone.utc)` 返回 aware datetime，与 Model 列类型一致

### 6.3 前端兼容验证

| API 输出（修复前） | 前端解析 | 显示结果 |
|---|---|---|
| `2026-07-03T02:39:39` | `new Date()` 当作 CST 02:39 | 错误，慢 8 小时 |
| `2026-07-03T02:39:39+00:00` | `new Date()` 正确转换为 CST 10:39 | 正确 |

## 七、验证步骤

```bash
# 1. 重启后端服务
./restart_prod.sh

# 2. 验证 API 返回带时区的时间
curl -s http://localhost:9090/api/folders/<id>/files | python3 -m json.tool | grep created_at
# 预期输出类似: "created_at": "2026-07-03T02:39:39+00:00"

# 3. 前端访问任意文件夹，确认文件上传时间显示正确
```

## 八、不涉及的范围

- 前端代码：零改动，`formatDate` / `formatTime` 函数天然兼容
- 数据库数据：不需要迁移，已有数据在读取时自动附加时区
- 每日报告脚本：`daily_report.py` 使用 `datetime.now()`（本地时间），不受影响
