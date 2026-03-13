# ytpo-ai - 项目依赖说明

## 后端依赖包说明

### 核心框架
- `@nestjs/common` - NestJS核心模块
- `@nestjs/core` - NestJS应用核心
- `@nestjs/platform-express` - Express平台适配器
- `@nestjs/mongoose` - MongoDB集成
- `@nestjs/websockets` - WebSocket支持
- `@nestjs/platform-ws` - WebSocket平台

### 数据库
- `mongoose` - MongoDB ODM

### AI模型SDK
- `openai` - OpenAI官方SDK
- `@anthropic-ai/sdk` - Anthropic Claude SDK
- `@google-ai/generativelanguage` - Google Gemini SDK
- `google-auth-library` - Google认证库

### 工具库
- `axios` - HTTP客户端
- `ws` - WebSocket库
- `uuid` - UUID生成器
- `class-validator` - 数据验证
- `class-transformer` - 数据转换

### 开发工具
- `@nestjs/cli` - NestJS命令行工具
- `@nestjs/schematics` - 代码生成器
- `@nestjs/testing` - 测试工具
- `typescript` - TypeScript编译器
- `jest` - 测试框架
- `eslint` - 代码检查
- `prettier` - 代码格式化

## 前端依赖包说明

### 核心框架
- `react` - React核心库
- `react-dom` - React DOM渲染
- `react-router-dom` - 路由管理
- `typescript` - TypeScript支持

### UI框架
- `@headlessui/react` - 无样式UI组件
- `@heroicons/react` - Hero图标库
- `tailwindcss` - CSS框架

### 状态管理和数据获取
- `zustand` - 轻量级状态管理
- `react-query` - 服务器状态管理
- `axios` - HTTP客户端

### 开发工具
- `vite` - 构建工具
- `@vitejs/plugin-react` - React插件
- `postcss` - CSS处理器
- `autoprefixer` - CSS前缀

## 安装说明

### 全局依赖
```bash
# 安装Node.js (v18+)
# 安装MongoDB
```

### 项目依赖
```bash
# 安装所有依赖
npm run install:all

# 或分别安装
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 环境配置
```bash
# 复制环境变量模板
cp backend/.env.example backend/.env.development

# 编辑配置文件，填入API密钥
vim backend/.env.development
```

## 启动方式

### 开发环境
```bash
# 使用启动脚本
./backend/start.sh development

# 或手动启动
npm run dev
```

### 生产环境
```bash
# 使用启动脚本
./backend/start.sh production

# 或手动启动
npm run build
npm start
```

## 系统要求

- Node.js >= 18.0.0
- MongoDB >= 5.0
- 内存 >= 4GB (推荐)
- 磁盘空间 >= 2GB

## API密钥获取

### OpenAI
1. 访问 https://platform.openai.com
2. 注册/登录账号
3. 创建API Key

### Anthropic Claude
1. 访问 https://console.anthropic.com
2. 注册/登录账号
3. 获取API Key

### Google Gemini
1. 访问 https://makersuite.google.com
2. 创建项目
3. 启用Gemini API
4. 创建API Key
