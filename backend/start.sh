#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# AI Agent Team Platform - 启动脚本

set -e

echo "🤖 AI Agent Team Platform 启动脚本"
echo "=================================="

# 检查Node.js版本
NODE_VERSION=$(node --version)
echo "📦 Node.js版本: $NODE_VERSION"

# 检查是否有MongoDB连接
# echo "🔍 检查MongoDB连接..."
# if ! command -v mongosh &> /dev/null && ! command -v mongo &> /dev/null; then
#     echo "⚠️  警告: 未找到MongoDB客户端，请确保MongoDB正在运行"
# else
#     echo "✅ MongoDB客户端已安装"
# fi

# 选择环境
ENV=${1:-development}
echo "🌍 启动环境: $ENV"

# 检查环境变量文件
# if [ ! -f ".env.$ENV" ]; then
#     echo "⚠️  警告: .env.$ENV 文件不存在，请复制 .env.example 并配置API密钥"
#     echo "💡 提示: cp .env.example .env.$ENV"
#     exit 1
# fi

# 复制环境变量文件
# cp .env.$ENV .env
# echo "✅ 环境变量已加载: .env"

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装后端依赖..."
    npm install
fi

if [ ! -d "../frontend/node_modules" ]; then
    echo "📦 安装前端依赖..."
    cd ../frontend && npm install && cd ../backend
fi

# 构建项目
echo "🔨 构建项目..."
npm run build

# 启动服务
echo "🚀 启动服务..."
if [ "$ENV" = "development" ]; then
    echo "🔧 开发模式: 启动前后端服务"
    npm run dev:all
else
    echo "🏭 生产模式: 启动后端服务"
    npm start
fi