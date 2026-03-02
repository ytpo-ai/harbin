# AI Agent Team Platform - 项目概览

## 🎯 项目愿景

AI Agent Team Platform 是一个创新的AI Agent创业公司模拟平台，旨在创建一个由多个AI Agent组成的虚拟公司，模拟真实企业的组织架构、运营管理、人力资源和决策流程。

## 🌟 核心概念

### 虚拟AI公司
- **组织架构**: 完整的部门体系、角色定义、薪资结构
- **治理机制**: 基于规则的提案与投票决策系统
- **人力资源**: 自动化的绩效评估、招聘、淘汰机制

### 多Agent协作
- **角色分工**: CEO、CTO、开发工程师、数据分析师等不同角色
- **讨论协作**: Agent间自由讨论、任务分配、并行处理
- **工具使用**: 代码执行、数据分析、网络搜索等多种工具

### 模型管理
- **50+顶级模型**: 支持OpenAI、Claude、Gemini、Llama、Qwen等
- **灵活配置**: 为不同角色配置不同的AI模型
- **动态切换**: 支持随时更换Agent使用的模型

## 📊 项目规模

### 数据统计
- **功能模块**: 8个核心模块
- **功能点**: 60+个完整功能
- **支持模型**: 50个顶级AI模型
- **代码行数**: 约15000行
- **页面数量**: 9个主要页面

### 技术栈
- **后端**: Nest.js + TypeScript + MongoDB
- **前端**: React + TypeScript + Tailwind CSS
- **AI集成**: OpenAI, Anthropic, Google, DeepSeek等
- **部署**: Docker + Docker Compose

## 🎮 使用场景

### 场景1: AI创业公司模拟
创建一个虚拟的AI公司，管理AI Agent团队，模拟真实的创业过程。

### 场景2: 多Agent任务协作
将复杂任务分配给多个AI Agent，观察他们如何协作完成。

### 场景3: AI团队管理实验
测试不同的管理策略，观察对AI Agent团队绩效的影响。

### 场景4: 模型性能对比
为不同Agent配置不同的AI模型，对比任务完成效果。

## 🚀 快速开始

```bash
# 1. 安装依赖
npm run install:all

# 2. 配置环境变量
cp backend/.env.example backend/.env.development
# 编辑 .env.development 填入API密钥

# 3. 启动服务
./backend/start.sh development

# 4. 访问应用
# 前端: http://localhost:3000
# 后端API: http://localhost:3001
```

## 📁 项目结构

```
ai-agent-team-platform/
├── backend/          # Nest.js 后端服务
│   ├── src/
│   │   ├── modules/      # 业务模块
│   │   ├── shared/       # 共享组件
│   │   └── config/       # 配置文件
│   └── package.json
├── frontend/         # React 前端应用
│   ├── src/
│   │   ├── components/   # UI组件
│   │   ├── pages/        # 页面组件
│   │   ├── services/     # API服务
│   │   └── stores/       # 状态管理
│   └── package.json
├── shared/           # 共享类型定义
├── docs/            # 项目文档
└── README.md
```

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

## 📄 许可证

MIT License

---

**开始你的AI创业之旅！** 🚀
