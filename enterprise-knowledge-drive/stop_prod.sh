#!/bin/bash
# HAIKB 生产模式停止脚本 - systemd 管理
set +e

echo "=========================================="
echo "  HAIKB 系统停止中 (生产模式)"
echo "=========================================="

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🛑 停止服务..."
systemctl stop haikb-backend.service 2>/dev/null || true

# 停止每日报告定时器
systemctl stop haikb-daily-report.timer 2>/dev/null || true
systemctl disable haikb-daily-report.timer 2>/dev/null || true

echo ""
echo "=========================================="
echo "  ✅ 生产模式已停止！"
echo "  ℹ️  Nginx 未停止，其他站点不受影响"
echo "=========================================="
