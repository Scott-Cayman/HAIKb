#!/usr/bin/env python3
"""
HAIKB 每日状态报告脚本
独立运行，不依赖后端业务代码。
由 systemd timer 每天 09:00 触发，通过钉钉工作通知发送给超级管理员。
"""

import os
import json
import sys
import subprocess
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

# 尝试导入 psutil（需提前安装）
try:
    import psutil
except ImportError:
    print("[ERROR] psutil 未安装，请执行: .venv/bin/pip install psutil~=5.9")
    sys.exit(1)

# 尝试导入 SQLAlchemy（已在 requirements.txt 中）
try:
    from sqlalchemy import create_engine, text
except ImportError:
    print("[ERROR] SQLAlchemy 未安装")
    sys.exit(1)


# ==================== 配置读取 ====================

def get_config(key: str, default: str = "") -> str:
    """
    从环境变量读取配置（由 systemd EnvironmentFile 注入）。
    systemd 不会自动去除 .env 中的内联注释（如 KEY=value  # comment），
    所以这里手动去除 # 后面的注释部分。
    """
    value = os.environ.get(key, default).strip()
    if not value:
        return value
    # 去除内联注释：找到 # 且前面有空格时截断
    if "  #" in value:
        value = value.split("  #", 1)[0].strip()
    elif " #" in value:
        value = value.split(" #", 1)[0].strip()
    return value


# ==================== 系统指标采集 ====================

def collect_system_metrics() -> dict:
    """采集 CPU、内存、磁盘使用率"""
    cpu_percent = psutil.cpu_percent(interval=2)
    memory = psutil.virtual_memory()
    # 磁盘：优先检测根分区
    disk = psutil.disk_usage("/")
    return {
        "cpu_percent": round(cpu_percent, 1),
        "memory_percent": round(memory.percent, 1),
        "disk_percent": round(disk.percent, 1),
        "disk_used_gb": round(disk.used / (1024 ** 3), 1),
        "disk_total_gb": round(disk.total / (1024 ** 3), 1),
    }


# ==================== 服务状态检查 ====================

def check_service_active(service_name: str) -> bool:
    """通过 systemctl 检查服务是否 active"""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", service_name],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip() == "active"
    except Exception:
        return False


def collect_service_status() -> dict:
    """采集后端、前端服务状态"""
    return {
        "backend": check_service_active("haikb-backend.service"),
        "frontend": check_service_active("haikb-frontend.service"),
    }


# ==================== 健康检查（纯 Python，不依赖 curl）====================

def check_backend_health(url: str = "http://127.0.0.1:9090/health", timeout: int = 3) -> bool:
    """请求后端 /health 端点，检查是否返回 200"""
    try:
        resp = urllib.request.urlopen(url, timeout=timeout)
        return resp.status == 200
    except Exception as e:
        print(f"[WARN] 健康检查失败: {e}")
        return False


# ==================== 业务数据统计（轻量 SQL 查询）====================

def get_database_url() -> str:
    """获取数据库连接 URL"""
    postgres_url = get_config("POSTGRES_URL")
    if postgres_url:
        return postgres_url
    pg_user = get_config("POSTGRES_USER")
    pg_pass = get_config("POSTGRES_PASSWORD")
    pg_host = get_config("POSTGRES_HOST", "127.0.0.1")
    pg_port = get_config("POSTGRES_PORT", "5432")
    pg_db = get_config("POSTGRES_DB")
    if pg_user and pg_db:
        return f"postgresql+psycopg2://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
    # fallback 到 SQLite
    db_path = get_config("DATABASE_URL", "sqlite:////home/HAIKB/enterprise-knowledge-drive/backend/data/app.db")
    return db_path


