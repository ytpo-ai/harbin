#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

usage() {
    echo "用法: $0 [environment] [-p|--port <port>]"
    echo "示例: $0 development"
    echo "示例: $0 development -p 3002"
}

ENV="development"
ENV_SET=0
TARGET_PORT=""

while [ $# -gt 0 ]; do
    case "$1" in
        -p|--port)
            if [ -z "$2" ]; then
                echo "错误: -p|--port 需要端口参数"
                usage
                exit 1
            fi
            TARGET_PORT="$2"
            shift 2
            ;;
        --port=*)
            TARGET_PORT="${1#--port=}"
            shift
            ;;
        -p*)
            TARGET_PORT="${1#-p}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            if [ "$ENV_SET" -eq 0 ]; then
                ENV="$1"
                ENV_SET=1
                shift
            else
                echo "错误: 无法识别参数 $1"
                usage
                exit 1
            fi
            ;;
    esac
done

echo "启动后端服务，运行环境: $ENV"

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

resolve_service_by_port() {
    case "$1" in
        3001)
            echo "legacy|build:legacy|start:prod:legacy|$LOG_DIR/legacy-app.log"
            ;;
        3100)
            echo "gateway|build:gateway|start:prod:gateway|$LOG_DIR/gateway-app.log"
            ;;
        3002)
            echo "agents|build:agents|start:prod:agents|$LOG_DIR/agents-app.log"
            ;;
        3003)
            echo "ws|build:ws|start:prod:ws|$LOG_DIR/ws-app.log"
            ;;
        3004)
            echo "ei|build:ei|start:prod:ei|$LOG_DIR/ei-app.log"
            ;;
        *)
            return 1
            ;;
    esac
}

start_backend_service() {
    local service_name=$1
    local service_port=$2
    local build_script=$3
    local start_script=$4
    local log_file=$5

    echo "========================================"
    echo "构建 $service_name 服务..."
    pnpm run "$build_script"
    echo "启动 $service_name 服务 (端口 $service_port)..."

    nohup env NODE_ENV="$ENV" pnpm run "$start_script" > "$log_file" 2>&1 &

    wait_for_service "$service_port" "$service_name"
}

if [ -n "$TARGET_PORT" ]; then
    if ! [[ "$TARGET_PORT" =~ ^[0-9]+$ ]]; then
        echo "错误: 端口必须是数字，收到: $TARGET_PORT"
        exit 1
    fi

    if ! service_line=$(resolve_service_by_port "$TARGET_PORT"); then
        echo "错误: 不支持的后端服务端口 $TARGET_PORT"
        echo "支持端口: 3001, 3002, 3003, 3004, 3100"
        exit 1
    fi

    IFS='|' read -r service_name build_script start_script log_file <<< "$service_line"
    start_backend_service "$service_name" "$TARGET_PORT" "$build_script" "$start_script" "$log_file"

    echo "========================================"
    echo "后端服务已启动，日志文件位于: $log_file"
    exit 0
fi

start_backend_service "legacy" 3001 "build:legacy" "start:prod:legacy" "$LOG_DIR/legacy-app.log"
start_backend_service "gateway" 3100 "build:gateway" "start:prod:gateway" "$LOG_DIR/gateway-app.log"
start_backend_service "agents" 3002 "build:agents" "start:prod:agents" "$LOG_DIR/agents-app.log"
start_backend_service "ws" 3003 "build:ws" "start:prod:ws" "$LOG_DIR/ws-app.log"
start_backend_service "ei" 3004 "build:ei" "start:prod:ei" "$LOG_DIR/ei-app.log"

echo "========================================"
echo "后端服务已启动，日志文件位于: $LOG_DIR"
echo "- $LOG_DIR/legacy-app.log"
echo "- $LOG_DIR/gateway-app.log"
echo "- $LOG_DIR/agents-app.log"
echo "- $LOG_DIR/ws-app.log"
echo "- $LOG_DIR/ei-app.log"
