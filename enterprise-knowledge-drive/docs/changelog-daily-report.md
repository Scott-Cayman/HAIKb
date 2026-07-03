# 更新日志：每日状态报告 + 钉钉通知

**日期：** 2026-07-02
**作者：** 系统自动生成
**影响范围：** 新增功能，不改现有业务代码

---

## 一、功能概述

新增「每日状态报告」功能，通过 systemd timer 每天 09:00 自动执行独立 Python 脚本，采集服务器指标、服务状态和业务数据，生成 Markdown 格式报告并通过钉钉工作通知发送给超级管理员。

## 二、新增文件

| 文件 | 说明 |
|------|------|
| `backend/scripts/daily_report.py` | 独立日报脚本（约 270 行），不依赖后端业务代码 |
| `haikb-daily-report.service` | systemd oneshot 服务，通过 EnvironmentFile 加载 .env |
| `haikb-daily-report.timer` | systemd 定时器，每天 09:00 触发，支持 Persistent 补发 |

## 三、修改文件

| 文件 | 改动内容 |
|------|----------|
| `backend/requirements.txt` | 新增依赖 `psutil~=5.9` |
| `start_prod.sh` | 末尾追加 timer 安装逻辑（+8 行） |
| `stop_prod.sh` | 追加 timer 停止逻辑（+3 行） |

## 四、技术设计要点

### 4.1 接收人逻辑（三级 fallback，绝不发全员）

1. **优先：** 数据库查询 `is_super_admin=True` 且 `ding_userid IS NOT NULL` 的用户
2. **备用：** 读取 `.env` 中 `DAILY_REPORT_USERIDS=userid1,userid2`
3. **兜底：** 两者都无有效接收人时，不发送钉钉消息，仅记录日志

### 4.2 脚本独立性

- 不 import `app.main` 或任何后端业务模块
- 使用原生 SQLAlchemy + `text()` 做轻量 SQL 查询
- 健康检查使用 `urllib.request`（标准库），不依赖 curl
- HTTP 请求全部使用标准库，不依赖 httpx

### 4.3 .env 内联注释兼容

- systemd 的 `EnvironmentFile` 不会自动去除 `.env` 中的内联注释
- 脚本 `get_config()` 函数手动去除 `# comment` 部分

### 4.4 systemd 配置

- `EnvironmentFile` 同时加载根目录和 backend 目录的 `.env`
- `TimeoutStartSec=60` 防止脚本卡死
- `Persistent=true` 确保服务器重启后补发错过的报告

## 五、报告内容结构

```markdown
## HAIKB 每日状态报告
**时间：** YYYY-MM-DD 09:00
**总体状态：** ✅ 一切正常 / ⚠️ 存在异常

### 一、服务器状态
CPU、内存、磁盘使用率（含阈值判定）

### 二、服务状态
haikb-backend、haikb-frontend、/health 端点

### 三、业务数据
用户总数、文件夹数、文件总数

### 四、异常提示
具体问题列表 / "暂无异常"
```

### 异常判定阈值

| 指标 | 阈值 |
|------|------|
| CPU 使用率 | > 85% |
| 内存使用率 | > 90% |
| 磁盘使用率 | > 85% |
| 服务状态 | 非 active |
| 健康检查 | 超时或非 200 |

## 六、新增 .env 配置项（可选）

```env
DAILY_REPORT_USERIDS=          # 备用接收人钉钉userid列表，逗号分隔
```

## 七、运维命令

```bash
# 手动触发一次
sudo systemctl start haikb-daily-report.service

# 查看执行日志
sudo journalctl -u haikb-daily-report.service -n 50 --no-pager

# 查看定时器下次触发时间
systemctl list-timers haikb-daily-report.timer --no-pager

# 查看定时器状态
systemctl status haikb-daily-report.timer --no-pager

# 直接运行脚本（调试用，需先 source .env）
cd /home/HAIKB/enterprise-knowledge-drive/backend
set -a && source .env && set +a
.venv/bin/python scripts/daily_report.py
```

## 八、验证记录

| 时间 | 方式 | 结果 |
|------|------|------|
| 2026-07-02 14:49 | 手动运行脚本（source .env） | ✅ 发送成功，task_id=3419609665915 |
| 2026-07-02 14:55 | systemd 触发（首次） | ❌ 钉钉 token 失败（.env 内联注释问题） |
| 2026-07-02 14:56 | systemd 触发（修复后） | ✅ 发送成功，task_id=3413480679801 |

**修复问题：** `.env` 中存在 `KEY=value  # comment` 格式的内联注释，systemd `EnvironmentFile` 不会自动去除，导致 `DINGTALK_CLIENT_ID` 等值包含注释文本。已在 `get_config()` 中增加注释清洗逻辑。
