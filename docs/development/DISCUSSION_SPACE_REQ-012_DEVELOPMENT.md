# Development: DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK

## 1. 完成内容

- EI 孵化项目聚合服务接入 `discussion_spaces` 读取，新增 `getProjectDiscussionSpaces(projectId)`，返回讨论空间摘要列表（标题、分类、状态、统计、更新时间）。
- EI 孵化项目 Controller 新增 `GET /ei/incubation-projects/:id/discussions`，用于按项目查询讨论空间。
- EI 项目统计 `getProjectStats` 新增 `discussions` 聚合（`total` + `byCategory`）。
- 前端孵化项目详情页新增“讨论空间”Tab，支持列表展示、刷新、新建入口、点击跳转讨论详情。
- 前端孵化项目详情统计卡片新增“讨论空间”数量展示。
- `SpaceCreateModal.tsx` 项目关联改为下拉选择，支持加载孵化项目列表并带入默认项目。

## 2. 关键修正

- 修复讨论空间聚合结果的 ID 兼容问题：后端统一返回 `id`，前端同时兼容 `id/_id`，避免 `lean()` 场景下因缺失 `id` 导致跳转失败。

## 3. 影响文件

- 后端：
  - `backend/apps/ei/src/app.module.ts`
  - `backend/apps/ei/src/services/incubation-project-aggregation.service.ts`
  - `backend/apps/ei/src/controllers/incubation-projects.controller.ts`
- 前端：
  - `frontend/src/services/incubationProjectService.ts`
  - `frontend/src/pages/IncubationProjectDetail.tsx`
  - `frontend/src/components/discussion/SpaceCreateModal.tsx`
  - `frontend/src/pages/Discussions.tsx`

## 4. 验证记录

- `backend`：`pnpm --filter ei test -- services/incubation-project-aggregation.service.spec.ts`
- `backend`：`pnpm --filter ei run build`

## 5. 对应需求与计划

- Requirement：`docs/requirement/DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK.md`
- Plan：`docs/plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md`
