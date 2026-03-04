# Agent Identity & Evaluation 技术设计文档

## 1. 概述

本文档定义 Agent 简历备忘录（Identity）与工作评估文档（Evaluation）的技术设计方案，基于现有 Memo 架构进行扩展实现。

## 2. 目标

- 将 Agent Identity 从静态占位模板升级为动态聚合的简历文档
- 新增 Evaluation 文档类型，用于存储工作评估数据
- 利用现有 Event Bus + 定时聚合架构，实现数据的自动更新

## 3. 现有架构回顾

### 3.1 Memo 核心模型

```typescript
// backend/apps/agents/src/schemas/agent-memo.schema.ts

type MemoKind = 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom';
type MemoType = 'knowledge' | 'standard';

class AgentMemo {
  id: string;
  agentId: string;
  title: string;
  slug: string;
  content: string;      // Markdown 内容
  version: number;       // 版本号
  memoKind: MemoKind;
  memoType: MemoType;
  payload: Record<string, any>;  // 扩展字段
  tags: string[];
  contextKeywords: string[];
  source: string;        // 数据来源：system-seed, redis-aggregator, identity-aggregator
}
```

### 3.2 版本快照模型

```typescript
// backend/apps/agents/src/schemas/agent-memo-version.schema.ts

class AgentMemoVersion {
  id: string;
  memoId: string;
  version: number;
  content: string;
  changeNote: string;
  createdAt: Date;
}
```

### 3.3 现有事件驱动架构

```
┌─────────────────┐     emit      ┌──────────────────────┐
│ Agent Service   │──────────────▶│  MemoEventBusService │
│ (agent.updated) │               │                      │
└─────────────────┘               └──────────┬───────────┘
                                             │ on('agent.updated')
                                             ▼
┌─────────────────┐               ┌──────────────────────────┐
│ Skill Service   │──────────────▶│  MemoAggregationService │
│(skill_changed)  │               │                          │
└─────────────────┘               │ - flushRefreshQueue()    │
                                 │ - rebuildCache()        │
                                 └──────────────────────────┘
```

**现状问题**：
- 已有事件触发机制，但 `flushRefreshQueue` 仅做缓存刷新
- Identity memo 的 content 从未真正从数据源聚合生成
- 缺少 Evaluation 文档类型

## 4. 数据源设计

### 4.1 Identity 信息源

| 数据源 | Schema | 聚合字段 | 更新频率 |
|--------|--------|---------|---------|
| **Agent 基础信息** | `shared/schemas/agent.schema.ts` | name, type, role, description, systemPrompt, tools, capabilities, personality, learningAbility, isActive, createdAt | 变更时 + 定时 |
| **技能绑定** | `agents/schemas/agent-skill.schema.ts` + `skill.schema.ts` | skillName, proficiencyLevel, assignedBy, createdAt | 变更时 + 定时 |
| **任务履历** | `shared/schemas/orchestration-task.schema.ts` | taskTitle, status, priority, result.summary, startedAt, completedAt | 定时 |

### 4.2 Evaluation 信息源

| 数据源 | Schema | 聚合字段 | 更新频率 |
|--------|--------|---------|---------|
| **工具使用统计** | `agents/schemas/agent-part.schema.ts` | toolId, usageCount, successRate | 定时 |
| **SLA 响应数据** | `agents/schemas/agent-run.schema.ts` | avgResponseTime, successRate | 定时 |

## 5. 文档模板设计

### 5.1 Identity 文档模板

```markdown
# 身份与职责

## Agent Profile
- 角色：<Agent.role>
- 类型：<Agent.type>
- 描述：<Agent.description>
- 系统提示词摘要：<前200字>
- 创建时间：<Agent.createdAt>
- 激活状态：<Agent.isActive>

## 技能矩阵
### 已绑定技能
| 技能名称 | 熟练度 | 绑定时间 | 来源 |
|---------|--------|---------|------|
| TypeScript | expert | 2026-01-15 | AgentSkillManager |
| NestJS | advanced | 2026-02-01 | manual |

### 技能统计
- 总技能数：5
- 专家级：2
- 高级：2
- 中级：1

## 能力域
- **主要领域**：<聚合 skill.category>
- **工具集**：<Agent.tools>
- **模型**：<Agent.model.id> / <Agent.model.provider>

## 工作风格
- 工作伦理：<Agent.personality.workEthic>/100
- 创造力：<Agent.personality.creativity>/100
- 领导力：<Agent.personality.leadership>/100
- 团队协作：<Agent.personality.teamwork>/100
- 学习能力：<Agent.learningAbility>/100

## 任务履历
### 最近完成任务（近30天）
| 任务 | 优先级 | 完成时间 | 状态 | 结果摘要 |
|-----|--------|---------|------|---------|
| Search for cities | high | 2026-03-03 | completed | 找到10个中国人口最多城市 |

### 任务统计
- 总任务数：42
- 完成率：95%
- 平均完成时间：<计算>

## 元信息
- version: 12
- lastAggregatedAt: 2026-03-04T09:00:00Z
- sources: [agent, agent_skills, orchestration_tasks]
```

