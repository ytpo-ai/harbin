# Orchestration 任务重分配分配类型切换 400 修复记录

## 1. 基本信息

- 标题：任务分配类型切换时后端强依赖 executorId，导致 `/orchestration/tasks/:id/reassign` 返回 400
- 日期：2026-03-20
- 负责人：OpenCode
- 关联需求/会话：用户反馈“计划编排接口返回 400，无法在页面切换分配类型”
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：在计划任务列表中切换分配类型（如 `unassigned -> agent/employee`）时，请求 `POST /api/orchestration/tasks/:id/reassign` 直接报 400，页面无法完成“先选类型再选执行者”的两步交互。
- 触发条件：页面触发仅携带 `executorType` 的重分配请求（未立即携带 `executorId`）。
- 影响范围：计划详情页与编排页任务分配交互（`PlanDetail`、`Orchestration`）中的分配类型切换路径。
- 严重程度：中

## 3. 根因分析

- 直接原因：后端 `reassignTask` 在 `executorType !== 'unassigned'` 时强制要求 `executorId`，导致“切类型但未选人”的中间态请求被拒绝。
- 深层原因：后端接口语义与前端交互模式不一致。前端是“先改类型，再选执行者”的分步提交，后端按“单次提交必须完整 assignment”进行校验。
- 相关模块/文件：
  - `backend/src/modules/orchestration/orchestration.service.ts`

## 4. 修复动作

- 修复方案：允许 `reassign` 接口接收“仅切换分配类型”的中间态请求；仅当 `executorType + executorId` 同时完整时才进入已分配状态。
- 代码改动点：
  - `backend/src/modules/orchestration/orchestration.service.ts`
    - 移除对 `executorId` 的强制 400 校验。
    - 新增 `executorId` 归一化（空字符串归并为 `undefined`）。
    - 状态计算改为：`agent/employee + executorId` 才置 `assigned`，其余置 `pending`。
    - `unassigned` 显式清空 `assignment.executorId`。
    - tier delegation 校验仅在存在明确目标执行者时触发，避免无目标 ID 时误拦截。
    - 同步调整 `runLogs` 与 PlanSession 写回字段，确保落库与会话视图一致。
- 兼容性处理：保留原有接口与字段，不新增 API；仅放宽校验以兼容前端分步交互。

## 5. 验证结果

- 验证步骤：
  - 代码检查：`npx eslint "src/modules/orchestration/orchestration.service.ts"`
  - 手动验证路径：在任务列表切换分配类型（不选执行者）后请求不再 400，可继续选择 Agent/员工完成分配。
- 验证结论：通过
- 测试与检查：定向 lint 通过；未新增自动化测试用例。

## 6. 风险与后续

- 已知风险：当前放宽后，可能存在短暂 `agent/employee + 无 executorId` 的 `pending` 中间态；需依赖前端继续完成执行者选择。
- 后续优化：可为 `reassignTask` 补充单测，覆盖“仅切类型/切类型+选人/unassigned 回退”三类场景。
- 是否需要补充功能文档/API文档：否（接口定义未变，属于校验策略修复）。
