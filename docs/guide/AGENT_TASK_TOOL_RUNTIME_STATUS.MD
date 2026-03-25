# AGENT_TASK_TOOL_RUNTIME_STATUS

## 目标

- 在 Agent Task 执行期间，以 tool 调用粒度维护 Agent 当前运行状态（Redis）。
- 任务终态后将状态统一回写为 `idle`，避免残留忙碌态。
- 复用 `agent-master.list-agents` 输出实时状态，支持全量与按 `agentId` 查询。

## 关键实现位置

- Tool 状态写入：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`
  - 在 `recordToolPending/recordToolRunning/recordToolCompleted/recordToolFailed` 写入 Redis。
- 任务终态归位：`backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts`
  - 在任务最终 `succeeded/failed/cancelled` 分支调用 `markAgentTaskToolIdle`。
- 状态读出（MCP）：`backend/apps/agents/src/modules/tools/tool.service.ts`
  - `getAgentsMcpList` 支持可选 `agentId`，并为返回项拼装 `runtimeStatus`。
- 状态模型工具：`backend/apps/agents/src/modules/agent-tasks/agent-task-runtime-status.util.ts`

## Redis 约定

- 状态 key：`agent:runtime-status:{agentId}`
- 索引 set：`agent:runtime-status:index`
- TTL：`AGENT_TASK_RUNTIME_STATUS_TTL_SECONDS`（默认 6 小时）

## 返回结构补充

- `list-agents` 每个 agent 返回 `runtimeStatus`：
  - `status`: `idle|pending|running|completed|failed`
  - `taskId?`
  - `toolId?`
  - `toolName?`
  - `updatedAt`
  - `source=agent_task_tool`
