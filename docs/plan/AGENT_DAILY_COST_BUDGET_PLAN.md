# Plan: Agent 每日 Cost 额度管控

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [USAGE_BILLING](../feature/USAGE_BILLING.md)、[AGENT_RUNTIME](../feature/AGENT_RUNTIME.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-17 |

## 2. 背景

当前 Agent 的 budget gate（`agent-opencode-policy.service.ts`）仅支持 `runCount` 维度的额度管控，无法按实际花费（cost/USD）进行限制。需要新增 **每日 cost 额度（dailyCost）** 能力：

- 在 Agent 配置中设定每日 cost 上限（USD）
- 任务开始前检测当日已消耗 cost 是否超额
- 超额时自动发送 **飞书消息** + **系统消息（Message Center）** 通知
- 任务完成后 cost 已通过现有 `agent_messages.cost` 自动记录，无需额外更新逻辑

## 3. 目标

1. 扩展 `AgentBudgetConfig.unit` 支持 `dailyCost` 类型
2. 任务执行前按 agentId + 当日时间范围从 `agent_messages` 聚合已消耗 cost，与配置的 `limit` 比较
3. 超额时拦截执行，同时发布 `system_alert` 事件到 Message Center，自动持久化为系统消息并转发到飞书
4. 前端在 EditAgentModal / CreateAgentModal 的「基本信息」tab 中新增结构化的「每日 Cost 额度」输入框

## 4. 执行步骤

1. [x] 落盘 Plan 文档
2. [x] **后端：扩展 AgentBudgetConfig 支持 `dailyCost` 单位**
   - 修改 `agent-opencode-policy.service.ts`
   - `AgentBudgetConfig.unit` 从 `'runCount'` 扩展为 `'runCount' | 'dailyCost'`
   - 新增 `evaluateAgentDailyCostUsage()` 方法，从 `agent_messages` 按 agentId + 当日范围聚合 cost
   - 扩展 `applyAgentBudgetGate()` 使 `dailyCost` 单位走 cost 检测分支
3. [x] **后端：新增 cost 超额事件 + 通知**
   - 修改 `libs/infra/src/message-center-events.ts`，新增 `agent.cost.exceeded` 事件类型
   - 在 budget gate 拦截时发布 `system_alert` 类型事件到 `message-center.events` topic
   - 事件自动被 `MessageCenterEventConsumerService` 持久化为系统消息
   - 事件通过 `CHANNEL_FORWARD_EVENT_TYPES` 配置转发到飞书
4. [x] **前端：EditAgentModal / CreateAgentModal 新增「每日 Cost 额度」结构化表单字段**
   - 在「基本信息」tab 新增独立的数字输入框（label: 每日 Cost 额度 USD）
   - 表单提交时写入 `config.budget = { period: 'day', unit: 'dailyCost', limit: N }`
   - 编辑时从 `agent.config.budget` 反解回显到输入框
   - 值为空或 0 时不写入 budget 配置（不启用 cost 管控）
5. [x] **文档更新**
   - 更新 `docs/feature/USAGE_BILLING.md` 和 `docs/feature/AGENT_RUNTIME.md` 追溯表
   - 更新 dailylog

## 5. Requirement 拆解

本 plan 为一条完整链路（schema → 后端逻辑 → 事件 → 前端），不拆分独立 requirement。

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | Agent 每日 Cost 额度管控（全链路） | [链接](../requirement/AGENT_DAILY_COST_BUDGET_REQ-001_FULL_CHAIN.md) | in-review |

## 6. 关键影响点

- **后端**：`agent-opencode-policy.service.ts`（核心逻辑）、`message-center-events.ts`（事件类型扩展）
- **前端**：`EditAgentModal.tsx`、`CreateAgentModal.tsx`（新增结构化表单字段）
- **数据库**：读取 `agent_messages` 集合（已有 `agentId + createdAt` 索引，日粒度聚合量可控）
- **消息**：Message Center 事件流 → 系统消息持久化 → 飞书 Channel 转发
- **文档**：`USAGE_BILLING.md`、`AGENT_RUNTIME.md`

## 7. 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `agent.cost.exceeded` 需加入 `CHANNEL_FORWARD_EVENT_TYPES` 配置 | 不加入则飞书不转发 | 在代码中将新事件类型加入默认转发列表 |
| cost 聚合查询性能 | 高频任务场景下可能有延迟 | `agent_messages` 已有 `agentId + createdAt` 复合索引，日粒度数据量可控 |
| 与现有 `runCount` budget 的共存 | 两种 unit 不能同时生效 | 一个 agent 的 budget config 只允许一种 unit |

## 8. 备注

- 现有 cost 写入链路：`ModelService.chat()` → `agent_messages.cost` 已自动补齐，无需在任务完成时额外更新
- 当日 cost 聚合直接从 `agent_messages` 实时查询，不依赖 `agent_usage_daily_snapshots`（快照是 T+1 生成的）
