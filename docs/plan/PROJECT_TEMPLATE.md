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

---

## 增量计划：孵化项目模板初始化状态与一键复制

### 需求说明

- 在孵化项目增加“是否已初始化模板”状态。
- 当未初始化时，支持一键将 `data/template/` 模板文件复制到该孵化项目绑定的目标本地项目目录。

### 执行步骤

1. [x] 扩展 `incubation_projects` 数据模型，新增初始化状态字段（默认未初始化）
2. [x] 新增初始化 API：校验孵化项目与绑定本地项目、执行模板复制、回写初始化状态
3. [x] 复制策略采用“仅复制缺失文件，不覆盖已有文件”，并返回复制统计
4. [x] 前端孵化项目列表展示初始化状态；未初始化时展示“初始化模板”按钮
5. [x] 增加错误提示与成功反馈（未绑定本地项目/目录不存在/重复初始化等）
6. [x] 更新功能文档（`docs/feature/PROJECT_ INCUBATION.md`）
7. [ ] 补充必要测试用例

### 关键影响点

- **后端**: `incubation-project` schema、service、controller
- **前端**: `ProjectManagement` 孵化项目列表与 `incubationProjectService`
- **数据**: `incubation_projects` 增加初始化状态字段
- **文档**: `docs/feature/PROJECT_ INCUBATION.md`

### 风险与约束

- 模板复制需要目标目录可写权限
- 若目标目录已有同名文件，默认跳过不覆盖
- 依赖本地项目与孵化项目绑定关系有效

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
