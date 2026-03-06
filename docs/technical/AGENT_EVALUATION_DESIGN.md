# Agent Evaluation 技术设计文档

## 1. 概述

本文档定义 Agent 工作评估文档（Evaluation）的技术设计方案，基于现有 Memo 架构进行扩展实现。

## 2. 目标

- 新增 Evaluation 文档类型，用于存储工作评估数据
- 聚合任务统计、技能统计、工具使用统计、SLA 响应数据、质量指标
- 利用现有 Event Bus + 定时聚合架构，实现数据的自动更新

## 3. Evaluation 数据源设计

### 3.1 信息源

| 数据源 | Schema | 聚合字段 | 更新频率 |
|--------|--------|---------|---------|
| **任务统计** | `shared/schemas/orchestration-task.schema.ts` | taskTitle, status, priority, resultSummary, startedAt, completedAt | 定时 |
| **技能统计** | `agents/schemas/agent-skill.schema.ts` + `skill.schema.ts` | skillName, proficiencyLevel, category | 定时 |
| **工具使用统计** | `agents/schemas/agent-part.schema.ts` | toolId, usageCount, successRate | 定时 |
| **SLA 响应数据** | `agents/schemas/agent-run.schema.ts` | avgResponseTime, successRate | 定时 |

## 4. Evaluation 文档模板

```markdown
# 工作评估

## 任务统计
### 任务完成情况（近30天）
| 任务 | 优先级 | 完成时间 | 状态 | 结果摘要 |
|-----|--------|---------|------|---------|
| Search for cities | high | 2026-03-03 | completed | 找到10个中国人口最多城市 |

### 任务统计
- 总任务数：42
- 完成率：95%
- 平均完成时间：<计算>

## 技能统计
### 技能分布
| 技能名称 | 熟练度 | 类别 |
|---------|--------|------|
| TypeScript | expert | programming |
| NestJS | advanced | framework |

### 技能统计
- 总技能数：5
- 专家级：2
- 高级：2
- 中级：1

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

## 5. EvaluationAggregationService 设计

```typescript
// backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts

@Injectable()
export class EvaluationAggregationService {
  
  async aggregateEvaluation(agentId: string, period?: { start: Date; end: Date }): Promise<void> {
    const [taskStats, skillStats, toolStats, slaStats, qualityMetrics] = await Promise.all([
      this.getTaskStatistics(agentId, period),
      this.getSkillStatistics(agentId),
      this.getToolUsageStats(agentId, period),
      this.getSlaMetrics(agentId, period),
      this.getQualityMetrics(agentId, period)
    ]);

    const content = this.buildEvaluationContent({ taskStats, skillStats, toolStats, slaStats, qualityMetrics });
    await this.updateEvaluationMemo(agentId, content, {
      lastAggregatedAt: new Date().toISOString(),
      period: period || this.getCurrentMonth()
    });
  }

  private async getTaskStatistics(agentId: string, period?: { start: Date; end: Date }) {
    const startDate = period?.start || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = period?.end || new Date();
    
    const result = await this.orchestrationTaskModel.aggregate([
      {
        $match: {
          'assignment.executorId': agentId,
          'assignment.executorType': 'agent',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const recentTasks = await this.orchestrationTaskModel.find({
      'assignment.executorId': agentId,
      'assignment.executorType': 'agent',
      status: 'completed',
      createdAt: { $gte: startDate }
    }).sort({ completedAt: -1 }).limit(20).exec();
    
    return { stats: result, recentTasks };
  }

  private async getSkillStatistics(agentId: string) {
    const assignments = await this.agentSkillModel.find({ agentId }).exec();
    const skillIds = assignments.map(a => a.skillId);
    const skills = await this.skillModel.find({ id: { $in: skillIds } }).exec();
    
    const skillMap = new Map(skills.map(s => [s.id, s]));
    
    const skillsWithCategory = assignments.map(a => ({
      name: skillMap.get(a.skillId)?.name || 'unknown',
      proficiencyLevel: a.proficiencyLevel,
      category: skillMap.get(a.skillId)?.category
    }));
    
    const proficiencyCount = {
      expert: skillsWithCategory.filter(s => s.proficiencyLevel === 'expert').length,
      advanced: skillsWithCategory.filter(s => s.proficiencyLevel === 'advanced').length,
      intermediate: skillsWithCategory.filter(s => s.proficiencyLevel === 'intermediate').length,
    };
    
    return { skills: skillsWithCategory, proficiencyCount };
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

## 6. 事件触发对接

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

### 7.1 MemoKind 枚举

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
// POST /api/memos/evaluation/aggregate
// 手动触发 evaluation 聚合
```

### 8.2 现有 API 复用

- `GET /api/memos?agentId=xxx&memoKind=evaluation` - 获取 evaluation
- `GET /api/memos/:id/versions` - 获取版本历史

## 9. 部署配置

### 9.1 环境变量

```bash
# 聚合间隔（毫秒）
MEMO_AGGREGATION_INTERVAL_MS=60000

# 定时全量聚合 cron 表达式（默认每天凌晨 2 点）
MEMO_FULL_AGGREGATION_CRON="0 2 * * *"

# 评估周期天数
MEMO_EVALUATION_PERIOD_DAYS=30
```

## 10. 文档落盘

- **Evaluation**：`docs/memos/<agentId>/evaluation/evaluation-<period>.md`

## 11. 风险与限制

1. **数据查询性能**：大量运行记录时需添加索引
2. **历史数据存储**：长期评估数据需要考虑归档策略
3. **定时任务并发**：多 agent 同时触发时需控制并发数

## 12. 后续迭代

1. 增加评估报告导出功能（PDF/Excel）
2. 支持自定义评估指标
3. 增加评估趋势图表
4. 支持跨周期对比分析
