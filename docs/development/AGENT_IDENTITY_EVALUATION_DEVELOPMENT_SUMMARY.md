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

---

## 计划原文（合并归档：AGENT_IDENTITY_EVALUATION_DEVELOPMENT_PLAN.md）

# Agent Identity & Evaluation 开发计划

## 阶段一：技术设计文档

- [x] 创建 `docs/technical/AGENT_IDENTITY_EVALUATION_DESIGN.md`

## 阶段二：Model 层扩展

- [x] 1. 扩展 `AgentMemo` schema，新增 `memoKind: 'evaluation'` 类型支持
  - 文件：`backend/apps/agents/src/schemas/agent-memo.schema.ts`
  - 修改：`MemoKind` 枚举新增 `'evaluation'`

- [x] 2. 更新前端 `AgentMemo` TypeScript 类型
  - 文件：`frontend/src/types/index.ts`
  - 修改：`memoKind` 类型新增 `'evaluation'`

## 阶段三：Identity 聚合服务开发

- [x] 3. 新增 `IdentityAggregationService` 服务
  - 文件：`backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`
  - 依赖：`Agent`, `AgentSkill`, `Skill`, `OrchestrationTask` Model

- [x] 4. 实现从 Agent 表聚合基础信息
  - 方法：`getAgentBasicInfo(agentId)`
  - 字段：name, type, role, description, systemPrompt, tools, capabilities, personality, learningAbility

- [x] 5. 实现从 AgentSkill + Skill 表聚合技能矩阵
  - 方法：`getAgentSkills(agentId)`
  - 联合查询并格式化技能列表

- [x] 6. 实现从 OrchestrationTask 表聚合任务履历
  - 方法：`getTaskStatistics(agentId)`, `getRecentTasks(agentId, days)`
  - 统计完成率、平均时间等

- [x] 7. 实现 Markdown 内容构建器
  - 方法：`buildIdentityContent(data)`
  - 输出符合模板的 Markdown

- [x] 8. 注册到 MemoModule
  - 文件：`backend/apps/agents/src/modules/memos/memo.module.ts`
  - 注入 `IdentityAggregationService`

## 阶段四：Evaluation 文档服务开发

- [x] 9. 新增 `EvaluationAggregationService` 服务
  - 文件：`backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts`

- [x] 10. 实现工具使用统计聚合
  - 方法：`getToolUsageStats(agentId, period)`
  - 数据源：`AgentPart` 表（tool_call 类型）

- [x] 11. 实现 SLA 响应数据聚合
  - 方法：`getSlaMetrics(agentId, period)`
  - 数据源：`AgentRun` 表

- [x] 12. 实现 Markdown 内容构建器
  - 方法：`buildEvaluationContent(data)`

- [x] 13. 注册到 MemoModule

## 阶段五：触发机制对接

- [x] 14. 扩展 `MemoEventBusService` 事件类型
  - 文件：`backend/apps/agents/src/modules/memos/memo-event-bus.service.ts`
  - 新增事件：`'orchestration.task_completed'`

- [x] 15. 在 `MemoAggregationService` 中注册新服务
  - 注入 `IdentityAggregationService` 和 `EvaluationAggregationService`
  - 实现事件监听逻辑

- [x] 16. 在 MemoController 中添加手动触发 API
  - `POST /api/memos/identity/aggregate` - 手动触发 Identity 聚合
  - `POST /api/memos/evaluation/aggregate` - 手动触发 Evaluation 聚合

## 阶段六：定时聚合任务

- [x] 17. 实现每日全量聚合定时任务
  - 使用 `setInterval`（原生）
  - 默认每天凌晨执行（通过 `MEMO_FULL_AGGREGATION_INTERVAL_MS` 配置）

- [x] 18. 添加相关配置项
  - 环境变量：`MEMO_FULL_AGGREGATION_INTERVAL_MS`

## 阶段七：文档与测试

- [x] 19. 更新功能文档 `docs/features/AGENT_MEMO.md`
  - 新增 Identity 和 Evaluation 描述

- [x] 20. 运行 lint 检查
  - 构建通过

- [x] 21. 运行类型检查
  - `npm run build:agents` 通过

- [x] 22. 验证功能
  - 手动触发 API 已添加：`POST /api/memos/identity/aggregate` 和 `POST /api/memos/evaluation/aggregate`

---

## 关键影响点

| 模块 | 影响范围 | 优先级 |
|------|---------|--------|
| 后端 | 新增 2 个 aggregation service + Event Bus 扩展 | 高 |
| Schema | 新增 memoKind 枚举值 | 高 |
| 前端 | 类型同步（低优先级，可后续处理） | 低 |

## 预计工作量

- 阶段二：0.5 小时
- 阶段三：2 小时
- 阶段四：1.5 小时
- 阶段五：1 小时
- 阶段六：0.5 小时
- 阶段七：1 小时

**总计：约 6.5 小时**

## 依赖关系

```
阶段二 (Schema)
    │
    ▼
阶段三 (Identity) ─────┐
                       │
阶段四 (Evaluation) ───┼──▶ 阶段五 (触发机制) ──▶ 阶段六 (定时) ──▶ 阶段七
                       │
    (独立，可并行)      │
```
