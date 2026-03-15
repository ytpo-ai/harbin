#!/bin/bash

set -e

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

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

BACKEND_PORTS=(3001 3002 3003 3004 3100)

if [ -n "$TARGET_PORT" ]; then
    if ! [[ "$TARGET_PORT" =~ ^[0-9]+$ ]]; then
        echo "错误: 端口必须是数字，收到: $TARGET_PORT"
        exit 1
    fi

    is_supported=0
    for port in "${BACKEND_PORTS[@]}"; do
        if [ "$port" = "$TARGET_PORT" ]; then
            is_supported=1
            break
        fi
    done

    if [ "$is_supported" -ne 1 ]; then
        echo "错误: 不支持的后端端口 $TARGET_PORT"
        echo "支持端口: 3001, 3002, 3003, 3004, 3100"
        exit 1
    fi

    lsof -ti :"$TARGET_PORT" 2>/dev/null | xargs -r kill
else
    (lsof -ti :3001; lsof -ti :3002; lsof -ti :3003; lsof -ti :3100; lsof -ti :3004; lsof -ti :3201) 2>/dev/null | sort -u | xargs -r kill
fi

sleep 2

if [ -n "$TARGET_PORT" ]; then
    bash "$SCRIPT_DIR/start.sh" "$ENV" -p "$TARGET_PORT"
else
    bash "$SCRIPT_DIR/start.sh" "$ENV"
fi

sleep 8
lsof -nP -i :3001 -i :3002 -i :3003 -i :3100 -i :3004 -i :3201 | grep LISTEN
