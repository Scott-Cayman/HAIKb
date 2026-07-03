#!/bin/bash
# HAIKB 生产模式重启脚本 - systemd 管理

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "🔄 重启后端..."
systemctl restart haikb-backend.service

echo "⏳ 等待后端就绪..."
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9090/health" | grep -q "200"; then
        echo "✅ 后端已就绪"
        break
    fi
    sleep 1
done

echo "🔄 重启前端..."
systemctl restart haikb-frontend.service

echo ""
echo "✅ 重启完成！"
echo "  - 前端：http://113.59.125.17:5180"
echo "  - 后端API：http://113.59.125.17:5181"
