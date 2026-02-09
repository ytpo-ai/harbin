# AI Agent Team Platform

一个通用AI助手平台，支持多模型接入的Agent团队协作系统。

## 功能特性

- 🤖 多AI模型接入支持（OpenAI、Claude、Gemini等）
- 👥 Agent团队自由讨论协作
- 🔄 灵活的任务分配和执行流程
- 📊 实时任务监控和历史记录
- 🎨 现代化Web界面

## 技术栈

- **后端**: TypeScript + Nest.js + MongoDB
- **前端**: TypeScript + React + TailwindCSS
- **AI模型**: 多提供商统一接口

## 快速开始

### 安装依赖
```bash
npm run install:all
```

### 启动开发环境
```bash
npm run dev
```

### 构建生产版本
```bash
npm run build
```

## 项目结构

```
├── backend/          # Nest.js 后端服务
├── frontend/         # React 前端应用
├── shared/           # 共享类型和工具
└── docs/            # 项目文档
```

## 配置

在 `backend/.env` 中配置AI模型API密钥：
```env
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_claude_key
GOOGLE_AI_API_KEY=your_gemini_key
```