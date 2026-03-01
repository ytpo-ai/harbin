# 分层 3：目标与提案层（Goal & Proposal）

## 1. 分层职责

将架构师“期望”转成机器可执行目标，并基于能力差距自动生成改进方案。

## 2. Intent 设计

新增集合：`architect_intents`

推荐字段：
- `intentId`
- `organizationId`
- `name`
- `priority`（P0/P1/P2）
- `objective`（目标表达式）
- `constraints`（硬约束）
- `evaluationWindow`（7d/14d/30d）
- `owner`
- `status`（active/paused/archived）

Intent 示例：

```text
objective:
  task_success_rate >= 0.85
  cost_per_completed_task <= 0.8

constraints:
  failed_plan_ratio <= 0.10
  p95_latency_ms <= 2500
  severe_incident_count == 0
```

## 3. Gap 分析

差距定义：

```text
Gap = IntentTarget - CapabilitySnapshot
```

输出：
- 差距项列表（按影响度排序）
- 根因候选（数据支撑）
- 可行改造方向（策略、流程、角色分配、工具选择）

## 4. 提案生成

新增集合：`evolution_proposals`

推荐字段：
- `proposalId`
- `intentId`
- `hypothesis`
- `candidateChanges`
- `expectedImpact`
- `riskLevel`（low/medium/high）
- `dependencies`
- `rollbackPlan`
- `approvalPolicy`
- `status`（draft/review/approved/rejected/experimenting/completed）

提案格式要求：
- 一条假设 + 一组可验证变更
- 明确指标、窗口、样本量
- 明确停机条件与回滚动作

## 5. 与现有能力结合

- 使用编排能力生成提案执行任务（可复用计划与任务拆分思路）
- 使用统一消息沉淀提案讨论与复盘
- 使用 HR 与工具统计补充影响分析

## 6. 验收标准

- 每个 active Intent 至少有 1 条可执行提案
- 提案完整率（含假设/指标/回滚）= 100%
- 高风险提案默认需人工审批
