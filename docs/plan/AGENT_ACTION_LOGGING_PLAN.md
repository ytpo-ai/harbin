# Agent Action Logging Plan

## Goal
为所有 agent 行为写入日志，清晰记录 agent 在会议/计划/任务中的操作与状态。

## Scope
- Backend only
- 新增 agent 行为日志 schema 与 service
- 在 agent 执行入口、会议、编排任务执行处写入日志
- 可选提供查询接口

## Steps
1. 新建 `agent-action-log` schema，包含 agentId、contextType、contextId、action、status、durationMs、details。
2. 新建 `agent-action-log` service，提供统一记录方法。
3. 在 `AgentClientService.executeTaskDetailed` 中记录开始/完成/失败日志。
4. 在 `MeetingService` 中记录 agent 参与会议及会议内任务执行日志。
5. 在 `OrchestrationService` 中记录 plan/task 执行日志。
6. 如需要，新增 `AgentActionLogsController` 查询接口。
7. 运行 lint/typecheck。

## Impacts
- Backend modules and database collection
- Logging pipeline for agent execution

## Risks/Dependencies
- 需确保日志写入不影响主执行链路（失败时不阻断）
- 需统一 contextType 与 status 枚举

## Phase 2 (Data Shape Optimization)
1. 将 `status` 与 `durationMs` 从顶层字段迁移为 `details.status` 与 `details.durationMs`。
2. schema 关闭 `updatedAt` 自动字段，仅保留 `createdAt` 与业务 `timestamp`。
3. 查询接口保留 `status` 过滤能力，内部改为匹配 `details.status`（兼容旧数据）。
4. 前端改为读取 `details.status` 与 `details.durationMs`。
5. 更新 API 文档字段示例。

## Phase 3 (Runtime Hook -> Action Logs Sync)
### Goal
让 agent runtime 的状态钩子在触发时，同步产出 `agent_action_logs`，用于统一查询与审计。

### Steps
1. 在 runtime hook 分发链路新增日志同步器，监听状态型事件并映射为 action log。
2. 为 `agent-action-logs` 增加内部写入入口（internal endpoint），支持通过内部签名上下文调用。
3. 为 action log 增加 `sourceEventId` 去重字段，保证 hook 重试下日志幂等。
4. 映射规则覆盖：`run.started|completed|failed|paused|resumed|cancelled`、`tool.pending|running|completed|failed`、`permission.asked|replied|denied`。
5. 统一补充 `runId/sessionId/taskId/traceId/toolCallId/sequence` 到 `details`，并按上下文推断 `contextType/contextId`。
6. 更新前端状态枚举以支持新状态筛选与展示。
7. 运行构建验证并补充 API/功能文档。

### Impacts
- `backend/apps/agents` runtime 模块（hook dispatch）
- `backend/src` agent-action-logs 模块（内部写入、幂等）
- `frontend` Agent 详情日志筛选/展示

### Risks/Dependencies
- 跨服务调用依赖 `BACKEND_SERVICE_URL` 与内部签名校验。
- hook 高频事件需做白名单控制，避免写入 `llm.delta` 导致日志爆量。
