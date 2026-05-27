#!/bin/bash
# HAIKB 启动脚本 - 简化版
set -e

echo "=========================================="
echo "  HAIKB Agent + RAG 系统启动中"
echo "=========================================="

# 检查项目根目录
PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$PROJECT_ROOT"

echo "📦 项目根目录: $PROJECT_ROOT"

# 确保 auto_logger.py 可执行
chmod +x "$PROJECT_ROOT/auto_logger.py"

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
    echo "🚀 启动后端服务 (端口 9090)..."
    export PYTHONIOENCODING=utf-8
    export LC_ALL=en_US.UTF-8
    export LANG=en_US.UTF-8
    
    # 简单直接的方式启动：创建临时启动脚本
    cat > "$PROJECT_ROOT/.run_backend.sh" <<EOF
#!/bin/bash
cd "$PROJECT_ROOT/backend"
exec .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 9090 2>&1
EOF
    chmod +x "$PROJECT_ROOT/.run_backend.sh"
    
    # 启动并记录主进程
    nohup "$PROJECT_ROOT/.run_backend.sh" 2>&1 | python3 "$PROJECT_ROOT/auto_logger.py" backend "$PROJECT_ROOT" &
    BACKEND_PID=$!
    echo $BACKEND_PID > "$BACKEND_PID_FILE"
    
    # 等待一下让进程启动
    sleep 2
    
    # 检查进程是否还在运行
    if kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "✅ 后端已启动 (PID: $BACKEND_PID)"
    else
        echo "❌ 后端启动失败，检查日志"
        rm -f "$BACKEND_PID_FILE"
        exit 1
    fi
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
    
    # 简单直接的方式启动：创建临时启动脚本
    cat > "$PROJECT_ROOT/.run_frontend.sh" <<EOF
#!/bin/bash
cd "$PROJECT_ROOT/frontend"
exec npm run dev 2>&1
EOF
    chmod +x "$PROJECT_ROOT/.run_frontend.sh"
    
    # 启动并记录主进程
    nohup "$PROJECT_ROOT/.run_frontend.sh" 2>&1 | python3 "$PROJECT_ROOT/auto_logger.py" frontend "$PROJECT_ROOT" &
    FRONTEND_PID=$!
    echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
    
    # 等待一下让进程启动
    sleep 2
    
    # 检查进程是否还在运行
    if kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo "✅ 前端已启动 (PID: $FRONTEND_PID)"
    else
        echo "❌ 前端启动失败，检查日志"
        rm -f "$FRONTEND_PID_FILE"
        # 不退出，继续尝试启动
    fi
else
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    echo "✅ 前端已运行 (PID: $FRONTEND_PID)"
fi

cd "$PROJECT_ROOT"

echo ""
echo "🐕 启动看门狗监控系统..."
chmod +x "$PROJECT_ROOT/watchdog.sh"
WATCHDOG_PID_FILE="$PROJECT_ROOT/watchdog.pid"
if [ -f "$WATCHDOG_PID_FILE" ]; then
    WATCHDOG_PID=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
    if kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        echo "⚠️  看门狗已在运行 (PID: $WATCHDOG_PID)"
    else
        rm -f "$WATCHDOG_PID_FILE"
    fi
fi
if [ ! -f "$WATCHDOG_PID_FILE" ]; then
    nohup "$PROJECT_ROOT/watchdog.sh" >/dev/null 2>&1 &
    WATCHDOG_PID=$!
    echo $WATCHDOG_PID > "$WATCHDOG_PID_FILE"
    sleep 2
    if kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        echo "✅ 看门狗已启动 (PID: $WATCHDOG_PID)"
    else
        echo "❌ 看门狗启动失败"
        rm -f "$WATCHDOG_PID_FILE"
    fi
fi

echo ""
echo "=========================================="
echo "  ✅ 系统已启动！"
echo ""
echo "  📊 访问地址："
echo "    - 前端：http://localhost:5180"
echo "    - 后端API：http://localhost:9090"
echo "    - 后端文档：http://localhost:9090/docs"
echo ""
echo "  📝 日志文件（自动按天切换）："
echo "    - 后端：$PROJECT_ROOT/logs/backend/backend-YYYY-MM-DD.log"
echo "    - 前端：$PROJECT_ROOT/logs/frontend/frontend-YYYY-MM-DD.log"
echo "    - 看门狗：$PROJECT_ROOT/logs/watchdog/watchdog-YYYY-MM-DD.log"
echo ""
echo "  🔍 检查进程："
echo "    - 看门狗: ps aux | grep watchdog.sh"
echo "    - 后端: ps aux | grep uvicorn"
echo "    - 前端: ps aux | grep vite"
echo ""
echo "  ⚠️  停止请运行：./stop.sh"
echo "  🐕  停止看门狗：./stop_watchdog.sh"
echo "=========================================="