def collect_business_stats() -> dict:
    """轻量查询业务数据，不 import 后端应用"""
    stats = {"users_count": 0, "folders_count": 0, "files_count": 0, "super_admin_userids": []}
    try:
        engine = create_engine(get_database_url())
        with engine.connect() as conn:
            stats["users_count"] = conn.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0
            stats["folders_count"] = conn.execute(
                text("SELECT COUNT(*) FROM folders WHERE is_deleted = false")
            ).scalar() or 0
            stats["files_count"] = conn.execute(
                text("SELECT COUNT(*) FROM files WHERE is_deleted = false")
            ).scalar() or 0
            # 查询超级管理员的钉钉 userid
            rows = conn.execute(
                text("SELECT ding_userid FROM users WHERE is_super_admin = true AND ding_userid IS NOT NULL")
            ).fetchall()
            stats["super_admin_userids"] = [row[0] for row in rows if row[0]]
    except Exception as e:
        print(f"[ERROR] 数据库查询失败: {e}")
    return stats


# ==================== 接收人逻辑（三级 fallback，绝不发全员）====================

def get_receiver_userids(db_admin_ids: list) -> list:
    """
    确定钉钉通知接收人：
    1. 数据库中 is_super_admin=True 且 ding_userid 不为空的用户
    2. .env 中 DAILY_REPORT_USERIDS 配置的备用接收人
    3. 都没有则返回空列表（不发送）
    """
    # 第一优先：数据库超管
    if db_admin_ids:
        print(f"[INFO] 使用数据库超级管理员作为接收人: {db_admin_ids}")
        return db_admin_ids

    # 第二优先：.env 备用配置
    fallback = get_config("DAILY_REPORT_USERIDS")
    if fallback:
        ids = [uid.strip() for uid in fallback.split(",") if uid.strip()]
        if ids:
            print(f"[INFO] 使用 .env 备用接收人: {ids}")
            return ids

    # 第三：不发送
    print("[WARN] 未找到有效接收人，跳过钉钉通知")
    return []


# ==================== 钉钉 API ====================

def get_dingtalk_app_token(client_id: str, client_secret: str) -> str | None:
    """获取钉钉应用 app_access_token"""
    url = "https://oapi.dingtalk.com/gettoken"
    params = urllib.parse.urlencode({"appkey": client_id, "appsecret": client_secret})
    try:
        req = urllib.request.Request(f"{url}?{params}")
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data.get("access_token")
    except Exception as e:
        print(f"[ERROR] 获取钉钉 app_access_token 失败: {e}")
        return None


