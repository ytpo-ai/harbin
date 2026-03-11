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
    local max_attempts=30
    local attempt=1
    echo "检查 Docker 服务: $name..."
    
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo "$name Docker 容器已在运行"
        return 0
    fi
    
    echo "$name 容器未运行，尝试启动..."
    docker-compose up -d $container
    
    echo "等待 $name 启动..."
    while ! docker ps --format '{{.Names}}' | grep -q "^${container}$"; do
        sleep 1
        attempt=$((attempt + 1))
        if [ $attempt -gt $max_attempts ]; then
            echo "错误: $name 启动超时"
            return 1
        fi
    done
    
    echo "$name 已启动"
    return 0
}

LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "========================================"
echo "检查数据库服务..."
echo "========================================"

if check_docker_service "harbin-mongodb" "MongoDB"; then
    echo "✅ MongoDB 就绪"
else
    echo "❌ MongoDB 启动失败"
    exit 1
fi

if check_docker_service "harbin-redis" "Redis"; then
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
    echo "6/6 启动前端服务 (端口 5173)..."
    cd "$SCRIPT_DIR/frontend"
    nohup pnpm run dev > "$LOG_DIR/frontend-app.log" 2>&1 &
    wait_for_service 5173 "frontend"
    
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