### 5.2 Evaluation 文档模板

```markdown
# 工作评估

## 工具使用统计
| 工具 | 使用次数 | 成功率 |
|-----|---------|--------|
| websearch | 28 | 92% |
| webfetch | 15 | 87% |
| gmail | 12 | 100% |

## SLA 响应指标
- 平均响应时间：<计算> 秒
- 任务完成率：95%
- 首次响应时间：<计算> 秒

## 质量指标
- 测试通过率：97%
- Lint 通过率：99%
- 回滚率：1%

## 协作评估
- 评审响应时间：<计算> 小时
- 任务接受率：98%

## 元信息
- version: 5
- lastAggregatedAt: 2026-03-04T09:00:00Z
- period: 2026-03-01 ~ 2026-03-31
```

## 6. 服务设计

### 6.1 IdentityAggregationService

```typescript
// backend/apps/agents/src/modules/memos/identity-aggregation.service.ts

@Injectable()
export class IdentityAggregationService implements OnModuleInit, OnModuleDestroy {
  
  async aggregateIdentity(agentId: string, options?: { incremental?: boolean }): Promise<void> {
    // 1. 并行获取所有数据源
    const [agentBasic, skills, taskStats, recentTasks] = await Promise.all([
      this.getAgentBasicInfo(agentId),
      this.getAgentSkills(agentId),
      this.getTaskStatistics(agentId),
      this.getRecentTasks(agentId, 30) // 近30天
    ]);

    // 2. 构建 Markdown 内容
    const content = this.buildIdentityContent({
      agent: agentBasic,
      skills,
      taskStats,
      recentTasks
    });

    // 3. 更新 memo
    await this.updateIdentityMemo(agentId, content, {
      lastAggregatedAt: new Date().toISOString(),
      sources: ['agent', 'agent_skills', 'orchestration_tasks']
    });
  }

  private async getAgentBasicInfo(agentId: string) {
    const agent = await this.agentModel.findOne({ id: agentId }).exec();
    return {
      name: agent.name,
      type: agent.type,
      role: agent.role,
      description: agent.description,
      systemPromptSummary: agent.systemPrompt?.slice(0, 200),
      tools: agent.tools,
      capabilities: agent.capabilities,
      personality: agent.personality,
      learningAbility: agent.learningAbility,
      isActive: agent.isActive,
      createdAt: agent.createdAt
    };
  }

  private async getAgentSkills(agentId: string) {
    const assignments = await this.agentSkillModel.find({ agentId }).exec();
    const skillIds = assignments.map(a => a.skillId);
    const skills = await this.skillModel.find({ id: { $in: skillIds } }).exec();
    
    const skillMap = new Map(skills.map(s => [s.id, s]));
    
    return assignments.map(a => ({
      name: skillMap.get(a.skillId)?.name || 'unknown',
      proficiencyLevel: a.proficiencyLevel,
      assignedBy: a.assignedBy,
      assignedAt: a.createdAt,
      category: skillMap.get(a.skillId)?.category
    }));
  }

  private async getTaskStatistics(agentId: string) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.orchestrationTaskModel.aggregate([
      {
        $match: {
          'assignment.executorId': agentId,
          'assignment.executorType': 'agent',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    // 计算完成率、平均时间等
  }

  private async getRecentTasks(agentId: string, days: number) {
    const thirtyDaysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.orchestrationTaskModel.find({
      'assignment.executorId': agentId,
      'assignment.executorType': 'agent',
      status: 'completed',
      createdAt: { $gte: thirtyDaysAgo }
    }).sort({ completedAt: -1 }).limit(20).exec();
  }

  private buildIdentityContent(data: IdentityData): string {
    // 构建 Markdown 模板
  }
}
```

### 6.2 EvaluationAggregationService

