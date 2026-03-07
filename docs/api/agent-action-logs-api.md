# Agent Action Logs API

## 基础信息

- 对外入口：`http://localhost:3100/api`
- 服务角色：记录 Agent 在会议/计划/任务中的行为日志
- 实现位置：`backend/src/modules/agent-action-logs/agent-action-log.controller.ts`

## 查询 Agent 行为日志

`GET /agent-action-logs`

### Query Parameters

- `agentId` (string, optional)
- `contextType` (string, optional) : `chat` | `orchestration`
- `contextId` (string, optional)：业务上下文 ID（chat 常为会议/讨论 ID；orchestration 常为计划/任务 ID）
- `action` (string, optional)
- `status` (string, optional) :
  - run 相关：`started` | `step_started` | `completed` | `failed` | `paused` | `resumed` | `cancelled`
  - tool 相关：`pending` | `running` | `completed` | `failed`
  - permission 相关：`asked` | `replied` | `denied`
- `action` 常见值（可按前缀过滤）:
  - 任务执行：`task_execution:<contextType>:<taskType>`
  - 聊天执行：`chat_execution:<contextType>:<taskType>`
  - 聊天工具查询：`chat_tool_call`
- `details.agentSessionId`：运行时 session 标识，用于与 Agent Session 详情联查
- `from` (string, optional, ISO 8601)
- `to` (string, optional, ISO 8601)
- `page` (number, optional, default 1)
- `pageSize` (number, optional, default 20)

### Response

```json
{
  "success": true,
  "data": {
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "logs": [
      {
        "id": "uuid",
        "agentId": "agent-id",
        "contextType": "chat",
        "contextId": "meeting-id",
        "action": "chat_execution:chat:discussion",
        "details": {
          "status": "completed",
          "durationMs": 1200,
          "taskId": "task-id",
          "taskTitle": "参与会议讨论: ...",
          "taskType": "discussion",
          "executionMode": "chat",
          "agentSessionId": "meeting-meeting-id-agent-id"
        },
        "timestamp": "2026-03-04T00:00:00.000Z"
      }
    ],
    "fetchedAt": "2026-03-04T00:00:00.000Z"
  }
}
```

说明：`updatedAt` 字段已禁用，日志仅保留 `createdAt`（由 mongoose 自动生成）与业务时间字段 `timestamp`。

## Runtime Hook 内部写入

`POST /agent-action-logs/internal/runtime-hooks`

### Auth

- 仅内部调用。
- Header 需携带：
  - `x-user-context`
  - `x-user-signature`
- 内部上下文需通过签名校验，且 `role=system`。

### Body

```json
{
  "eventId": "evt-...",
  "eventType": "run.started",
  "agentId": "agent-...",
  "sessionId": "meeting-...",
  "runId": "run-...",
  "taskId": "task-...",
  "messageId": "msg-...",
  "partId": "part-...",
  "toolCallId": "call-...",
  "sequence": 1,
  "timestamp": 1740000000000,
  "traceId": "trace-...",
  "payload": {}
}
```

### 行为

- 状态钩子会映射为 `agent_action_logs` 记录，`action=runtime:<eventType>`。
- 通过 `sourceEventId=eventId` 做幂等去重，支持 outbox 重试不重复入库。
