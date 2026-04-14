# ORCHESTRATION CREATE PLAN PROJECT SELECTOR PLAN

## 1. 背景

- 计划编排列表页已支持按项目筛选，但“创建编排计划”弹窗没有项目选择项。
- 当前创建逻辑默认复用列表筛选值，导致用户在“全部项目”视图下无法显式指定归属项目。

## 2. 目标

- 在创建计划弹窗新增“所属项目”选择能力。
- 创建请求显式提交 `projectId`，与列表筛选字段保持一致。
- 保持“全局（无项目）”与“全部项目”语义清晰，不引入破坏性改动。

## 3. 执行步骤

1. 梳理现有编排创建链路（前端表单字段、提交 payload、后端 DTO）并确认 `projectId` 语义。
2. 在前端创建弹窗新增项目下拉，复用现有孵化项目数据源并支持“全局（无项目）”。
3. 页面编排层新增创建态 `projectId` 状态，打开创建弹窗时按当前筛选值预填，可手动切换。
4. 创建提交时使用弹窗项目值而非列表筛选值，复制计划到新建时同步回填 `projectId`。
5. 回归验证创建后列表筛选命中行为，并更新相关功能文档追溯信息。

## 4. 影响范围

- 前端页面：`frontend/src/pages/orchestration/index.tsx`
- 前端组件：`frontend/src/pages/orchestration/components/CreatePlanModal.tsx`
- 前端服务类型（如需）：`frontend/src/services/orchestrationService.ts`
- 文档：`docs/requirement/ORCHESTRATION_TASK_REQ-001_CREATE_PLAN_PROJECT_SELECTOR.md`、`docs/feature/ORCHETRATION_TASK.md`

## 5. Requirement 拆解

- REQ-001：创建计划弹窗补齐项目选择并打通提交字段。
  - 文档：`docs/requirement/ORCHESTRATION_TASK_REQ-001_CREATE_PLAN_PROJECT_SELECTOR.md`
  - 验收重点：创建时可显式选项目，创建后可通过对应项目筛选命中计划。

## 6. 风险与处理

- 风险：`projectId` 三态（未传/空串/具体值）语义混淆导致筛选异常。
  - 处理：创建提交统一为 `undefined`（全局）或具体项目 ID，不向后端提交空串。
- 风险：创建态默认值与列表筛选值脱节。
  - 处理：打开弹窗时以当前筛选值预填，用户可在弹窗中覆盖。
