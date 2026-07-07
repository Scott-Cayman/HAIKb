#!/bin/bash
# HAIKB 生产模式状态查看脚本

echo "=========================================="
echo "  HAIKB 生产服务状态"
echo "=========================================="

echo ""
echo "📦 后端服务:"
systemctl status haikb-backend.service --no-pager || true

echo ""
echo "🌐 Nginx 服务:"
systemctl status nginx --no-pager || true

echo ""
echo "🔌 监听端口:"
ss -tulnp | grep -E ':5180\b|:9090\b' || true

echo ""
echo "📝 最近日志 (后端):"
journalctl -u haikb-backend.service -n 10 --no-pager || true

echo ""
echo "📝 最近日志 (Nginx):"
journalctl -u nginx -n 10 --no-pager || true
