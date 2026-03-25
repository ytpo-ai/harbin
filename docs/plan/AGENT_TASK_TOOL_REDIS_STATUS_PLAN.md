# Agent Task Tool Redis 状态 + Agents MCP 查询计划

## 1. 需求理解

- 在 Agent 执行任务期间，按 **task tool 粒度**将当前状态写入 Redis。
- 不新增数据库持久化，状态仅保存在 Redis。
- 任务执行结束后（成功/失败/取消/超时）统一回写为空闲状态。
- 状态查询能力复用现有 `builtin.sys-mg.internal.agent-master.list-agents`，新增可选指定 `agentId` 参数并返回当前状态。

## 2. 执行步骤

1. 梳理 Agent Task + Tool 调用生命周期切点，确定状态写入时机与兜底清理点。
2. 设计 Redis 状态模型与 key 规范（agent 维度，含 `taskId/toolId/toolName/status/updatedAt`）。
3. 在 tool 执行链路接入状态写入（pending/running/completed/failed），并在任务终态统一写 `idle`。
4. 改造 `agent-master.list-agents`：支持可选 `agentId` 过滤，并拼装 Redis 状态到返回结果。
5. 补充/更新测试，覆盖状态流转、终态归位、列表查询与指定 agent 查询。
6. 进行最小验证（lint/typecheck/相关测试），确认无回归。

## 3. 关键影响点

- 后端 Agents Runtime/Task/Tool 执行链路
- Redis 状态读写服务
- Agent MCP（`list-agents` 参数与返回结构）
- 文档同步（feature/development 按需补充）

## 4. 风险与依赖

- 并发工具调用可能导致状态覆盖，需要保证状态字段可解释（携带 task/tool 与时间戳）。
- 异常中断分支可能遗漏回写，需在终态/释放阶段统一兜底写入 `idle`。
- 依赖现有 Redis 客户端与 MCP 工具注册机制，无需新增 DB schema。
