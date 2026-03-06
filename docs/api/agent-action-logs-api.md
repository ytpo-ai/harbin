# Agent Action Logs API

## 基础信息

- 对外入口：`http://localhost:3100/api`
- 服务角色：记录 Agent 在会议/计划/任务中的行为日志
- 实现位置：`backend/src/modules/agent-action-logs/agent-action-log.controller.ts`

## 查询 Agent 行为日志

`GET /agent-action-logs`

### Query Parameters

- `agentId` (string, optional)
- `contextType` (string, optional) : `meeting` | `plan` | `task` | `unknown`
- `contextId` (string, optional)
- `action` (string, optional)
- `status` (string, optional) : `started` | `completed` | `failed`
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
        "contextType": "meeting",
        "contextId": "meeting-id",
        "action": "meeting:discussion",
        "details": {
          "status": "completed",
          "durationMs": 1200,
          "taskId": "task-id",
          "taskTitle": "参与会议讨论: ...",
          "taskType": "discussion"
        },
        "timestamp": "2026-03-04T00:00:00.000Z"
      }
    ],
    "fetchedAt": "2026-03-04T00:00:00.000Z"
  }
}
```

说明：`updatedAt` 字段已禁用，日志仅保留 `createdAt`（由 mongoose 自动生成）与业务时间字段 `timestamp`。
