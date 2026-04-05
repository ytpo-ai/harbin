#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

FRONTEND_PORT=3000
FRONTEND_DEPLOY_DIR="/var/www/html"

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

deploy_frontend_build() {
    local source_dir=$1
    local target_dir=$2

    if [ ! -d "$source_dir" ]; then
        echo "错误: 前端构建目录不存在: $source_dir"
        return 1
    fi

    if [ "$target_dir" = "/" ]; then
        echo "错误: 禁止部署到根目录"
        return 1
    fi

    mkdir -p "$target_dir"

    if [ ! -w "$target_dir" ]; then
        echo "错误: 目录无写权限: $target_dir"
        echo "请确认当前用户具备写入权限后重试"
        return 1
    fi

    shopt -s dotglob nullglob
    local target_files=("$target_dir"/*)
    if [ ${#target_files[@]} -gt 0 ]; then
        rm -rf "${target_files[@]}"
    fi
    shopt -u dotglob nullglob

    cp -R "$source_dir"/. "$target_dir"/
    echo "前端静态资源已部署到: $target_dir"
}

restart_frontend_dev_server() {
    echo "重启前端服务 (端口 $FRONTEND_PORT)..."
    lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill
    sleep 1

    cd "$SCRIPT_DIR/frontend"
    nohup pnpm run dev > "$LOG_DIR/frontend-app.log" 2>&1 &
    wait_for_service "$FRONTEND_PORT" "frontend"
}

build_and_deploy_frontend_for_test() {
    echo "构建并部署前端到 $FRONTEND_DEPLOY_DIR ..."
    lsof -ti :"$FRONTEND_PORT" 2>/dev/null | xargs -r kill
    sleep 1

    cd "$SCRIPT_DIR/frontend"
    pnpm run build
    deploy_frontend_build "$SCRIPT_DIR/frontend/dist" "$FRONTEND_DEPLOY_DIR"
}

echo "ytpo-ai 重启脚本"
echo "========================================"
echo "重启环境: $ENV"

if [ -n "$TARGET_PORT" ]; then
    if [ "$TARGET_PORT" = "$FRONTEND_PORT" ]; then
        echo "1/2 处理前端服务..."
        if [ "$ENV" = "test" ]; then
            build_and_deploy_frontend_for_test
        else
            restart_frontend_dev_server
        fi
    elif [ "$TARGET_PORT" = "3201" ]; then
        echo "错误: 端口 3201 不支持通过 reload.sh 单独重启"
        exit 1
    else
        echo "1/2 重启后端服务 (端口 $TARGET_PORT)..."
        bash "$SCRIPT_DIR/backend/reload.sh" "$ENV" -p "$TARGET_PORT"
    fi

    echo "========================================"
    echo "2/2 服务监听状态"
    lsof -nP -i :3000 -i :3001 -i :3002 -i :3003 -i :3004 -i :3100 -i :3201 | grep LISTEN

    echo "========================================"
    echo "重启完成"
    if [ "$ENV" = "test" ]; then
        echo "前端已部署到: $FRONTEND_DEPLOY_DIR"
    else
        echo "日志文件: $LOG_DIR/frontend-app.log"
    fi
    exit 0
fi

echo "1/3 重启后端服务..."
bash "$SCRIPT_DIR/backend/reload.sh" "$ENV"

echo "========================================"
echo "2/3 处理前端服务..."
if [ "$ENV" = "test" ]; then
    build_and_deploy_frontend_for_test
else
    restart_frontend_dev_server
fi

echo "========================================"
echo "3/3 服务监听状态"
lsof -nP -i :3000 -i :3001 -i :3002 -i :3003 -i :3004 -i :3100 -i :3201 | grep LISTEN

echo "========================================"
echo "重启完成"
if [ "$ENV" = "test" ]; then
    echo "前端已部署到: $FRONTEND_DEPLOY_DIR"
else
    echo "日志文件: $LOG_DIR/frontend-app.log"
fi
