# 2026-03-26 Agent 日志任务触发上下文不可见修复

## 现象

- Agent 详情页日志列表中，多个任务显示为“未命名任务”，难以判断任务是由内部消息、会议聊天还是计划编排触发。
- 当同一 run 的首条日志事件不包含 `taskTitle` 时，前端分组标题直接退化为“未命名任务”。
- 日志卡片缺少“环境说明”，无法直观看到会议标题或计划上下文。

## 根因

- 前端 `useLogState` 以分组首条事件 `first.details.taskTitle` 作为标题来源，未在分组内做多事件回溯补全。
- Runtime hook 日志（`runtime:*`）写入 `agent_action_logs` 时，未结合 `agent_runs.metadata` 回填上下文字段，导致 `taskTitle/meetingTitle/planId` 不稳定。

## 修复动作

1. 后端 `AgentActionLogService` 增加 run 级上下文补全：
   - 按页面日志内 `runId` 批量查询 `agent_runs`。
   - 从 `run.taskTitle` 与 `run.metadata` 补全 `taskTitle/taskType/meetingTitle/meetingId/planId/planTitle`。
   - 计算并写回 `details.environmentType`（`internal_message|meeting_chat|orchestration_plan|chat`）。
2. 前端日志分组标题策略改造：
   - 分组内扫描所有事件优先找 `taskTitle`。
   - 会议/聊天场景无标题时回退为 `执行***会议中任务`。
   - 内部消息场景无标题时回退为 `执行内部消息触发任务`。
3. 前端日志卡片新增“环境说明”展示：
   - 会议/聊天展示会议标题。
   - 计划编排展示“计划编排 + 计划名(无则 planId 回退) + 任务标题”。
   - 内部消息展示“内部消息触发”。

## 验证结果

- 已完成代码级验证：
  - 日志分组标题不再依赖首事件，标题来源更稳定。
  - `runtime:*` 日志可从 run 元数据补全环境字段。
  - 日志卡片可展示环境说明。
- 已执行构建验证：
  - `pnpm -C frontend build`（通过）
  - `pnpm -C backend build`（通过）
