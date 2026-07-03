#!/bin/bash
# HAIKB 生产模式启动脚本 - systemd 管理
set -e

echo "=========================================="
echo "  HAIKB 系统启动中 (生产模式)"
echo "=========================================="

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# 检查 systemd service 文件是否存在
if [ ! -f "$PROJECT_ROOT/haikb-backend.service" ] || [ ! -f "$PROJECT_ROOT/haikb-frontend.service" ]; then
    echo "❌ systemd service 文件不存在，请先执行安装脚本"
    exit 1
fi

# 停止开发模式进程
echo "🧹 清理开发模式进程..."
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "auto_logger.py" 2>/dev/null || true
sleep 2

# 卸载旧服务
echo "📦 卸载旧服务..."
systemctl stop haikb-backend.service 2>/dev/null || true
systemctl stop haikb-frontend.service 2>/dev/null || true
systemctl disable haikb-backend.service 2>/dev/null || true
systemctl disable haikb-frontend.service 2>/dev/null || true
rm -f /etc/systemd/system/haikb-backend.service
rm -f /etc/systemd/system/haikb-frontend.service
systemctl daemon-reload

# 安装服务
echo "📥 安装 systemd 服务..."
cp "$PROJECT_ROOT/haikb-backend.service" /etc/systemd/system/
cp "$PROJECT_ROOT/haikb-frontend.service" /etc/systemd/system/
systemctl daemon-reload

# 启用并启动服务
echo "🚀 启动服务..."
systemctl enable haikb-backend.service
systemctl start haikb-backend.service

# 等待后端就绪
echo "⏳ 等待后端就绪..."
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9090/health" | grep -q "200"; then
        echo "✅ 后端已就绪"
        break
    fi
    sleep 1
done

systemctl enable haikb-frontend.service
systemctl start haikb-frontend.service

echo ""
echo "=========================================="
echo "  ✅ 生产模式已启动！"
echo ""
echo "  📊 服务状态："
echo "    systemctl status haikb-backend.service"
echo "    systemctl status haikb-frontend.service"
echo ""
echo "  📊 访问地址："
echo "    - 前端：http://113.59.125.17:5180"
echo "    - 后端API：http://113.59.125.17:5181"
echo "    - 后端文档：http://113.59.125.17:5181/docs"
echo ""
echo "  📝 日志查看："
echo "    journalctl -u haikb-backend.service -f"
echo "    journalctl -u haikb-frontend.service -f"
echo ""
# 安装每日报告定时器
if [ -f "$PROJECT_ROOT/haikb-daily-report.service" ] && [ -f "$PROJECT_ROOT/haikb-daily-report.timer" ]; then
    cp "$PROJECT_ROOT/haikb-daily-report.service" /etc/systemd/system/
    cp "$PROJECT_ROOT/haikb-daily-report.timer" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now haikb-daily-report.timer
    echo "📅 每日报告定时器已启用 (每天 09:00)"
fi

echo "  ⚠️  切换开发模式：./start.sh"
echo "=========================================="
