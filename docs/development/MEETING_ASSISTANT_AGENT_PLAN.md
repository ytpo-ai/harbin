# 会议助理与会议监控开发总结

## 1. 目标与范围

- 新增会议管理 MCP 工具，支持查询会议、发送会议消息、修改会议状态。
- 引入会议空闲监控能力：1 小时无消息提醒，2 小时无消息自动结束会议。
- 在角色体系与前端配置中补齐“会议助理”能力，确保可创建并使用。

## 2. 实现内容

### 2.1 MCP 工具

- 在 `backend/apps/agents/src/modules/tools/tool.service.ts` 新增：
  - `builtin.mcp.meeting.list`
  - `builtin.mcp.meeting.sendMessage`
  - `builtin.mcp.meeting.updateStatus`
- 补充工具执行分发、已实现工具列表与 meeting API 调用逻辑。

### 2.2 定时监控（复用 Scheduler）

- 在 `backend/src/modules/orchestration/scheduler/scheduler.service.ts` 中新增系统内置定时计划初始化逻辑。
- 定时检查 active 会议，按阈值执行提醒/结束。
- 修复内置计划执行目标字段，确保符合 schema 约束并可在定时任务页展示：
  - `target.executorType = 'agent'`
  - `target.executorId = 'meeting-assistant'`
  - `target.executorName = '会议助理'`

### 2.3 角色与前端可见性

- 前端 Agent 类型配置增加 `ai-meeting-assistant`：
  - `frontend/src/config/agentType.json`
- 角色种子补齐会议助理映射：
  - `backend/src/modules/roles/roles.service.ts`
  - `agentType: ai-meeting-assistant`
  - `roleCode: meeting-assistant`

## 3. 配置项

- `MEETING_ASSISTANT_INTERVAL_MS`（默认 300000）
- `MEETING_INACTIVE_WARNING_MS`（默认 3600000）
- `MEETING_INACTIVE_END_MS`（默认 7200000）
- `BACKEND_API_URL`（默认 `http://localhost:3001/api`）

## 4. 使用与运维说明

- 变更生效后需重启 backend。
- 若角色管理页未出现“会议助理”，执行一次“从系统角色模板初始化并关联 Agent”。
- 若定时任务页未出现系统会议监控计划，检查服务启动日志与计划表中 `system-meeting-monitor` 记录。

## 5. 风险与后续建议

- 当前仅按 `name=system-meeting-monitor` 查重，分布式并发启动存在重复创建风险。
- 建议后续将初始化逻辑改为幂等 upsert，并为 `name` 增加唯一索引约束。
