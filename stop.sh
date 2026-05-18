#!/bin/bash
# HAIKB 停止脚本
set -e

echo "=========================================="
echo "  HAIKB Agent + RAG 系统停止中"
echo "=========================================="

# 检查项目根目录
PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$PROJECT_ROOT"

BACKEND_PID_FILE="$PROJECT_ROOT/backend.pid"
FRONTEND_PID_FILE="$PROJECT_ROOT/frontend.pid"

# 停止后端
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "🔴 停止后端服务 (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo "⚠️  后端未停止，强制kill..."
            kill -9 "$BACKEND_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$BACKEND_PID_FILE"
    echo "✅ 后端已停止"
else
    echo "ℹ️  后端未运行"
fi

# 停止前端
if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo "🔴 停止前端服务 (PID: $FRONTEND_PID)..."
        # 杀掉进程及其所有子进程
        pkill -P "$FRONTEND_PID" 2>/dev/null || true
        kill "$FRONTEND_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$FRONTEND_PID" 2>/dev/null; then
            echo "⚠️  前端未停止，强制kill..."
            pkill -9 -P "$FRONTEND_PID" 2>/dev/null || true
            kill -9 "$FRONTEND_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$FRONTEND_PID_FILE"
    echo "✅ 前端已停止"
else
    echo "ℹ️  前端未运行"
fi

# 彻底清理所有相关进程
echo "🔧 清理残留进程..."
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "vite/bin/vite.js" 2>/dev/null || true
pkill -f "enterprise-knowledge-drive.*vite" 2>/dev/null || true

# 等待一下确保进程都结束
sleep 1

# 再次检查并强制清理
for port in {5180..5199}; do
    if ss -tulnp 2>/dev/null | grep -q ":$port "; then
        echo "⚠️  端口 $port 仍被占用，强制清理..."
        fuser -k -n tcp "$port" 2>/dev/null || true
    fi
done

echo ""
echo "=========================================="
echo "  ✅ 系统已停止！"
echo "=========================================="
