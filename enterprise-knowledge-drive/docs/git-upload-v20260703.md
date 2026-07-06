# Git 版本推送记录：v2026-07-03

**日期：** 2026-07-03
**操作人：** 本地执行
**远程仓库：** `git@github.com:Scott-Cayman/HAIKb.git`
**分支：** `main`
**提交哈希：** `3d5245d`
**父提交：** `1f87890` (chore: backup current changes before unified search refactor)

---

## 一、版本更新说明

校准了时区，增加了自动巡检、优化了上传的超时时间。

### 具体变更内容

| 变更项 | 说明 |
|--------|------|
| 时区校准 | 自定义 `AwareDateTime` 类型，修复 SQLite 返回 UTC naive datetime 导致前端时间显示偏移 8 小时的问题 |
| 自动巡检 | 新增 `daily_report.py` 脚本 + systemd timer，每天 09:00 自动采集服务器状态并通过钉钉通知管理员 |
| 上传超时优化 | 优化文件上传的超时时间设置，提升大文件上传稳定性 |
| 生产环境部署 | 新增 `start_prod.sh`、`stop_prod.sh`、`restart_prod.sh`、`status_prod.sh` 等运维脚本 |
| systemd 服务 | 新增 `haikb-backend.service`、`haikb-frontend.service`、`haikb-daily-report.service`、`haikb-daily-report.timer` |
| README 更新 | 更新部署文档，补充生产环境部署说明 |

## 二、提交文件清单

### 新增文件（13 个）

| 文件 | 说明 |
|------|------|
| `backend/app/models/types.py` | 自定义 SQLAlchemy 类型 `AwareDateTime` |
| `backend/scripts/daily_report.py` | 每日状态报告脚本（约 349 行） |
| `docs/changelog-daily-report.md` | 自动巡检功能变更日志 |
| `docs/changelog-timezone-fix.md` | 时区修复变更日志 |
| `haikb-backend.service` | 后端 systemd 服务文件 |
| `haikb-frontend.service` | 前端 systemd 服务文件 |
| `haikb-daily-report.service` | 日报 systemd oneshot 服务 |
| `haikb-daily-report.timer` | 日报 systemd 定时器 |
| `restart_prod.sh` | 生产环境重启脚本 |
| `start_prod.sh` | 生产环境启动脚本 |
| `status_prod.sh` | 生产环境状态查看脚本 |
| `stop_prod.sh` | 生产环境停止脚本 |

### 修改文件（19 个）

| 文件 | 改动内容 |
|------|----------|
| `README.md` | 更新部署文档（+228 行） |
| `backend/app/models/agent_message.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/audit_log.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/document_summary.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/favorite.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/file.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/folder.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/folder_summary.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/permission.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/rag_index.py` | `DateTime` → `AwareDateTime`（4 处） |
| `backend/app/models/setting.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/user.py` | `DateTime` → `AwareDateTime` |
| `backend/app/models/user_file_view.py` | `DateTime` → `AwareDateTime` |
| `backend/app/routers/admin.py` | `datetime.utcnow()` → `datetime.now(timezone.utc)` |
| `backend/app/routers/files.py` | 优化上传超时设置 |
| `backend/requirements.txt` | 新增 `psutil~=5.9` 依赖 |
| `frontend/src/layouts/MainLayout.tsx` | 前端布局调整 |
| `frontend/src/pages/FolderDetail.tsx` | 文件夹详情页调整 |
| `frontend/src/pages/Home.tsx` | 首页功能增强 |

### 删除文件（2 个）

| 文件 | 说明 |
|------|------|
| `.run_backend.sh` | 旧版开发启动脚本（已由 systemd 服务替代） |
| `.run_frontend.sh` | 旧版开发启动脚本（已由 systemd 服务替代） |

## 三、执行命令记录

```bash
# 1. 查看当前状态
cd /home/HAIKB/enterprise-knowledge-drive
git status

# 2. 查看变更概览
git diff --stat

# 3. 暂存并提交
git add -A
git commit -m "校准了时区，增加了自动巡检、优化了上传的超时时间
- 校准服务时区配置
- 新增自动巡检脚本（daily_report.py）及 systemd timer 服务
- 优化文件上传超时时间设置
- 新增生产环境部署脚本和 systemd 服务文件
- 更新 README 部署文档"

# 4. 推送到远程
git push
```

## 四、推送结果

```
Enumerating objects: 76, done.
Counting objects: 100% (76/76), done.
Delta compression using up to 28 threads
Compressing objects: 100% (45/45), done.
Writing objects: 100% (45/45), 20.55 KiB | 10.28 MiB/s, done.
Total 45 (delta 30), reused 0 (delta 0), pack-reused 0
remote: Resolving deltas: 100% (30/30), completed with 28 local objects.
To github.com:Scott-Cayman/HAIKb.git
   1f87890..3d5245d  main -> main
```

## 五、关联文档

- [时区修复变更日志](./changelog-timezone-fix.md)
- [自动巡检功能变更日志](./changelog-daily-report.md)
