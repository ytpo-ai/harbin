#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

set -e

echo "AI Agent Team Platform 启动脚本"
echo "=================================="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

NODE_VERSION=$(node --version)
echo "Node.js版本: $NODE_VERSION"

ENV=${1:-development}
echo "启动环境: $ENV"

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

parse_mongodb_port_from_uri() {
    local uri=$1

    if [ -z "$uri" ]; then
        return 1
    fi

    local authority="${uri#*://}"

    if [[ "$authority" == *"@"* ]]; then
        authority="${authority##*@}"
    fi

    authority="${authority%%/*}"
    authority="${authority%%\?*}"
    authority="${authority%%\#*}"

    local first_host="${authority%%,*}"

    if [[ "$first_host" =~ ^\[[^]]+\]:([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

    if [[ "$first_host" =~ :([0-9]+)$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi

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

BACKEND_ENV_FILE=$(pick_backend_env_file)

if [ -n "$BACKEND_ENV_FILE" ]; then
    echo "使用后端环境文件: $BACKEND_ENV_FILE"
else
    echo "警告: 未找到后端环境文件，端口使用默认值"
fi

REDIS_PORT_VALUE=""
if [ -n "$BACKEND_ENV_FILE" ]; then
    REDIS_PORT_VALUE=$(get_env_value "$BACKEND_ENV_FILE" "REDIS_PORT" || true)
fi

if [[ "$REDIS_PORT_VALUE" =~ ^[0-9]+$ ]]; then
    REDIS_PORT="$REDIS_PORT_VALUE"
else
    REDIS_PORT=6379
    if [ -n "$REDIS_PORT_VALUE" ]; then
        echo "警告: REDIS_PORT 非法($REDIS_PORT_VALUE)，回退到默认端口 $REDIS_PORT"
    else
        echo "提示: 未配置 REDIS_PORT，使用默认端口 $REDIS_PORT"
    fi
fi

MONGODB_URI_VALUE=""
if [ -n "$BACKEND_ENV_FILE" ]; then
    MONGODB_URI_VALUE=$(get_env_value "$BACKEND_ENV_FILE" "MONGODB_URI" || true)
fi

MONGODB_PORT_VALUE=$(parse_mongodb_port_from_uri "$MONGODB_URI_VALUE" || true)
if [[ "$MONGODB_PORT_VALUE" =~ ^[0-9]+$ ]]; then
    MONGODB_PORT="$MONGODB_PORT_VALUE"
else
    MONGODB_PORT=27017
    if [ -n "$MONGODB_URI_VALUE" ]; then
        echo "提示: MONGODB_URI 未显式包含端口，使用默认端口 $MONGODB_PORT"
    else
        echo "提示: 未配置 MONGODB_URI，使用默认端口 $MONGODB_PORT"
    fi
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
    if [ -n "$FRONTEND_URL_VALUE" ]; then
        echo "提示: FRONTEND_URL 未显式包含端口，使用默认端口 $FRONTEND_PORT"
    else
        echo "提示: 未配置 FRONTEND_URL，使用默认端口 $FRONTEND_PORT"
    fi
fi

echo "Redis 检测端口: $REDIS_PORT"
echo "MongoDB 检测端口: $MONGODB_PORT"
echo "Frontend 检测端口: $FRONTEND_PORT"

if [ ! -d "node_modules" ]; then
    echo "安装根目录依赖..."
    pnpm install
fi

if [ ! -d "backend/node_modules" ]; then
    echo "安装后端依赖..."
    cd backend && pnpm install && cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "安装前端依赖..."
    cd frontend && pnpm install && cd ..
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

check_docker_service() {
    local container=$1
    local name=$2
    local port=$3
    local max_attempts=30
    local attempt=1
    echo "检查 Docker 服务: $name (端口 $port)..."

    if lsof -i :$port > /dev/null 2>&1; then
        echo "$name 端口 $port 已监听"
        return 0
    fi

    echo "$name 端口 $port 未监听，尝试启动容器..."
    docker-compose up -d "$container"

    echo "等待 $name 启动 (端口 $port)..."
    while ! lsof -i :$port > /dev/null 2>&1; do
        sleep 1
        attempt=$((attempt + 1))
        if [ $attempt -gt $max_attempts ]; then
            echo "错误: $name 启动超时 (端口 $port 未监听)"
            return 1
        fi
    done

    echo "$name 已启动 (端口 $port)"
    return 0
}

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "========================================"
echo "检查数据库服务..."
echo "========================================"

if check_docker_service "harbin-mongodb" "MongoDB" "$MONGODB_PORT"; then
    echo "✅ MongoDB 就绪"
else
    echo "❌ MongoDB 启动失败"
    exit 1
fi

if check_docker_service "harbin-redis" "Redis" "$REDIS_PORT"; then
    echo "✅ Redis 就绪"
else
    echo "❌ Redis 启动失败"
    exit 1
fi

echo ""
echo "启动服务..."
if [ "$ENV" = "development" ]; then
    echo "开发模式: 启动前后端服务"
    
    echo "========================================"
    echo "1/6 启动 legacy 服务 (端口 3001)..."
    cd "$SCRIPT_DIR/backend"
    nohup pnpm run start:dev > "$LOG_DIR/legacy-app.log" 2>&1 &
    wait_for_service 3001 "legacy"
    
    echo "========================================"
    echo "2/6 启动 gateway 服务 (端口 3100)..."
    cd "$SCRIPT_DIR/backend"
    nohup pnpm run start:gateway:dev > "$LOG_DIR/gateway-app.log" 2>&1 &
    wait_for_service 3100 "gateway"
    
    echo "========================================"
    echo "3/6 启动 agents 服务 (端口 3002)..."
    cd "$SCRIPT_DIR/backend"
    nohup pnpm run start:agents:dev > "$LOG_DIR/agents-app.log" 2>&1 &
    wait_for_service 3002 "agents"
    
    echo "========================================"
    echo "4/6 启动 ws 服务 (端口 3003)..."
    cd "$SCRIPT_DIR/backend"
    nohup pnpm run start:ws:dev > "$LOG_DIR/ws-app.log" 2>&1 &
    wait_for_service 3003 "ws"
    
    echo "========================================"
    echo "5/6 启动 engineering-intelligence 服务 (端口 3201)..."
    cd "$SCRIPT_DIR/backend"
    nohup pnpm run start:ei:dev > "$LOG_DIR/engineering-intelligence-app.log" 2>&1 &
    wait_for_service 3201 "engineering-intelligence"
    
    echo "========================================"
    echo "6/6 启动前端服务 (端口 $FRONTEND_PORT)..."
    cd "$SCRIPT_DIR/frontend"
    nohup pnpm run dev > "$LOG_DIR/frontend-app.log" 2>&1 &
    wait_for_service "$FRONTEND_PORT" "frontend"
    
    cd "$SCRIPT_DIR"
    echo "========================================"
    echo "所有服务已启动!"
    echo "日志文件位于: $LOG_DIR"
    echo "- $LOG_DIR/legacy-app.log"
    echo "- $LOG_DIR/gateway-app.log"
    echo "- $LOG_DIR/agents-app.log"
    echo "- $LOG_DIR/ws-app.log"
    echo "- $LOG_DIR/engineering-intelligence-app.log"
    echo "- $LOG_DIR/frontend-app.log"
else
    echo "生产模式: 启动后端服务"
    cd "$SCRIPT_DIR/backend" && nohup pnpm run start > "$LOG_DIR/backend-prod.log" 2>&1 &
    echo "服务已启动，日志文件位于: $LOG_DIR/backend-prod.log"
fi
