#!/bin/bash
# HAIKB 生产模式状态查看脚本

echo "=========================================="
echo "  HAIKB 服务状态"
echo "=========================================="

echo ""
echo "📦 后端服务:"
systemctl status haikb-backend.service --no-pager || true

echo ""
echo "📦 前端服务:"
systemctl status haikb-frontend.service --no-pager || true

echo ""
echo "📝 最近日志 (后端):"
journalctl -u haikb-backend.service -n 10 --no-pager || true

echo ""
echo "📝 最近日志 (前端):"
journalctl -u haikb-frontend.service -n 10 --no-pager || true