def send_dingtalk_work_notification(
    app_token: str, agent_id: str, userid_list: str, markdown_title: str, markdown_text: str
) -> bool:
    """调用钉钉工作通知 API 发送 Markdown 消息"""
    url = "https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2"
    payload = {
        "agent_id": agent_id,
        "userid_list": userid_list,
        "msg": {
            "msgtype": "markdown",
            "markdown": {
                "title": markdown_title,
                "text": markdown_text,
            }
        }
    }
    try:
        req = urllib.request.Request(
            f"{url}?access_token={app_token}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data.get("errcode") == 0:
                print(f"[INFO] 钉钉通知发送成功，task_id={data.get('task_id')}")
                return True
            else:
                print(f"[ERROR] 钉钉通知发送失败: errcode={data.get('errcode')}, errmsg={data.get('errmsg')}")
                return False
    except Exception as e:
        print(f"[ERROR] 钉钉通知请求异常: {e}")
        return False


# ==================== 报告格式化 ====================

def format_report_markdown(metrics: dict, services: dict, health_ok: bool, stats: dict) -> tuple[str, list]:
    """
    生成 Markdown 报告内容。
    返回: (markdown_text, anomalies_list)
    """
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    anomalies = []

    # 判断异常
    if metrics["cpu_percent"] > 85:
        anomalies.append(f"CPU 使用率 {metrics['cpu_percent']}%，超过阈值 85%")
    if metrics["memory_percent"] > 90:
        anomalies.append(f"内存使用率 {metrics['memory_percent']}%，超过阈值 90%")
    if metrics["disk_percent"] > 85:
        anomalies.append(f"磁盘使用率 {metrics['disk_percent']}%，超过阈值 85%")
    if not services["backend"]:
        anomalies.append("后端服务 (haikb-backend) 未运行")
    if not services["frontend"]:
        anomalies.append("前端服务 (haikb-frontend) 未运行")
    if not health_ok:
        anomalies.append("后端健康检查 (/health) 失败")

    overall_status = "✅ 一切正常" if not anomalies else "⚠️ 存在异常"

    def status_icon(ok: bool) -> str:
        return "✅" if ok else "⚠️"

    md = f"""## HAIKB 每日状态报告

**时间：** {now}
**总体状态：** {overall_status}

---

### 一、服务器状态

| 指标 | 数值 | 状态 |
|------|------|------|
| CPU | {metrics['cpu_percent']}% | {status_icon(metrics['cpu_percent'] <= 85)} |
| 内存 | {metrics['memory_percent']}% | {status_icon(metrics['memory_percent'] <= 90)} |
| 磁盘 | {metrics['disk_percent']}%（{metrics['disk_used_gb']}GB / {metrics['disk_total_gb']}GB）| {status_icon(metrics['disk_percent'] <= 85)} |

### 二、服务状态

| 服务 | 状态 |
|------|------|
| 后端 (haikb-backend) | {status_icon(services['backend'])} {'运行中' if services['backend'] else '未运行'} |
| 前端 (haikb-frontend) | {status_icon(services['frontend'])} {'运行中' if services['frontend'] else '未运行'} |
| 健康检查 (/health) | {status_icon(health_ok)} {'正常' if health_ok else '异常'} |

### 三、业务数据

| 指标 | 数值 |
|------|------|
| 用户总数 | {stats['users_count']} |
| 文件夹数 | {stats['folders_count']} |
| 文件总数 | {stats['files_count']} |

### 四、异常提示

"""
    if anomalies:
        for a in anomalies:
            md += f"- ⚠️ {a}\n"
    else:
        md += "暂无异常，系统运行良好。\n"

    return md, anomalies


# ==================== 主流程 ====================

def main():
    print(f"[{datetime.now()}] HAIKB 每日状态报告开始执行")

    # 1. 采集数据
    print("[INFO] 采集系统指标...")
    metrics = collect_system_metrics()

    print("[INFO] 采集服务状态...")
    services = collect_service_status()

    print("[INFO] 健康检查...")
    health_ok = check_backend_health()

    print("[INFO] 采集业务数据...")
    stats = collect_business_stats()

    # 2. 生成报告
    md_text, anomalies = format_report_markdown(metrics, services, health_ok, stats)
    print(f"[INFO] 报告生成完毕，异常数: {len(anomalies)}")

    # 3. 确定接收人
    receiver_ids = get_receiver_userids(stats.get("super_admin_userids", []))
    if not receiver_ids:
        print("[INFO] 无有效接收人，报告仅输出到日志：")
        print(md_text)
        return

    # 4. 发送钉钉通知
    client_id = get_config("DINGTALK_CLIENT_ID")
    client_secret = get_config("DINGTALK_CLIENT_SECRET")
    agent_id = get_config("DINGTALK_AGENT_ID")

    if not client_id or not client_secret or not agent_id:
        print("[ERROR] 钉钉应用配置缺失，无法发送通知")
        return

    app_token = get_dingtalk_app_token(client_id, client_secret)
    if not app_token:
        print("[ERROR] 无法获取钉钉 app_access_token")
        return

    userid_list = ",".join(receiver_ids)
    title = "HAIKB 每日状态报告"
    if anomalies:
        title = "⚠️ HAIKB 每日状态报告（存在异常）"

    send_dingtalk_work_notification(app_token, agent_id, userid_list, title, md_text)

    print(f"[{datetime.now()}] 每日状态报告执行完毕")


if __name__ == "__main__":
    main()
