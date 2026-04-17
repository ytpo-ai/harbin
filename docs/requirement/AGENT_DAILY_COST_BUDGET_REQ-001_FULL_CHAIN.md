# Requirement: AGENT_DAILY_COST_BUDGET_REQ-001_FULL_CHAIN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [USAGE_BILLING](../feature/USAGE_BILLING.md)、[AGENT_RUNTIME](../feature/AGENT_RUNTIME.md) |
| 所属 Plan | [AGENT_DAILY_COST_BUDGET_PLAN](../plan/AGENT_DAILY_COST_BUDGET_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | in-review |
| 创建日期 | 2026-04-17 |
| 最后更新 | 2026-04-17 |

## 2. 需求描述

### 2.1 背景

现有 Agent budget gate 仅支持 `runCount` 配额，无法按照真实花费（USD）进行日额度限制。需要补齐每日 cost 管控能力，在任务开始前阻断超额执行，并打通系统消息与飞书告警。

### 2.2 目标

1. `AgentBudgetConfig` 新增 `dailyCost` 单位。
2. 基于 `agent_messages` 的 `cost` 字段按 `agentId + 当日时间范围` 聚合已使用成本。
3. 超额时阻断执行并发布 `agent.cost.exceeded` 事件，落 Message Center 系统消息并可转发飞书。
4. 前端创建/编辑 Agent 时提供结构化「每日 Cost 额度 USD」输入并与 `config.budget` 双向映射。

### 2.3 验收条件

- [x] 后端支持 `agent.config.budget.unit='dailyCost'`，且限制 `period='day'`。
- [x] 任务执行前可实时聚合当日 `agent_messages.cost` 并按限额拦截。
- [x] 超额发布 `agent.cost.exceeded` 事件，默认纳入 channel 转发事件白名单。
- [x] 前端 Create/Edit Agent 弹窗支持结构化维护每日 cost 额度（空/0 不启用）。

## 3. 技术方案摘要

- **后端**：在 `agent-opencode-policy.service.ts` 扩展预算解析与门禁分支，新增 daily cost 聚合方法和消息事件发布逻辑。
- **前端**：在 `CreateAgentModal.tsx`、`EditAgentModal.tsx` 增加独立数值字段，提交时覆盖写入 `config.budget`。
- **消息链路**：扩展 `message-center-events` 契约，新增 `agent.cost.exceeded` 事件类型，并加入 Message Center 与 Channel 默认转发白名单。

### 影响范围

- **后端**：预算门禁、消息契约、消息消费默认配置。
- **前端**：Agent 创建/编辑表单。
- **数据库**：读取 `agent_messages` 聚合 cost，不新增集合结构。
- **API**：Agent `config` 结构向后兼容扩展，不新增接口。

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/AGENT_DAILY_COST_BUDGET_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- Daily cost 按当前服务时区自然日计算（`new Date(year, month, day)` 到当前时间）。
- 为避免误拦截，前端字段为空或 `0` 时不会写入 `dailyCost` 预算配置。
