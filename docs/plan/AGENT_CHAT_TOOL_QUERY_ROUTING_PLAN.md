# Agent Chat Tool Query Routing Plan

## Goal

修复聊天场景中工具调用默认走任务执行链的问题，明确区分 `chat` 查询与 `task` 执行语义，降低日志噪音与不必要的任务生命周期开销。

## Scope Update (2026-03-07)

- `contextType` 收敛为两类：`chat` / `orchestration`
- `contextId` 保持业务上下文主键（会议 ID / 任务或计划 ID）
- 新增 `details.agentSessionId` 以承载运行会话 ID，消除仅看 `contextId` 的歧义
- 前端展示规则：仅当 `contextType=orchestration` 展示任务信息，其余展示会议标题

## Scope Update (Log List UX)

- 日志列表支持折叠详情：默认仅保留会议标题/任务标题等核心信息可见
- 其余日志详情（上下文 ID、Run、扩展字段、错误文本等）可按条目展开/收起

## Scope

- Agent 聊天入口与工具调用路由（后端）
- `AgentClientService` 执行通道拆分（后端）
- 运行日志事件分类与可观测性字段（后端）
- 相关单元测试与集成测试（测试）
- 功能/API 文档更新（文档）

## Plan

1. 梳理现状调用链，确认 `agent_list_mcp` 在聊天场景下触发 `AgentClientService.executeTaskDetailed` 的入口与兜底条件。
2. 在执行上下文中引入 `executionMode`（`chat | task`），并在聊天/任务入口完成意图路由，避免聊天查询进入任务执行链。
3. 新增轻量查询通道（如 `executeToolQuery`），用于只读元数据类工具调用，并确保不创建任务生命周期记录。
4. 收敛 `executeTaskDetailed` 的职责边界，仅处理任务型执行；对旧兜底路径增加兼容保护与明确日志。
5. 拆分日志事件类型，区分 `chat_tool_call` 与 `task_execution`，并补齐 `mode/toolName/source` 等关键追踪字段。
6. 补充回归测试，覆盖“聊天查询不任务化”“任务执行链不受影响”“兼容路径行为可预期”。
7. 更新相关功能文档与 API 说明，明确执行模式、路由规则与日志字段变化。

## Impact

- Backend: Agent chat orchestration、AgentClientService、工具调用路由层
- API: 内部上下文/DTO 字段（`executionMode`）
- Observability: 日志事件类型与字段扩展
- Tests: 聊天查询与任务执行分流回归
- Docs: `docs/features/`、`docs/api/` 对应条目更新

## Risks / Dependencies

- 现有链路可能依赖任务执行通道副作用（审计/埋点），需在查询通道补齐必要最小能力。
- 日志看板与告警若依赖旧事件聚合口径，需要同步调整查询规则。
- 第三方/插件工具若默认按任务协议接入，需要设置兼容期与降级策略。
