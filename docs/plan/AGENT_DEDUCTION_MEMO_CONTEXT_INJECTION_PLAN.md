# Agent 扣分记录 Memo + 上下文注入 Plan

## 背景

Agent 在执行任务时反复出现相同类型的扣分（如 generating 阶段总是 77 分、pre-execution 总是 85 分），说明 LLM 缺少对历史错误的认知反馈。需要将扣分历史沉淀为 memo 文档，并在执行上下文中注入扣分提醒，帮助 agent 避免重蹈覆辙。

## 方案概要

### 1. 新增 `memoKind: 'deduction'`

独立于现有 `criticism` kind，专用于扣分历史记录。

### 2. 扣分聚合服务 `DeductionAggregationService`

- 数据来源：`agent_run_scores` 集合
- 聚合写入：`agent_memos` 集合（memoKind='deduction'）
- 聚合后刷新 Redis 缓存 key `memo:{agentId}:deduction`

### 3. 分层数据策略

| 区块 | 策略 | 说明 |
|------|------|------|
| 近 10 次 Run 扣分明细 | 每次覆盖写入 content | 从 DB 查最新 10 条 |
| 近 2 天扣分统计 | 每次覆盖写入 content | 从 DB 聚合近 2 天数据 |
| 历史总结 | 增量累加在 payload | payload 中维护累计计数器，每次聚合做增量 delta |

### 4. 上下文注入 `DeductionContextBuilder`

- 新增 ContextLayer `'deduction'`
- 数据源：从 Redis 读取 `memo:{agentId}:deduction` 缓存文档
- 注入位置：`memory` 层之前
- 仅当有扣分记录时注入（shouldInject 条件守卫）

### 5. 暂停 Identity Memo 注入

在 `IdentityContextBuilder.build()` 中跳过 identity memo 内容部分（保留 identity base: guideline + systemPrompt + promptTemplate）。

## 执行步骤

1. Schema: `agent-memo.schema.ts` — MemoKind 增加 `'deduction'`
2. Service: `memo.service.ts` — 兼容性规则、slug 映射、allowed kinds 增加 `'deduction'`
3. 新建: `deduction-aggregation.service.ts` — 扣分聚合服务
4. 更新: `memo-aggregation.service.ts` — 集成扣分聚合触发
5. 更新: `memo.module.ts` — 注册新服务 + AgentRunScore schema
6. 接口: `context-block-builder.interface.ts` — ContextLayer 增加 `'deduction'`
7. 新建: `deduction-context.builder.ts` — 扣分上下文构建器
8. 更新: `context-assembler.service.ts` — 注入新 builder
9. 更新: `context.module.ts` — 注册新 builder
10. 更新: `identity-context.builder.ts` — 跳过 identity memo 注入
11. Lint + Typecheck 验证

## 影响范围

- 后端: memos 模块、context 模块
- 数据库: 复用 `agent_memos` 集合
- 前端: 无变更
- Redis: 新增 key `memo:{agentId}:deduction`
