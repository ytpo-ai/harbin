# Orchestration 重新编排 SSE 与任务清空修复记录

## 1. 基本信息

- 标题：计划详情页重新编排未同步 SSE 流式行为，旧任务未先清空
- 日期：2026-03-17
- 负责人：OpenCode
- 关联需求/会话：用户反馈“重新编排应改为 SSE，且开始时先删除已有任务并刷新任务列表”
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：在计划详情页触发“重新编排”后，旧任务仍保留到新任务全部生成结束，无法体现“先清空再流式生成”的过程。
- 触发条件：进入 `/orchestration/plans/:id`，点击“重新编排”。
- 影响范围：计划详情页重排交互体验、重排链路状态感知一致性。
- 严重程度：中

## 3. 根因分析

- 直接原因：重排后端逻辑仍是“规划完成后一次性覆盖”，不是 `drafting + task.generated` 的流式回灌模型。
- 深层原因：创建计划链路已升级为 SSE 异步流式，但重排链路没有同步迁移到同一状态机与事件模型。
- 相关模块/文件：
  - `backend/src/modules/orchestration/orchestration.service.ts`
  - `frontend/src/pages/PlanDetail.tsx`

## 4. 修复动作

- 修复方案：将重排链路改为与创建链路一致的异步流式模式：先删旧任务并重置计划/会话，再以 SSE 逐条推送新任务。
- 代码改动点：
  - 后端 `replanPlan`：
    - 重排开始先 `deleteMany({ planId })` 清空任务。
    - 立即重置 `planSession.tasks=[]`、`stats=0`、`taskIds=[]`，并将计划状态置为 `drafting`。
    - 推送 `plan.status.changed (drafting)`、逐条推送 `plan.task.generated`，完成后推送 `plan.completed`，失败推送 `plan.failed`。
  - 前端 `PlanDetail`：
    - 重排触发时通过 `react-query setQueryData` 先乐观清空本地任务列表，再刷新详情查询，避免必须手动点“刷新”才看到列表清空。
    - 基于 SSE 事件更新提示文案，包含“旧任务已删除/新任务生成中/完成/失败”。
    - 完成态判断改为优先依据 `plan.status` 与 SSE 终态，不再依赖旧的 `replannedAt` 弹窗式提示。
  - 前端 `orchestrationService.subscribePlanEvents`：
    - 由浏览器 `EventSource` 切换为 `fetch + text/event-stream` 解析，显式携带 `Authorization: Bearer <token>` 请求头。
    - 保留 `access_token` 查询参数兜底，并增加断线自动重连。
- 兼容性处理：保留原轮询兜底；SSE 断开时仍可通过详情轮询感知状态变化。

## 5. 验证结果

- 验证步骤：
  - 执行后端构建：`backend` 目录下 `npm run build`（已先初始化 nvm 环境）。
  - 执行前端构建：`frontend` 目录下 `npm run build`（已先初始化 nvm 环境）。
  - 手动检查关键路径：重排开始后状态为 `drafting`，任务列表清空并随后按事件逐条恢复。
- 验证结论：通过
- 测试与检查：完成前后端构建检查；未新增自动化测试用例。

## 6. 风险与后续

- 已知风险：当前计划事件分发仍为单实例内存通道，多实例部署场景需引入跨实例事件总线。
- 后续优化：可补充 `replan` 的集成测试，覆盖“先清空再流式回灌”及失败回滚提示。
- 是否需要补充功能文档/API文档：是（功能文档与开发总结已同步更新，API 无新增接口）
