#!/bin/bash

set -e

usage() {
    echo "用法: $0 [-p|--port <port>]"
    echo "示例: $0"
    echo "示例: $0 -p 3002"
}

stop_service_by_port() {
    local port=$1
    local name=$2
    local pids

    pids=$(lsof -ti :"$port" || true)

    if [ -z "$pids" ]; then
        echo "$name 未运行 (端口 $port)"
        return 0
    fi

    echo "停止 $name (端口 $port): $pids"
    kill $pids || true

    sleep 1

    pids=$(lsof -ti :"$port" || true)
    if [ -n "$pids" ]; then
        echo "$name 未在预期时间内退出，强制停止: $pids"
        kill -9 $pids || true
    fi

    if lsof -i :"$port" > /dev/null 2>&1; then
        echo "警告: $name 停止失败 (端口 $port 仍被占用)"
        return 1
    fi

    echo "$name 已停止"
    return 0
}

resolve_service_name_by_port() {
    case "$1" in
        3001)
            echo "legacy"
            ;;
        3100)
            echo "gateway"
            ;;
        3002)
            echo "agents"
            ;;
        3003)
            echo "ws"
            ;;
        3004)
            echo "ei"
            ;;
        3006)
            echo "channel"
            ;;
        *)
            return 1
            ;;
    esac
}

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
            echo "错误: 无法识别参数 $1"
            usage
            exit 1
            ;;
    esac
done

echo "停止后端服务"

if [ -n "$TARGET_PORT" ]; then
    if ! [[ "$TARGET_PORT" =~ ^[0-9]+$ ]]; then
        echo "错误: 端口必须是数字，收到: $TARGET_PORT"
        exit 1
    fi

    if ! service_name=$(resolve_service_name_by_port "$TARGET_PORT"); then
        echo "错误: 不支持的后端服务端口 $TARGET_PORT"
        echo "支持端口: 3001, 3002, 3003, 3004, 3006, 3100"
        exit 1
    fi

    stop_service_by_port "$TARGET_PORT" "$service_name"
    exit 0
fi

stop_service_by_port 3001 "legacy"
stop_service_by_port 3100 "gateway"
stop_service_by_port 3002 "agents"
stop_service_by_port 3003 "ws"
stop_service_by_port 3004 "ei"
stop_service_by_port 3006 "channel"

echo "所有后端服务已停止"
