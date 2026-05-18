#!/bin/bash
# HAIKB 启动脚本
set -e

echo "=========================================="
echo "  HAIKB Agent + RAG 系统启动中"
echo "=========================================="

# 检查项目根目录
PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$PROJECT_ROOT"

echo "📦 项目根目录: $PROJECT_ROOT"

# 启动后端
echo ""
echo "🔧 启动后端服务..."
cd "$PROJECT_ROOT/backend"
if [ ! -d ".venv" ]; then
    echo "⚠️  未找到 Python 虚拟环境，正在创建..."
    python3 -m venv .venv
    echo "✅ 虚拟环境创建成功，正在安装依赖..."
    .venv/bin/python -m pip install -r requirements.txt
fi

# 检查数据库并确保schema存在
if [ ! -f "data/app.db" ]; then
    echo "⚠️  数据库不存在，正在初始化..."
    mkdir -p data storage/previews storage/summaries storage/rag/vectors storage/rag/docs storage/originals
    .venv/bin/python -c "
import sys
sys.path.insert(0, '.')
from app.main import Base, engine
Base.metadata.create_all(bind=engine)
from app.rag.index_manager import index_manager
index_manager.on_application_startup()
print('✅ 数据库初始化成功')
"
fi

# 后台启动后端
BACKEND_PID_FILE="$PROJECT_ROOT/backend.pid"
if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE" 2>/dev/null || true)
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "⚠️  后端已在运行 (PID: $BACKEND_PID)"
    else
        rm -f "$BACKEND_PID_FILE"
    fi
fi

if [ ! -f "$BACKEND_PID_FILE" ]; then
    echo "🚀 启动后端服务 (端口 8080)..."
    nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8080 > "$PROJECT_ROOT/backend.log" 2>&1 < /dev/null &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$BACKEND_PID_FILE"
    echo "✅ 后端已启动 (PID: $BACKEND_PID)"
else
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    echo "✅ 后端已运行 (PID: $BACKEND_PID)"
fi

# 启动前端
echo ""
echo "🎨 启动前端服务..."
cd "$PROJECT_ROOT/frontend"

# 检查node_modules
if [ ! -d "node_modules" ]; then
    echo "⚠️  未找到 node_modules，正在安装依赖..."
    npm install
fi

# 后台启动前端
FRONTEND_PID_FILE="$PROJECT_ROOT/frontend.pid"
if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE" 2>/dev/null || true)
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo "⚠️  前端已在运行 (PID: $FRONTEND_PID)"
    else
        rm -f "$FRONTEND_PID_FILE"
    fi
fi

if [ ! -f "$FRONTEND_PID_FILE" ]; then
    echo "🚀 启动前端服务 (端口 5180)..."
    nohup npm run dev > "$PROJECT_ROOT/frontend.log" 2>&1 < /dev/null &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
    echo "✅ 前端已启动 (PID: $FRONTEND_PID)"
else
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    echo "✅ 前端已运行 (PID: $FRONTEND_PID)"
fi

cd "$PROJECT_ROOT"

echo ""
echo "=========================================="
echo "  ✅ 系统已启动！"
echo ""
echo "  📊 访问地址："
echo "    - 前端：http://localhost:5180"
echo "    - 后端API：http://localhost:8080"
echo "    - 后端文档：http://localhost:8080/docs"
echo ""
echo "  📝 日志文件："
echo "    - 后端：$PROJECT_ROOT/backend.log"
echo "    - 前端：$PROJECT_ROOT/frontend.log"
echo ""
echo "  ⚠️  停止请运行：./stop.sh"
echo "=========================================="
