# 项目管理页面重建计划

## 1. 背景与目标

- 现有 `研发智能` 首页以文档树/历史阅读为核心，不符合当前“项目管理”诉求。
- 新页面目标聚焦三类项目管理：`local`、`opencode`、`github`。
- 绑定约束需在交互上明确：必须先有本地项目，再绑定 OpenCode 与 GitHub。

## 2. 执行步骤

1. 新建页面并替换路由入口：`/engineering-intelligence` 从“研发智能”切换为“项目管理”。
2. 实现本地项目管理：创建本地项目、列表展示、选择当前主项目。
3. 实现 OpenCode 管理与绑定：支持按 Agent 同步 OpenCode 项目并绑定到当前本地项目。
4. 实现 GitHub 仓库绑定：填写 owner/repo/repositoryUrl/branch，并选择 `github` provider 的 API Key 绑定到当前本地项目。
5. 新增绑定关系视图：展示当前本地项目已绑定的多个 OpenCode 项目与单个 GitHub 仓库。
6. 调整侧边栏文案与入口，移除首页“文档与历史/文档详情”交互。
7. 更新 feature/api/dailylog 文档并完成前端构建验证。

## 3. 关键影响点

- 前端页面：`frontend/src/pages/ProjectManagement.tsx`（新建）与路由切换。
- 前端导航：`frontend/src/components/Layout.tsx` 菜单文案更新。
- 前端服务：复用 `rdManagementService` 的 local/opencode/github 绑定接口。
- 文档：`docs/feature/ENGINEERING_INTELLIGENCE.md`、`docs/api/legacy-api.md`、`docs/dailylog/day/2026-03-13.md`。

## 4. 风险与依赖

- OpenCode 项目同步依赖 Agent 的 `endpointRef` 与 OpenCode 服务可用性。
- 若未提前维护 `github` provider 的 API Key，GitHub 绑定会失败。
- 首版先提供“创建与绑定”，解绑能力可在后续迭代补充。

## 5. 完成标准

- `研发智能` 首页标题与能力切换为“项目管理”。
- 页面可管理三类项目并完成绑定关系维护。
- 必须先有并选中本地项目后，才可进行 OpenCode/GitHub 绑定操作。
- 文档与构建验证完成。
