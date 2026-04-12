# Plan: 创建孵化项目模板

## 背景

里程碑 2 完成后，进入孵化项目阶段。将当前项目的最佳实践沉淀为可复用的项目模板，存放在 `data/template/`。

## 目标

提取以下经验到模板：
1. backend/frontend/docs 的目录结构
2. AGENTS.md 和 docs/feature/RULES.md 等文档规范
3. NestJS + React 基础项目骨架

## 执行步骤

1. [x] 创建 `data/template/` 目录结构
2. [x] 创建通用化 AGENTS.md（去除项目特定业务逻辑和红线）
3. [x] 创建 README.md 模板使用说明
4. [x] 创建 .gitignore 和 docker-compose.yml（MongoDB + Redis）
5. [x] 创建 backend 骨架（NestJS monorepo + Config + Mongoose 最小可运行）
6. [x] 创建 frontend 骨架（React + Vite + Tailwind + 基础路由）
7. [x] 创建 docs 文档体系骨架（feature/RULES.md, dailylog/RULES.md, guide/ 等）
8. [x] 修改根目录 .gitignore 添加 `!data/template/` 例外

## 影响点

- **新增**: `data/template/` 下 37 个文件
- **修改**: 根 `.gitignore` 添加 template 例外

## 模板文件清单

```
data/template/
├── AGENTS.md
├── README.md
├── .gitignore
├── docker-compose.yml
├── backend/
│   ├── package.json, tsconfig.json, nest-cli.json, .eslintrc.cjs, .env.example
│   ├── src/main.ts, app.module.ts, config/app.config.ts, config/database.config.ts
│   └── libs/common/src/index.ts
├── frontend/
│   ├── package.json, index.html, vite.config.ts, tsconfig.json, tsconfig.node.json
│   ├── tailwind.config.js, postcss.config.js
│   └── src/main.tsx, App.tsx, index.css, services/api.ts
└── docs/
    ├── feature/RULES.md, INDEX.md
    ├── dailylog/RULES.md, day/, week/
    ├── guide/TEST_GUIDELINE.MD, ANALYSIS_GUIDELINE.MD
    ├── technical/, plan/, issue/fix/, api/, development/
```
