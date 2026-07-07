#!/bin/bash
# HAIKB 生产模式启动脚本 - build + backend + nginx
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "=========================================="
echo "  HAIKB 系统启动中 (生产模式)"
echo "=========================================="

if [ ! -f "$PROJECT_ROOT/haikb-backend.service" ]; then
    echo "❌ 未找到 haikb-backend.service"
    exit 1
fi

echo "📦 构建前端生产包..."
cd "$PROJECT_ROOT/frontend"
npm run build
cd "$PROJECT_ROOT"

echo "📥 安装 / 更新后端 systemd 服务..."
cp "$PROJECT_ROOT/haikb-backend.service" /etc/systemd/system/
systemctl daemon-reload

echo "🚀 启动后端服务..."
systemctl enable haikb-backend.service
systemctl restart haikb-backend.service

echo "⏳ 等待后端就绪..."
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9090/health" | grep -q "200"; then
        echo "✅ 后端已就绪"
        break
    fi
    sleep 1
done

echo "🔍 校验并重载 Nginx..."
nginx -t
nginx -s reload

if [ -f "$PROJECT_ROOT/haikb-daily-report.service" ] && [ -f "$PROJECT_ROOT/haikb-daily-report.timer" ]; then
    cp "$PROJECT_ROOT/haikb-daily-report.service" /etc/systemd/system/
    cp "$PROJECT_ROOT/haikb-daily-report.timer" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now haikb-daily-report.timer
    echo "📅 每日报告定时器已启用 (每天 09:00)"
fi

echo ""
echo "=========================================="
echo "  ✅ 生产模式已启动！"
echo ""
echo "  📊 服务状态："
echo "    systemctl status haikb-backend.service"
echo "    systemctl status nginx"
echo ""
echo "  📊 访问地址："
echo "    - 正式站点：http://kb.himice.com:5180"
echo "    - 健康检查：http://kb.himice.com:5180/health"
echo "    - 后端文档（本机）：http://127.0.0.1:9090/docs"
echo ""
echo "  📝 日志查看："
echo "    journalctl -u haikb-backend.service -f"
echo "    journalctl -u nginx -f"
echo "=========================================="
