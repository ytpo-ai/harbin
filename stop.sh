#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

set -e

echo "ytpo-ai 停止脚本"
echo "=================================="

ENV=${1:-development}
echo "停止环境: $ENV"

pick_backend_env_file() {
    local backend_dir="$SCRIPT_DIR/backend"
    local env_candidate="$backend_dir/.env.$ENV"
    local env_file=""

    if [ -f "$env_candidate" ]; then
        env_file="$env_candidate"
    else
        local file
        for file in "$backend_dir"/.env.*; do
            if [ -f "$file" ] && [ "$(basename "$file")" != ".env.example" ]; then
                env_file="$file"
                break
            fi
        done

        if [ -z "$env_file" ] && [ -f "$backend_dir/.env" ]; then
            env_file="$backend_dir/.env"
        fi
    fi

    echo "$env_file"
}

get_env_value() {
    local env_file=$1
    local key=$2
    local line

    if [ ! -f "$env_file" ]; then
        return 1
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"

        case "$line" in
            ""|\#*)
                continue
                ;;
        esac

        if [[ "$line" == export\ * ]]; then
            line="${line#export }"
        fi

        if [[ "$line" == "$key="* ]]; then
            local value="${line#*=}"
            if [[ "$value" == \"*\" ]]; then
                value="${value#\"}"
                value="${value%\"}"
            elif [[ "$value" == \'*\' ]]; then
                value="${value#\'}"
                value="${value%\'}"
            fi

            echo "$value"
            return 0
        fi
    done < "$env_file"

    return 1
}

parse_port_from_url() {
    local url=$1

    if [ -z "$url" ]; then
        return 1
    fi

    local authority="${url#*://}"
    authority="${authority%%/*}"
    authority="${authority%%\?*}"
    authority="${authority%%\#*}"

    if [[ "$authority" == *"@"* ]]; then
        authority="${authority##*@}"
    fi

    if [[ "$authority" =~ ^\[[^]]+\]:([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    if [[ "$authority" =~ :([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
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

BACKEND_ENV_FILE=$(pick_backend_env_file)

if [ -n "$BACKEND_ENV_FILE" ]; then
    echo "使用后端环境文件: $BACKEND_ENV_FILE"
else
    echo "提示: 未找到后端环境文件，前端端口使用默认值"
fi

FRONTEND_URL_VALUE=""
if [ -n "$BACKEND_ENV_FILE" ]; then
    FRONTEND_URL_VALUE=$(get_env_value "$BACKEND_ENV_FILE" "FRONTEND_URL" || true)
fi

FRONTEND_PORT_VALUE=$(parse_port_from_url "$FRONTEND_URL_VALUE" || true)
if [[ "$FRONTEND_PORT_VALUE" =~ ^[0-9]+$ ]]; then
    FRONTEND_PORT="$FRONTEND_PORT_VALUE"
else
    FRONTEND_PORT=3000
fi

echo "Frontend 检测端口: $FRONTEND_PORT"

echo "========================================"
echo "1/2 停止后端服务..."
bash "$SCRIPT_DIR/backend/stop.sh"

echo "========================================"
echo "2/2 停止前端服务..."
stop_service_by_port "$FRONTEND_PORT" "frontend"

echo "========================================"
echo "所有后端及前端服务已停止"
