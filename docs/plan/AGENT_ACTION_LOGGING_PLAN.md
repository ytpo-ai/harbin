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
