#!/bin/bash
# HAIKB 启动脚本 - 优化版（带健康检查和进程清理）
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

# ==================== 端口和进程清理 ====================
echo ""
echo "🧹 清理旧进程和端口..."

# 强制停止所有相关进程
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "vite/bin/vite.js" 2>/dev/null || true
pkill -f "enterprise-knowledge-drive.*vite" 2>/dev/null || true
pkill -f "auto_logger.py" 2>/dev/null || true
pkill -f ".run_backend.sh" 2>/dev/null || true
pkill -f ".run_frontend.sh" 2>/dev/null || true
pkill -f "watchdog.sh" 2>/dev/null || true

# 清理 PID 文件
BACKEND_PID_FILE="$PROJECT_ROOT/backend.pid"
FRONTEND_PID_FILE="$PROJECT_ROOT/frontend.pid"
WATCHDOG_PID_FILE="$PROJECT_ROOT/watchdog.pid"
rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE" "$WATCHDOG_PID_FILE" "$PROJECT_ROOT/.run_backend.sh" "$PROJECT_ROOT/.run_frontend.sh"

# 等待进程终止
sleep 3

# 强制清理端口
for port in 5180 9090; do
    if ss -tulnp 2>/dev/null | grep -q ":$port "; then
        echo "⚠️  端口 $port 仍被占用，强制清理..."
        fuser -k -n tcp "$port" 2>/dev/null || true
    fi
done

# 再等待一下确保完全释放
sleep 2

echo "✅ 清理完成"

# ==================== 启动后端 ====================
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
echo "🚀 启动后端服务 (端口 9090)..."
export PYTHONIOENCODING=utf-8
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

# 创建临时启动脚本
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

# 等待后端启动并健康检查
echo "⏳ 等待后端服务就绪..."
BACKEND_READY=0
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9090/health" | grep -q "200"; then
        BACKEND_READY=1
        break
    fi
    echo "  等待中... ($i/30)"
    sleep 2
done

if [ $BACKEND_READY -eq 1 ]; then
    echo "✅ 后端已就绪 (PID: $BACKEND_PID)"
else
    echo "❌ 后端启动超时，请检查日志"
    # 不退出，继续尝试启动前端
fi

# 额外等待端口映射稳定
echo "⏳ 等待端口映射稳定..."
sleep 5

# ==================== 启动前端 ====================
echo ""
echo "🎨 启动前端服务..."
cd "$PROJECT_ROOT/frontend"

# 检查node_modules
if [ ! -d "node_modules" ]; then
    echo "⚠️  未找到 node_modules，正在安装依赖..."
    npm install
fi

# 后台启动前端
echo "🚀 启动前端服务 (端口 5180)..."

# 创建临时启动脚本
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

# 等待前端启动
echo "⏳ 等待前端服务就绪..."
sleep 5

if kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "✅ 前端已启动 (PID: $FRONTEND_PID)"
else
    echo "❌ 前端启动失败，检查日志"
    # 不退出
fi

# ==================== 启动看门狗 ====================
cd "$PROJECT_ROOT"

echo ""
echo "🐕 启动看门狗监控系统..."
chmod +x "$PROJECT_ROOT/watchdog.sh"

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
echo "    - 前端（公网）：http://113.59.125.17:5180"
echo "    - 前端（内网）：http://192.168.9.168:5180"
echo "    - 后端API（公网）：http://113.59.125.17:5181"
echo "    - 后端API（内网）：http://192.168.9.168:9090"
echo "    - 后端健康检查：http://113.59.125.17:5181/health"
echo "    - 后端文档：http://113.59.125.17:5181/docs"
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
