#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

ENV=${1:-development}

if [ "$ENV" = "development" ]; then
    WATCH_ARG="--watch"
    echo "开发模式: 启动后端服务（watch 已开启）"
else
    WATCH_ARG=""
    echo "非开发模式: 启动后端服务（watch 未开启）"
fi

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

echo "========================================"
echo "1/5 启动 legacy 服务 (端口 3001)..."
if [ -n "$WATCH_ARG" ]; then
    pnpm run start:legacy -- --watch </dev/null > "$LOG_DIR/legacy-app.log" 2>&1 &
else
    nohup pnpm run start:legacy > "$LOG_DIR/legacy-app.log" 2>&1 &
fi
wait_for_service 3001 "legacy"

echo "========================================"
echo "2/5 启动 gateway 服务 (端口 3100)..."
if [ -n "$WATCH_ARG" ]; then
    pnpm run start:gateway -- --watch </dev/null > "$LOG_DIR/gateway-app.log" 2>&1 &
else
    nohup pnpm run start:gateway > "$LOG_DIR/gateway-app.log" 2>&1 &
fi
wait_for_service 3100 "gateway"

echo "========================================"
echo "3/5 启动 agents 服务 (端口 3002)..."
if [ -n "$WATCH_ARG" ]; then
    pnpm run start:agents -- --watch </dev/null > "$LOG_DIR/agents-app.log" 2>&1 &
else
    nohup pnpm run start:agents > "$LOG_DIR/agents-app.log" 2>&1 &
fi
wait_for_service 3002 "agents"

echo "========================================"
echo "4/5 启动 ws 服务 (端口 3003)..."
if [ -n "$WATCH_ARG" ]; then
    pnpm run start:ws -- --watch </dev/null > "$LOG_DIR/ws-app.log" 2>&1 &
else
    nohup pnpm run start:ws > "$LOG_DIR/ws-app.log" 2>&1 &
fi
wait_for_service 3003 "ws"

echo "========================================"
echo "5/5 启动 ei 服务 (端口 3004)..."
if [ -n "$WATCH_ARG" ]; then
    pnpm run start:ei -- --watch </dev/null > "$LOG_DIR/ei-app.log" 2>&1 &
else
    nohup pnpm run start:ei > "$LOG_DIR/ei-app.log" 2>&1 &
fi
wait_for_service 3004 "ei"

echo "========================================"
echo "后端服务已启动，日志文件位于: $LOG_DIR"
echo "- $LOG_DIR/legacy-app.log"
echo "- $LOG_DIR/gateway-app.log"
echo "- $LOG_DIR/agents-app.log"
echo "- $LOG_DIR/ws-app.log"
echo "- $LOG_DIR/ei-app.log"