```typescript
// backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts

@Injectable()
export class EvaluationAggregationService {
  
  async aggregateEvaluation(agentId: string, period?: { start: Date; end: Date }): Promise<void> {
    const [toolStats, slaStats, qualityMetrics] = await Promise.all([
      this.getToolUsageStats(agentId, period),
      this.getSlaMetrics(agentId, period),
      this.getQualityMetrics(agentId, period)
    ]);

    const content = this.buildEvaluationContent({ toolStats, slaStats, qualityMetrics });
    await this.updateEvaluationMemo(agentId, content, {
      lastAggregatedAt: new Date().toISOString(),
      period: period || this.getCurrentMonth()
    });
  }

  private async getToolUsageStats(agentId: string, period?: { start: Date; end: Date }) {
    // 从 AgentPart 表聚合 tool_call 类型
  }

  private async getSlaMetrics(agentId: string, period?: { start: Date; end: Date }) {
    // 从 AgentRun 表聚合响应时间、完成任务数等
  }

  private async getQualityMetrics(agentId: string, period?: { start: Date; end: Date }) {
    // 从测试结果、lint 结果等聚合
  }
}
```

### 6.3 事件触发对接

```typescript
// backend/apps/agents/src/modules/memos/memo-aggregation.service.ts

@Injectable()
export class MemoAggregationService implements OnModuleInit, OnModuleDestroy {
  
  constructor(
    private readonly memoService: MemoService,
    private readonly memoEventBus: MemoEventBusService,
    private readonly identityAggregationService: IdentityAggregationService,
    private readonly evaluationAggregationService: EvaluationAggregationService,
  ) {}

  onModuleInit() {
    this.bindEventBusListeners();
    // ... 定时器初始化
  }

  private bindEventBusListeners() {
    // 现有事件
    this.memoEventBus.on('agent.updated', (event) => {
      this.enqueueIdentityAggregation(event.agentId);
    });

    this.memoEventBus.on('agent.skill_changed', (event) => {
      this.enqueueIdentityAggregation(event.agentId);
    });

    // 新增：OrchestrationTask 完成事件
    this.memoEventBus.on('orchestration.task_completed', async (event) => {
      const { executorId, executorType } = event.task?.assignment || {};
      if (executorType === 'agent' && executorId) {
        await this.enqueueIdentityAggregation(executorId);
        await this.enqueueEvaluationAggregation(executorId);
      }
    });

    // 新增：定时全量聚合
    this.memoEventBus.on('scheduled.full_aggregation', async (event) => {
      const allAgents = await this.getAllActiveAgents();
      for (const agentId of allAgents) {
        await this.enqueueIdentityAggregation(agentId);
        await this.enqueueEvaluationAggregation(agentId);
      }
    });
  }
}
```

## 7. Schema 扩展

### 7.1 扩展 MemoKind 枚举

```typescript
// backend/apps/agents/src/schemas/agent-memo.schema.ts

export type MemoKind = 'identity' | 'todo' | 'topic' | 'history' | 'draft' | 'custom' | 'evaluation';
```

### 7.2 Evaluation Payload 设计

```typescript
interface EvaluationPayload {
  topic: 'evaluation';
  period?: {
    start: string;  // ISO date
    end: string;
  };
  lastAggregatedAt?: string;
  sources?: string[];
}
```

## 8. API 设计

### 8.1 新增 API 端点

```typescript
// POST /api/memos/identity/aggregate
// 手动触发 identity 聚合

// POST /api/memos/evaluation/aggregate
// 手动触发 evaluation 聚合

// GET /api/memos/:id/versions
// 已有，复用
```

### 8.2 现有 API 复用

- `GET /api/memos?agentId=xxx&memoKind=identity` - 获取 identity
- `GET /api/memos?agentId=xxx&memoKind=evaluation` - 获取 evaluation
- `GET /api/memos/:id/versions` - 获取版本历史

## 9. 部署配置

### 9.1 环境变量

```bash
# 聚合间隔（毫秒）
MEMO_AGGREGATION_INTERVAL_MS=60000

# 定时全量聚合 cron 表达式（默认每天凌晨 2 点）
MEMO_FULL_AGGREGATION_CRON="0 2 * * *"

# 任务履历保留天数
MEMO_TASK_HISTORY_DAYS=30
```

## 10. 文档落盘

- **Identity**：`docs/memos/<agentId>/identity/identity-and-responsibilities.md`
- **Evaluation**：`docs/memos/<agentId>/evaluation/evaluation-<period>.md`

## 11. 风险与限制

1. **OrchestrationTask 查询性能**：大量任务记录时需添加索引
2. **Markdown 内容膨胀**：长期运行后 content 字段可能过大，需考虑归档策略
3. **定时任务并发**：多 agent 同时触发时需控制并发数

## 12. 后续迭代

1. 增加版本回滚接口
2. 支持手动编辑 identity 内容（优先级高于自动聚合）
3. 增加 identity 内容 diff 对比视图
