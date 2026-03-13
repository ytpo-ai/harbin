#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

FRONTEND_PORT=3000
ENV=${1:-development}

wait_for_service() {
    local port=$1
    local name=$2
    local max_attempts=30
    local attempt=1

    echo "等待 $name (端口 $port) 启动..."
    while ! lsof -i :$port > /dev/null 2>&1; do
        sleep 1
        attempt=$((attempt + 1))
        if [ $attempt -gt $max_attempts ]; then
            echo "警告: $name 启动超时"
            return 1
        fi
    done
    echo "$name 已启动 (端口 $port)"
}

echo "ytpo-ai 重启脚本"
echo "========================================"
echo "重启环境: $ENV"

echo "1/3 重启后端服务..."
bash "$SCRIPT_DIR/backend/reload.sh"

echo "========================================"
echo "2/3 重启前端服务 (端口 $FRONTEND_PORT)..."

lsof -ti :$FRONTEND_PORT 2>/dev/null | xargs -r kill
sleep 1

cd "$SCRIPT_DIR/frontend"
nohup pnpm run dev > "$LOG_DIR/frontend-app.log" 2>&1 &
wait_for_service $FRONTEND_PORT "frontend"

echo "========================================"
echo "3/3 服务监听状态"
lsof -nP -i :3000 -i :3001 -i :3002 -i :3003 -i :3004 -i :3100 -i :3201 | grep LISTEN

echo "========================================"
echo "重启完成"
echo "日志文件: $LOG_DIR/frontend-app.log"
