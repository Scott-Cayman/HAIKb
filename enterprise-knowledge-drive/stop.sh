#!/bin/bash
# HAIKB 停止脚本 - 增强版
set +e

echo "=========================================="
echo "  HAIKB Agent + RAG 系统停止中"
echo "=========================================="

# 检查项目根目录
PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$PROJECT_ROOT"

BACKEND_PID_FILE="$PROJECT_ROOT/backend.pid"
FRONTEND_PID_FILE="$PROJECT_ROOT/frontend.pid"

# 先停止看门狗
WATCHDOG_PID_FILE="$PROJECT_ROOT/watchdog.pid"
if [ -f "$WATCHDOG_PID_FILE" ]; then
    WATCHDOG_PID=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
    if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        echo "🐕 停止看门狗服务 (PID: $WATCHDOG_PID)..."
        kill "$WATCHDOG_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$WATCHDOG_PID" 2>/dev/null; then
            echo "⚠️  看门狗未停止，强制kill..."
            kill -9 "$WATCHDOG_PID" 2>/dev/null || true
        fi
    fi
    rm -f "$WATCHDOG_PID_FILE"
    echo "✅ 看门狗已停止"
else
    echo "ℹ️  看门狗未运行"
fi

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
        kill "$FRONTEND_PID" 2>/dev/null || true
        sleep 2
        if kill -0 "$FRONTEND_PID" 2>/dev/null; then
            echo "⚠️  前端未停止，强制kill..."
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
pkill -f "auto_logger.py" 2>/dev/null || true
pkill -f ".run_backend.sh" 2>/dev/null || true
pkill -f ".run_frontend.sh" 2>/dev/null || true
pkill -f "watchdog.sh" 2>/dev/null || true

# 清理临时文件
rm -f "$PROJECT_ROOT/.run_backend.sh" "$PROJECT_ROOT/.run_frontend.sh" 2>/dev/null || true

# 等待一下确保进程都结束
sleep 1

# 再次检查并强制清理
for port in {5180..5199} {9090..9099}; do
    if ss -tulnp 2>/dev/null | grep -q ":$port "; then
        echo "⚠️  端口 $port 仍被占用，强制清理..."
        fuser -k -n tcp "$port" 2>/dev/null || true
    fi
done

echo ""
echo "=========================================="
echo "  ✅ 系统已停止！"
echo "=========================================="
