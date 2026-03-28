# ORCHESTRATION PLAN LIST COPY TO CREATE PLAN

## 背景

- 计划编排列表页当前仅提供查看与删除操作，缺少基于已有计划快速复用创建的入口。
- 虽然详情抽屉内已有“复制到新建”能力，但在列表场景下操作路径偏长。

## 目标

- 在计划编排列表项新增“复制”按钮。
- 点击后直接打开“创建编排计划”弹窗。
- 使用被复制计划的数据预填新建参数，支持用户二次编辑后提交。

## 执行步骤

1. 扩展列表组件操作区，新增“复制计划”按钮并透传回调（携带当前 plan）。
2. 页面编排层新增列表复制处理逻辑，复用现有创建弹窗状态与字段设置。
3. 将计划数据映射到创建表单字段（`title`、`prompt`、`mode`、`runMode`、`domainType`、`plannerAgentId`），避免带入运行态字段。
4. 复制创建时将标题默认追加“ - 副本”，并将 `autoGenerate` 置为 `false`，避免误触即时生成。
5. 完成前端回归验证：列表复制可打开弹窗、字段回填正确、可正常提交创建。

## 影响范围

- 前端页面：`frontend/src/pages/orchestration/index.tsx`
- 前端组件：`frontend/src/pages/orchestration/components/PlanListTable.tsx`
- 文档：`docs/feature/ORCHETRATION_TASK.md`、`docs/dailylog/day/2026-03-28.md`

## 风险与处理

- 复制字段与创建 DTO 不一致风险：通过显式字段映射规避。
- 复制后直接提交的误操作风险：默认关闭“创建并生成任务”，并允许用户编辑确认。
