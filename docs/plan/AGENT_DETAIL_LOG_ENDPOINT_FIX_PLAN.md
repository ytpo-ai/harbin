# Agent Detail Log Endpoint Fix Plan

## Goal
修复 Agent 详情页日志查询走错接口的问题，确保 Agent 日志查询使用 `agent-action-logs`。

## Steps
1. 定位前端 Agent 详情页日志请求逻辑。
2. 新增或复用 agent 行为日志 service，调用 `GET /agent-action-logs`。
3. 将 Agent 详情页日志请求参数从 `assistantAgentId` 调整为 `agentId`。
4. 校对页面字段映射，避免沿用人类操作日志字段导致空显示。
5. 更新相关 API 文档引用（如需要）。

## Impact
- Frontend service and Agent detail page log tab
- No backend behavior change
