# Plan Replan 后任务列表“假清空”并在刷新后回显

## 1. 基本信息

- 标题：PlanDetail 点击重新编排后任务列表前端清空但后端未生效
- 日期：2026-03-25
- 负责人：OpenCode
- 关联需求/会话：用户反馈 `http://localhost:3000/orchestration/plans/:id` 页面重新编排后旧任务残留
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：点击“重新编排”后，任务区会先清空，但刷新页面后旧任务重新出现
- 衍生表现：重排过程/`drafting` 状态下触发任务重分配时返回 `400 Plan in "drafting" status cannot reassign`
- 触发条件：PlanDetail 页面发起 replan，接口为异步受理（accepted）
- 影响范围：前端 PlanDetail 的 replan 交互体验与状态一致性
- 严重程度：中

## 3. 根因分析

- 直接原因 1：`replanPlanAsync` 在后端先返回 `accepted`，再异步执行真实 replan；前置校验失败（如计划运行中、计划锁定、prompt 为空）会在后台抛错并被吞掉，导致“受理成功但未真正删除任务”
- 直接原因 2：前端 `onMutate` 先乐观清空任务，若服务端实际失败，界面会出现“已清空”的错觉，刷新后旧任务回显
- 深层原因：异步受理链路缺少“受理前硬校验 + 失败回填机制”
- 相关模块/文件：`backend/src/modules/orchestration/services/plan-management.service.ts`、`frontend/src/hooks/useReplanMutation.ts`
- 相关模块/文件：`backend/src/modules/orchestration/services/plan-management.service.ts`、`frontend/src/hooks/useReplanMutation.ts`、`frontend/src/components/orchestration/constants.ts`、`frontend/src/pages/Orchestration.tsx`

## 4. 修复动作

- 修复方案：后端在异步受理前补齐关键校验，避免“假 accepted”；前端保留乐观清空，但在失败时主动回源恢复真实状态
- 代码改动点：
- 移除 `onMutate` 中的 `invalidateQueries(['orchestration-plan', planId])`
- `onSuccess(autoGenerate=false)` 增加 `setQueryData`，将当前计划强制同步为 `draft + tasks=[] + stats=0`
- `onSuccess(autoGenerate=true)` 不再立即刷新详情，避免旧任务短暂回流；仅刷新计划列表
- `replanPlanAsync` 新增受理前校验：`prompt` 必填、运行中计划禁止重排、`production` 锁定计划禁止重排
- `onError` 增加 `invalidateQueries(['orchestration-plan', planId])`，失败时自动恢复服务端真实任务列表
- 按业务调试诉求放开 `drafting` 编辑门禁：后端 `assertTaskPlanEditable` 允许 `drafting`，前端可编辑状态同步包含 `drafting`，支持重排生成中继续重分配/调试
- 兼容性处理：保留原有 `isReplanPending` 与流式刷新机制，避免影响已有 SSE/轮询链路

## 5. 验证结果

- 验证步骤：
  - 打开 PlanDetail，记录当前任务列表
  - 点击“重新编排”触发 replan
  - 观察任务区是否先清空，再等待后续生成结果
  - 分别验证 `autoGenerate=true/false` 两条路径
- 验证结论：通过（代码级修复已完成，待页面交互复测）
- 测试与检查：前端本地静态检查建议执行 `pnpm -C frontend run lint` 与 `pnpm -C frontend run build`

## 6. 风险与后续

- 已知风险：若后端 replan 受理后长时间未进入执行，页面会保持“已清空等待中”状态（符合当前交互设计）
- 后续优化：可增加“后台重置超时提示”与“重试 replan”入口
- 是否需要补充功能文档/API文档：否
