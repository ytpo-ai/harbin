# AGENT_ACTION_LOG_TRIGGER_CONTEXT_ENRICHMENT

## 目标

- 让 Agent 日志任务卡片能直接看到触发环境（内部消息 / 会议聊天 / 计划编排）。
- 解决 `runtime:*` 事件缺少标题字段导致“未命名任务”频发的问题。

## 后端补全链路

- 入口：`backend/apps/agents/src/modules/action-logs/agent-action-log.service.ts`
- 查询日志后，按当前页内 `runId` 批量回查 `agent_runs`（`id/taskTitle/metadata`）。
- 使用 run 上下文补全 `details`：
  - `taskTitle`
  - `taskType`
  - `meetingTitle` / `meetingId`
  - `planId` / `planTitle`
  - `environmentType`（`internal_message|meeting_chat|orchestration_plan|chat`）

## 前端展示策略

- 位置：`frontend/src/components/agent-detail/hooks/useLogState.ts`
- 分组标题不再仅依赖首事件，改为分组内全量扫描 `taskTitle`。
- 无标题回退：
  - 会议/聊天：`执行***会议中任务`
  - 内部消息：`执行内部消息触发任务`
  - 计划编排：`执行<计划名>中任务`
- 卡片新增环境说明文案（`environmentLabel`），在 `LogTab.tsx` 展示。
