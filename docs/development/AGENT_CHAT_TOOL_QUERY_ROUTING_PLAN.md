# Agent Chat Tool Query Routing - 开发总结

## 1. 背景

本次开发聚焦修复聊天场景中“工具查询默认任务化”的问题，并进一步统一 Agent 行为日志语义，解决日志上下文判定不清晰、前端展示信息层级混杂的问题。

对应规划文档：`docs/plan/AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md`

## 2. 实现内容

### 2.1 聊天查询与任务执行语义分流

- 在 `AgentClientService` 中引入 `executionMode` 识别（`chat | task`）
- 新增 `executeToolQuery(...)` 作为聊天轻量工具查询通道
- 会议场景对 `agents_mcp_list`、`human_operation_log_mcp_list` 使用 query 通道，避免进入任务执行生命周期

### 2.2 Agent Action Log 语义收敛

- `contextType` 收敛为两类：`chat | orchestration`
- `contextId` 保持业务 ID（会议/讨论 ID 或计划/任务 ID）
- 在 `details` 中新增并写入 `agentSessionId`，用于与 Session 详情联查
- 执行类 action 明确为：
  - `chat_execution:<contextType>:<taskType>`
  - `task_execution:<contextType>:<taskType>`
  - `chat_tool_call`

### 2.3 前端日志列表可读性优化

- 日志卡片默认聚焦核心信息：动作、状态、上下文类型、会议标题/任务标题
- 其余信息改为可折叠详情（上下文 ID、Run、扩展字段、错误信息）
- 仅 `contextType=orchestration` 展示任务信息，其余展示会议标题
- 保留 `agentSessionId` 的 Session 跳转能力

## 3. 主要改动文件

### 后端

- `backend/src/modules/agents-client/agent-client.service.ts`
- `backend/src/modules/meetings/meeting.service.ts`
- `backend/src/modules/agent-action-logs/agent-action-log.service.ts`
- `backend/src/shared/schemas/agent-action-log.schema.ts`

### 前端

- `frontend/src/services/agentActionLogService.ts`
- `frontend/src/pages/AgentDetail.tsx`

### 文档

- `docs/plan/AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md`
- `docs/feature/MEETING_CHAT.md`
- `docs/api/agent-action-logs-api.md`
- `docs/development/AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md`

## 4. 验证结果

- 后端构建通过：`backend` 下 `npm run build`
- 前端构建通过：`frontend` 下 `npm run build`

## 5. 注意事项

- 历史日志仍可能保留旧 `contextType` 值，新写入日志已切换为 `chat | orchestration`
- 若需统一历史数据口径，可后续补充迁移脚本做批量映射
