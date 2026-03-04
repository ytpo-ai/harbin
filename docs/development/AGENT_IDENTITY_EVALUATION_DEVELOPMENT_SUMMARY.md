# Agent Identity & Evaluation 开发总结

## 1. 需求回顾

本次开发围绕"Agent 简历备忘录（Identity）"和"工作评估文档（Evaluation）"展开，核心目标：

1. **Identity**：将 Agent 的静态占位模板升级为动态聚合的简历文档
2. **Evaluation**：新增工作评估文档类型，用于存储工具使用统计和 SLA 指标
3. **数据源**：任务履历数据来源于 OrchestrationTask（编排层任务），而非 Agent 内部琐碎执行记录
4. **触发机制**：复用现有 Event Bus + 定时聚合架构

## 2. 架构设计

### 2.1 文档类型

| 类型 | 用途 | 数据源 |
|------|------|--------|
| Identity | Agent 动态简历 | Agent、AgentSkill、Skill、OrchestrationTask |
| Evaluation | 工作绩效评估 | AgentRun、AgentPart |

### 2.2 核心服务

- **IdentityAggregationService**：负责聚合 Agent 简历
  - `getAgentBasicInfo()` - Agent 基础信息
  - `getAgentSkills()` - 技能矩阵
  - `getTaskStatistics()` / `getRecentTasks()` - 任务履历
  - `buildIdentityContent()` - Markdown 生成

- **EvaluationAggregationService**：负责聚合工作评估
  - `getToolUsageStats()` - 工具使用统计
  - `getSlaMetrics()` - SLA 指标
  - `buildEvaluationContent()` - Markdown 生成

### 2.3 触发机制

- **事件驱动**：`agent.updated`、`agent.skill_changed`、`task.completed`
- **定时任务**：默认每天全量聚合（通过 `MEMO_FULL_AGGREGATION_INTERVAL_MS` 配置）
- **手动触发**：提供 API 端点供手动调用

## 3. 关键代码改动

### 3.1 Schema 层

**`backend/apps/agents/src/schemas/agent-memo.schema.ts`**
```typescript
// MemoKind 枚举新增 'evaluation'
export type MemoKind = 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom' | 'evaluation';
```

### 3.2 新增服务

| 文件 | 说明 |
|------|------|
| `identity-aggregation.service.ts` | Identity 聚合服务 |
| `evaluation-aggregation.service.ts` | Evaluation 聚合服务 |

### 3.3 Module 注册

**`backend/apps/agents/src/modules/memos/memo.module.ts`**
- 注册 `IdentityAggregationService`
- 注册 `EvaluationAggregationService`
- 注册所需 Model：Agent、AgentSkill、Skill、OrchestrationTask、AgentRun、AgentPart

### 3.4 Controller 扩展

**`backend/apps/agents/src/modules/memos/memo.controller.ts`**
- `POST /api/memos/identity/aggregate` - 手动触发 Identity 聚合
- `POST /api/memos/evaluation/aggregate` - 手动触发 Evaluation 聚合

### 3.5 事件总线扩展

**`backend/apps/agents/src/modules/memos/memo-event-bus.service.ts`**
```typescript
export type MemoDomainEventName =
  | 'agent.updated'
  | 'agent.skill_changed'
  | 'task.completed'
  | 'orchestration.task_completed'
  | 'scheduled.full_aggregation';
```

## 4. 文档模板

### 4.1 Identity 模板

```markdown
# 身份与职责

## Agent Profile
- 角色：<Agent.role>
- 类型：<Agent.type>
- ...

## 技能矩阵
### 已绑定技能
| 技能名称 | 熟练度 | 绑定时间 | 来源 | 领域 |

## 能力域
- **主要领域**：<聚合 skill.category>
- **工具集**：<Agent.tools>

## 工作风格
- 工作伦理：<Agent.personality.workEthic>/100
- ...

## 任务履历
### 任务统计（近30天）
- **总任务数**：<OrchestrationTask 统计>
- **完成率**：<计算>

### 最近完成任务
| 任务 | 优先级 | 完成时间 | 状态 | 结果摘要 |
```

### 4.2 Evaluation 模板

```markdown
# 工作评估

**评估周期**：2026-03-01 ~ 2026-03-31

## 工具使用统计
| 工具 | 使用次数 | 成功次数 | 成功率 |

## SLA 响应指标
- **总任务数**：<AgentRun 统计>
- **完成率**：<计算>
- **平均响应时间**：<计算> 秒

## 元信息
- version: <timestamp>
- lastAggregatedAt: <ISO date>
```

## 5. 环境配置

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `MEMO_AGGREGATION_INTERVAL_MS` | 事件聚合间隔 | 60000 (60秒) |
| `MEMO_FULL_AGGREGATION_INTERVAL_MS` | 全量聚合间隔 | 86400000 (24小时) |

## 6. API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memos` | 分页查询 |
| POST | `/api/memos/search` | 检索 |
| POST | `/api/memos/identity/aggregate` | 手动触发 Identity 聚合 |
| POST | `/api/memos/evaluation/aggregate` | 手动触发 Evaluation 聚合 |

## 7. 验证方式

```bash
# 触发 Identity 聚合
curl -X POST http://localhost:3003/api/memos/identity/aggregate \
  -H "Content-Type: application/json" \
  -d '{"agentId": "<agent-id>"}'

# 触发 Evaluation 聚合
curl -X POST http://localhost:3003/api/memos/evaluation/aggregate \
  -H "Content-Type: application/json" \
  -d '{"agentId": "<agent-id>"}'
```

## 8. 后续迭代

1. **OrchestrationTask 事件对接**：目前通过 `task.completed` 事件触发，未来可考虑直接从 OrchestrationService 发布 `orchestration.task_completed` 事件
2. **版本回滚**：支持指定历史版本恢复
3. **手动编辑优先级**：支持手动编辑 identity 内容，自动聚合作为补充
4. **前端展示**：增加 Identity 和 Evaluation 文档的前端展示页面

## 9. 依赖文件

- `docs/technical/AGENT_IDENTITY_EVALUATION_DESIGN.md` - 技术设计文档
- `docs/plan/AGENT_IDENTITY_EVALUATION_DEVELOPMENT_PLAN.md` - 开发计划
- `docs/features/AGENT_MEMO.md` - 功能文档更新
