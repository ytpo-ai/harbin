# Orchestration 增量计划编排 — 技术设计文档

## 1. 设计概述

本文档描述 Orchestration 编排模块从"批量任务生成"到"增量逐步编排"的技术架构设计。核心理念是将编排智能完全交给 planner agent，系统仅负责执行调度、结果验证、约束守护和任务合并。

### 1.1 架构定位

```
┌─────────────────────────────────────────────────────────────┐
│                     Plan Management                         │
│  createPlanFromPrompt() → 仅创建 Plan，不生成任务           │
│  startGeneration()      → 启动增量编排                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              IncrementalPlanningService                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  executeIncrementalPlanning(planId) — 核心编排循环   │    │
│  │                                                     │    │
│  │  while (!goalReached && !constraintExceeded) {      │    │
│  │    1. buildPlannerContext()                          │    │
│  │    2. planner.generateNextTask()                    │    │
│  │    3. createTask() + executeTask()                  │    │
│  │    4. validateResult()                              │    │
│  │    5. tryMergeWithPrevious()                        │    │
│  │    6. updateGenerationState()                       │    │
│  │  }                                                  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  依赖:                                                      │
│  - PlannerService          (AI 指令生成)                    │
│  - ExecutionEngineService  (任务执行)                       │
│  - PlanStatsService        (状态同步)                       │
│  - PlanEventStreamService  (SSE 推送)                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 与现有架构的关系

```
                   orchestration.service.ts (Facade)
                              │
        ┌─────────────────────┼─────────────────────────┐
        │                     │                         │
plan-management       incremental-planning        plan-execution
(Plan CRUD)           (增量编排引擎, 新增)        (Run 模式执行, 保留)
        │                     │
        │              planner.service.ts
        │              (重构: 逐步生成)
        │
        └──── 原 generatePlanTasksAsync (废弃)
```

- `plan-execution.service.ts`（Run 模式）保留不动，供 `generationMode='batch'` 的旧 plan 使用
- `incremental-planning.service.ts` 是新增的增量编排引擎，独立于 Run 模式
- 两种模式共享 `orchestration-execution-engine.service.ts` 执行单个任务

---

## 2. 数据模型变更

### 2.1 OrchestrationPlan — 新增字段

```typescript
// backend/src/shared/schemas/orchestration-plan.schema.ts

// 新增: 编排生成模式
@Prop({ enum: ['batch', 'incremental'], default: 'incremental' })
generationMode: 'batch' | 'incremental';

// 新增: 任务默认执行类型（创建 Plan 时可选指定，task 继承此值）
@Prop({ enum: ['external_action', 'research', 'review', 'development', 'general'], required: false })
defaultTaskType?: 'external_action' | 'research' | 'review' | 'development' | 'general';

// 新增: 增量编排约束配置
@Prop(raw({
  maxRetries: { type: Number, default: 3 },       // 单任务最大重试次数
  maxCostTokens: { type: Number, default: 500000 }, // 总 token 成本上限
  maxTasks: { type: Number, default: 15 },          // 最大任务数
}))
generationConfig: {
  maxRetries: number;
  maxCostTokens: number;
  maxTasks: number;
};

// 新增: 增量编排运行时状态
@Prop(raw({
  currentStep: { type: Number, default: 0 },
  totalGenerated: { type: Number, default: 0 },
  totalRetries: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
  isComplete: { type: Boolean, default: false },
  lastError: { type: String },
}))
generationState: {
  currentStep: number;
  totalGenerated: number;
  totalRetries: number;
  totalCost: number;
  isComplete: boolean;
  lastError?: string;
};
```

### 2.2 OrchestrationTask — 新增字段

```typescript
// backend/src/shared/schemas/orchestration-task.schema.ts

// 新增: 合并来源追踪
@Prop({ type: [String], default: [] })
mergedFromTaskIds: string[];
```

### 2.3 CreatePlanFromPromptDto — 新增字段

```typescript
// backend/src/modules/orchestration/dto/index.ts

@IsOptional()
@IsBoolean()
autoGenerate?: boolean; // 默认 false; "创建并生成" 时为 true
```

### 2.4 向后兼容说明

- 新字段均有默认值，不影响现有数据读写
- 旧 plan 无 `generationMode` 字段时，按 `'batch'` 处理
- `generationConfig` 和 `generationState` 为可选字段，旧 plan 不含这些字段不会报错

---

## 3. 核心服务设计

### 3.1 IncrementalPlanningService — 增量编排引擎

**文件**: `backend/src/modules/orchestration/services/incremental-planning.service.ts`

#### 3.1.1 类定义

```typescript
@Injectable()
export class IncrementalPlanningService {
  private readonly logger = new Logger(IncrementalPlanningService.name);
  private readonly activePlannings = new Set<string>(); // 防重入

  constructor(
    @InjectModel(OrchestrationPlan.name)
    private readonly planModel: Model<OrchestrationPlanDocument>,
    @InjectModel(OrchestrationTask.name)
    private readonly taskModel: Model<OrchestrationTaskDocument>,
    private readonly plannerService: PlannerService,
    private readonly executionEngine: OrchestrationExecutionEngineService,
    private readonly planStats: PlanStatsService,
    private readonly eventStream: PlanEventStreamService,
    private readonly contextService: OrchestrationContextService,
  ) {}
}
```

#### 3.1.2 核心方法: `executeIncrementalPlanning(planId)`

```typescript
async executeIncrementalPlanning(planId: string): Promise<void> {
  // 1. 防重入检查
  if (this.activePlannings.has(planId)) {
    throw new ConflictException('Incremental planning already running');
  }
  this.activePlannings.add(planId);

  try {
    const plan = await this.planModel.findById(planId).exec();
    if (!plan) throw new NotFoundException('Plan not found');

    // 2. 初始化状态
    await this.updatePlanStatus(planId, 'drafting');
    const config = plan.generationConfig || { maxRetries: 3, maxCostTokens: 500000, maxTasks: 15 };

    let stepIndex = plan.generationState?.currentStep || 0;
    let totalRetries = plan.generationState?.totalRetries || 0;
    let totalCost = plan.generationState?.totalCost || 0;
    let isGoalReached = false;
    let consecutiveFailures = 0;

    // 3. 增量编排主循环
    while (!isGoalReached) {
      // 约束检查
      if (stepIndex >= config.maxTasks) {
        await this.failPlanning(planId, `Exceeded max tasks limit (${config.maxTasks})`);
        break;
      }
      if (totalCost > config.maxCostTokens) {
        await this.failPlanning(planId, `Exceeded cost limit (${config.maxCostTokens} tokens)`);
        break;
      }

      // 3a. 构建 planner 上下文
      const context = await this.buildPlannerContext(planId, plan.sourcePrompt);

      // 3b. planner 生成下一个任务
      const nextTaskResult = await this.plannerService.generateNextTask(planId, context);
      totalCost += nextTaskResult.costTokens || 0;

      // 3c. 检查是否已达到目标
      if (nextTaskResult.isGoalReached) {
        isGoalReached = true;
        await this.completePlanning(planId);
        break;
      }

      // 3d. 创建并执行任务
      const task = await this.createTaskFromPlannerOutput(planId, stepIndex, nextTaskResult);
      this.eventStream.emitPlanStreamEvent(planId, {
        type: 'task.created', data: { taskId: task._id.toString(), title: task.title },
      });

      const executionResult = await this.executeAndValidate(task);

      // 3e. 处理执行结果
      if (executionResult.success) {
        consecutiveFailures = 0;

        // 尝试与上一步合并
        await this.tryMergeWithPreviousTask(planId, task);

        stepIndex++;
        await this.updateGenerationState(planId, {
          currentStep: stepIndex,
          totalGenerated: stepIndex,
          totalRetries,
          totalCost,
          isComplete: false,
        });
      } else {
        consecutiveFailures++;
        totalRetries++;

        if (consecutiveFailures >= config.maxRetries) {
          await this.failPlanning(planId,
            `Task "${task.title}" failed after ${config.maxRetries} retries: ${executionResult.error}`
          );
          break;
        }

        // 标记当前 task 为 failed，planner 下一轮会看到失败信息并调整
        await this.taskModel.updateOne(
          { _id: task._id },
          { $set: { status: 'failed', 'result.error': executionResult.error } },
        ).exec();
      }
    }
  } finally {
    this.activePlannings.delete(planId);
  }
}
```

#### 3.1.3 上下文构建: `buildPlannerContext(planId, sourcePrompt)`

```typescript
private async buildPlannerContext(
  planId: string,
  sourcePrompt: string,
): Promise<IncrementalPlannerContext> {
  // 查询该 plan 下所有已有任务及其执行结果
  const existingTasks = await this.taskModel
    .find({ planId, status: { $ne: 'cancelled' } })
    .sort({ order: 1 })
    .exec();

  const completedSummaries = existingTasks
    .filter(t => t.status === 'completed')
    .map(t => ({
      title: t.title,
      agentId: t.assignment?.executorId,
      outputSummary: (t.result?.output || '').slice(0, 500),
    }));

  const failedTasks = existingTasks
    .filter(t => t.status === 'failed')
    .map(t => ({
      title: t.title,
      error: t.result?.error || 'Unknown error',
    }));

  return {
    planGoal: sourcePrompt,
    completedTasks: completedSummaries,
    failedTasks,
    totalSteps: existingTasks.length,
  };
}
```

#### 3.1.4 任务合并: `tryMergeWithPreviousTask(planId, currentTask)`

```typescript
private async tryMergeWithPreviousTask(
  planId: string,
  currentTask: OrchestrationTaskDocument,
): Promise<boolean> {
  // 找到上一步已完成的任务
  const previousTask = await this.taskModel
    .findOne({
      planId,
      order: currentTask.order - 1,
      status: 'completed',
    })
    .exec();

  if (!previousTask) return false;

  // 条件1: 同一个 agent
  const sameAgent =
    previousTask.assignment?.executorType === 'agent' &&
    currentTask.assignment?.executorType === 'agent' &&
    previousTask.assignment?.executorId === currentTask.assignment?.executorId;

  if (!sameAgent) return false;

  // 条件2: 语义相似度（关键词重叠率 > 40%）
  const prevKeywords = this.extractKeywords(previousTask.title + ' ' + previousTask.description);
  const currKeywords = this.extractKeywords(currentTask.title + ' ' + currentTask.description);
  const overlap = prevKeywords.filter(k => currKeywords.includes(k)).length;
  const maxLen = Math.max(prevKeywords.length, currKeywords.length, 1);
  const similarity = overlap / maxLen;

  if (similarity < 0.4) return false;

  // 执行合并: 将当前任务信息合入前一个任务
  const mergedDescription = [
    previousTask.description,
    '---',
    `[合并自步骤 ${currentTask.order + 1}] ${currentTask.title}`,
    currentTask.description,
  ].join('\n');

  const mergedOutput = [
    previousTask.result?.output || '',
    '---',
    `[步骤 ${currentTask.order + 1} 输出]`,
    currentTask.result?.output || '',
  ].join('\n');

  await this.taskModel.updateOne(
    { _id: previousTask._id },
    {
      $set: {
        description: mergedDescription,
        'result.output': mergedOutput,
      },
      $push: {
        mergedFromTaskIds: currentTask._id.toString(),
      },
    },
  ).exec();

  // 标记当前 task 为 cancelled（已被合并）
  await this.taskModel.updateOne(
    { _id: currentTask._id },
    { $set: { status: 'cancelled' } },
  ).exec();

  this.logger.log(
    `Merged task "${currentTask.title}" into "${previousTask.title}" (similarity=${similarity.toFixed(2)})`,
  );

  return true;
}

private extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
    .filter(w => w.length >= 2)
    .slice(0, 30);
}
```

---

### 3.2 PlannerService — 重构为增量指令引擎

**文件**: `backend/src/modules/orchestration/planner.service.ts`

#### 3.2.1 新增方法: `generateNextTask()`

```typescript
interface GenerateNextTaskResult {
  task?: {
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    agentId: string;
    taskType?: 'external_action' | 'research' | 'review' | 'development' | 'general'; // planner 可选指定
  };
  isGoalReached: boolean;
  reasoning: string;
  costTokens?: number;
}

async generateNextTask(
  planId: string,
  context: IncrementalPlannerContext,
): Promise<GenerateNextTaskResult> {
  const plan = await this.planModel.findById(planId).exec();
  if (!plan) throw new NotFoundException('Plan not found');

  const plannerAgentId = plan.strategy?.plannerAgentId;
  if (!plannerAgentId) {
    throw new BadRequestException('Plan has no planner agent configured');
  }

  // 构建增量 planner prompt
  const prompt = await this.buildIncrementalPlannerPrompt(context);

  const task: AgentExecutionTask = {
    title: 'Incremental planning: generate next task',
    description: prompt,
    type: 'planning',
    priority: 'high',
    status: 'pending',
    assignedAgents: [plannerAgentId],
    teamId: 'orchestration',
    messages: [],
  };

  const response = await this.agentClientService.executeTask(plannerAgentId, task, {
    collaborationContext: {
      mode: 'planning',
      format: 'json',
      roleInPlan: 'planner',
    },
  });

  const parsed = this.tryParseJson(response);
  if (!parsed) {
    return { isGoalReached: false, reasoning: 'Failed to parse planner response' };
  }

  return {
    task: parsed.task ? {
      title: String(parsed.task.title || '').slice(0, 120),
      description: String(parsed.task.description || '').slice(0, 2000),
      priority: this.normalizePriority(parsed.task.priority),
      agentId: String(parsed.task.agentId || ''),
    } : undefined,
    isGoalReached: Boolean(parsed.isGoalReached),
    reasoning: String(parsed.reasoning || ''),
    costTokens: parsed.costTokens,
  };
}
```

#### 3.2.2 增量 Planner Prompt 模板

```typescript
private async buildIncrementalPlannerPrompt(
  context: IncrementalPlannerContext,
): Promise<string> {
  // Agent manifest 由 PlanningContextService 提供
  const agentManifest = context.agentManifest || '';

  const sections: string[] = [];

  sections.push('你是一个计划编排器 (Planner)，负责逐步生成可执行任务来达成用户目标。');
  sections.push('');
  sections.push(`## 目标`);
  sections.push(context.planGoal);
  sections.push('');

  if (agentManifest) {
    sections.push('## 可用执行者 (Agent Manifest)');
    sections.push(agentManifest);
    sections.push('');
  }

  if (context.completedTasks.length > 0) {
    sections.push('## 已完成的任务');
    for (const t of context.completedTasks) {
      sections.push(`- [${t.title}] (agent=${t.agentId}): ${t.outputSummary}`);
    }
    sections.push('');
  }

  if (context.failedTasks.length > 0) {
    sections.push('## 最近失败的任务（请调整策略避免相同错误）');
    for (const t of context.failedTasks) {
      sections.push(`- [${t.title}]: ${t.error}`);
    }
    sections.push('');
  }

  sections.push('## 输出规则');
  sections.push('1) 仅输出 JSON，不要附加解释。');
  sections.push('2) JSON 结构:');
  sections.push('   {"task": {"title": "...", "description": "...", "priority": "low|medium|high|urgent", "agentId": "...", "taskType": "general|research|development|review|external_action"}, "isGoalReached": false, "reasoning": "..."}');
  sections.push('3) 如果所有目标已达成，设置 isGoalReached: true，task 可以为 null。');
  sections.push('4) 每个任务必须足够简单、明确、可快速验证结果。复杂目标请拆分为多个小步骤。');
  sections.push('5) 你必须从 Agent Manifest 中选择一个 agentId 来执行任务。');
  sections.push('6) task 的 description 必须包含具体的执行指令，禁止空泛描述。');
  sections.push('7) 如果上一步失败了，分析失败原因，调整任务描述或换一个更合适的 agent。');
  sections.push('8) 如果本步骤与上一步由同一 agent 执行且功能相似，系统会自动合并，无需担心粒度过细。');

  return sections.join('\n');
}
```

#### 3.2.3 废弃方法清单

以下方法在重构中废弃（保留代码但标记 `@deprecated`，确保旧 `generationMode='batch'` plan 仍可工作）：

| 方法 | 废弃原因 |
|---|---|
| `planFromPrompt()` | 批量拆解入口，增量模式不再使用 |
| `planByAgent()` | 批量 Agent 拆解，被 `generateNextTask()` 替代 |
| `planByHeuristic()` | 启发式降级，增量模式不需要 |
| `validateAgainstSkillConstraints()` | 代码约束校验，改为 prompt 注入 |

---

### 3.3 PlanManagementService — 创建流程适配

**文件**: `backend/src/modules/orchestration/services/plan-management.service.ts`

#### 3.3.1 `createPlanFromPrompt()` 改造

```typescript
async createPlanFromPrompt(createdBy: string, dto: CreatePlanFromPromptDto) {
  // ... 现有的 plan 创建逻辑保持不变 ...

  // 变更点: 设置 generationMode
  const plan = await new this.planModel({
    title: dto.title || this.derivePlanTitle(dto.prompt),
    sourcePrompt: dto.prompt,
    status: 'draft',  // 变更: 默认 draft 而非 drafting
    strategy: { plannerAgentId: dto.plannerAgentId, mode: dto.mode || 'sequential' },
    generationMode: 'incremental',
    generationConfig: {
      maxRetries: 3,
      maxCostTokens: 500000,
      maxTasks: 15,
    },
    generationState: {
      currentStep: 0,
      totalGenerated: 0,
      totalRetries: 0,
      totalCost: 0,
      isComplete: false,
    },
    // ... 其他字段 ...
  }).save();

  // 变更点: 仅当 autoGenerate=true 时启动编排
  if (dto.autoGenerate) {
    setTimeout(() => {
      this.incrementalPlanningService
        .executeIncrementalPlanning(plan._id.toString())
        .catch(err => this.logger.error(`Incremental planning failed: ${err.message}`));
    }, 0);
  }

  return plan;
}
```

#### 3.3.2 新增 `startGeneration(planId)`

```typescript
async startGeneration(planId: string): Promise<{ accepted: boolean }> {
  const plan = await this.planModel.findById(planId).exec();
  if (!plan) throw new NotFoundException('Plan not found');

  if (plan.generationMode !== 'incremental') {
    throw new BadRequestException('Only incremental plans support startGeneration');
  }

  if (plan.generationState?.isComplete) {
    throw new BadRequestException('Planning already completed');
  }

  setTimeout(() => {
    this.incrementalPlanningService
      .executeIncrementalPlanning(planId)
      .catch(err => this.logger.error(`Incremental planning failed: ${err.message}`));
  }, 0);

  return { accepted: true };
}
```

---

## 4. Prompt 设计 — 替代代码逻辑的能力映射

### 4.1 代码逻辑 → Prompt 的迁移对照表

| 原代码逻辑 | 所在文件 | Prompt 替代方式 |
|---|---|---|
| `EMAIL_SCENE_RULE` (邮件依赖优化) | `scene-optimization.service.ts` | Planner prompt: "若存在发送邮件/外部动作任务，优先依赖邮件草稿/内容生成任务" |
| `CODE_DEV_SCENE_RULE` (代码开发依赖) | `scene-optimization.service.ts` | Planner prompt: task description 要求包含文件路径、接口名等具体信息 |
| `validateTaskQuality()` (质量校验) | `scene-optimization.service.ts` | Planner prompt: "description 必须包含具体执行指令，禁止空泛描述" |
| `selectExecutor()` (多维评分路由) | `executor-selection.service.ts` | Planner prompt 提供 Agent Manifest + "你必须从中选择一个 agentId" |
| `validateAgainstSkillConstraints()` | `planner.service.ts` | Planner prompt 中注入 planningConstraints 文本（由 `planning-context.service.ts` 构建） |
| `isEmailTask()/isResearchTask()` 分类 | `task-classification.service.ts` | 执行引擎保留用于 runtime type 判断，但不影响编排决策 |

### 4.2 Agent Manifest 格式

由 `PlanningContextService.buildAgentManifest()` 构建（已有，保留）：

```
可用执行者清单（分配任务时请参考其能力范围，agentId 必须使用括号内的 id 值）:
- 研究助手（id=abc123def456789012345678, researcher, L1层）
  能力: web搜索, 数据分析, 报告生成
  工具: websearch, webfetch, file_write
  简介: 擅长信息检索和研究报告撰写

- 开发工程师（id=def456abc789012345678901, developer, L1层）
  能力: 代码开发, 测试, 重构
  工具: code_edit, terminal, git
  简介: 全栈开发能力，擅长 TypeScript/React
```

> **关键**: manifest 条目格式为 `- Name（id=ObjectId, roleName, tier层）`，`id` 是 MongoDB ObjectId，planner 必须从中选择有效 agentId。

---

## 5. 约束守护机制

### 5.1 约束参数默认值

| 参数 | 默认值 | 说明 |
|---|---|---|
| `maxRetries` | 3 | 单任务连续失败最大重试次数（重试时 planner 会看到失败原因） |
| `maxCostTokens` | 500000 | 整个增量编排过程的 token 成本上限 |
| `maxTasks` | 15 | 最大生成任务数（含已合并/取消的） |

### 5.2 失败处理策略

```
任务执行失败
    │
    ├─ consecutiveFailures < maxRetries
    │    → 标记 task failed
    │    → planner 下一轮看到失败信息
    │    → planner 调整描述或换 agent 重新生成
    │
    └─ consecutiveFailures >= maxRetries
         → plan status = 'draft'
         → generationState.lastError = 错误描述
         → 发射 plan.failed SSE 事件
         → 编排终止
```

### 5.3 成本追踪

- 每次 planner agent 调用返回 `costTokens`
- 每次 executor agent 执行的 token 消耗（需从 agent runtime 获取或估算）
- 累计到 `generationState.totalCost`
- 超过 `maxCostTokens` 时终止编排

---

## 6. 任务合并算法

### 6.1 合并条件（AND 关系）

1. **同一 Agent**: `previousTask.assignment.executorId === currentTask.assignment.executorId`
2. **语义相似**: 标题+描述的关键词重叠率 > 40%

### 6.2 合并操作

1. 将当前 task 的 description 追加到前一个 task 的 description（用 `---` 分隔）
2. 将当前 task 的 result.output 追加到前一个 task 的 result.output
3. 前一个 task 的 `mergedFromTaskIds` 数组追加当前 task ID
4. 当前 task 标记为 `cancelled`

### 6.3 合并后 plan 视图

前端展示时，`cancelled` 状态的 task 可折叠或隐藏，显示合并后的 task 内容。

### 6.4 后续优化方向

- 引入 embedding 相似度替代关键词重叠率
- 支持跨多步合并（连续 N 个同 agent 相似任务合并为一个）
- 合并前询问 planner agent 是否建议合并

---

## 7. SSE 事件设计

增量编排过程中新增以下 SSE 事件类型：

| 事件类型 | 数据 | 触发时机 |
|---|---|---|
| `planning.step.started` | `{ step, planId }` | 每一步开始前 |
| `planning.task.generated` | `{ taskId, title, agentId, step }` | planner 生成任务后 |
| `planning.task.executing` | `{ taskId, step }` | 任务开始执行 |
| `planning.task.completed` | `{ taskId, step, merged }` | 任务执行成功 |
| `planning.task.failed` | `{ taskId, step, error, retriesLeft }` | 任务执行失败 |
| `planning.task.merged` | `{ sourceTaskId, targetTaskId }` | 任务被合并 |
| `planning.completed` | `{ planId, totalTasks, totalSteps }` | 编排完成 |
| `planning.failed` | `{ planId, error }` | 编排失败终止 |

---

## 8. API 变更

### 8.1 新增 Endpoint

```
POST /orchestration/plans/:id/generate-next
```

- 用途：手动触发增量编排（调试/恢复用）
- 请求体：无
- 响应：`{ accepted: true }`
- 权限：与现有 plan 操作一致

### 8.2 现有 Endpoint 变更

```
POST /orchestration/plans/from-prompt
```

- 请求体新增 `autoGenerate?: boolean`
- 行为变更：
  - `autoGenerate=false`（默认）：仅创建 plan，status='draft'
  - `autoGenerate=true`：创建 plan 后自动启动增量编排

---

## 9. 废弃服务处理

### 9.1 `SceneOptimizationService` — 完全废弃

- 移除 `EMAIL_SCENE_RULE` 和 `CODE_DEV_SCENE_RULE`
- 保留 `MAX_TASKS`、`MAX_TITLE_LENGTH`、`MAX_DESCRIPTION_LENGTH` 常量导出
- `optimizeTasks()` 改为直接返回输入（pass-through），不做任何变换
- `validateTaskQuality()` 改为空实现，仅返回 `{ passed: true, warnings: [] }`

### 9.2 `ExecutorSelectionService` — 降级为 fallback

- 保留完整代码
- 仅在 planner 未指定 `agentId` 或指定的 `agentId` 无效时作为 fallback 调用
- 不再作为创建流程的默认执行者分配路由

### 9.3 `PlanningContextService` — 精简

- 保留 `buildAgentManifest()`（增量 planner 需要）
- 保留 `buildRequirementDetail()`（增量 planner 需要）
- 移除 `buildPlanningConstraints()` 中的 skill constraint 提取逻辑（约束通过 prompt 文本注入）
- 简化 `buildPlanningContext()` 返回结构

---

## 10. 执行顺序与开发检查清单

| 顺序 | 任务 | 预估工作量 | 依赖 |
|---|---|---|---|
| 1 | Schema & DTO 扩展 | 小 | 无 |
| 2 | `IncrementalPlanningService` 新建 | 大 | Step 1 |
| 3 | `PlannerService.generateNextTask()` 新增 | 中 | Step 1 |
| 4 | `PlanManagementService` 改造 | 中 | Step 2, 3 |
| 5 | 废弃服务清理 | 小 | Step 2, 3 |
| 6 | Controller & Module 更新 | 小 | Step 4 |
| 7 | SSE 事件补充 | 小 | Step 2 |
| 8 | 编译验证（lint + build） | 小 | Step 1-7 |

---

## 11. runtimeTaskType 解析链路（2026-03-24 新增）

### 11.1 问题背景

增量编排创建的 task 如果不设置 `runtimeTaskType`，执行引擎会在运行时通过 `TaskClassificationService` 的关键词匹配自动分类。该分类器的关键词覆盖极广（`search`/`analyze`/`collect`/`扫描`/`解析` 等），导致大量 general 任务被误判为 `research`，触发 research 输出验证失败。

### 11.2 三层解析优先级

```
runtimeTaskType = planner 指定的 taskType
                || plan.defaultTaskType
                || 'general'
```

| 层级 | 来源 | 设置时机 | 说明 |
|---|---|---|---|
| 1（最高） | planner JSON 输出的 `task.taskType` | `createTaskFromPlannerOutput()` | planner 根据任务性质自行判断 |
| 2 | `plan.defaultTaskType` | 创建 Plan 时通过 DTO 指定 | 适用于整个 Plan 下所有 task 的默认类型 |
| 3（兜底） | `'general'` | 硬编码 | 避免 keyword 误判 |

### 11.3 执行引擎的 runtimeTaskType 使用链路

```
orchestration-execution-engine.service.ts:executeTaskNode()
  │
  ├─ runtimeTaskTypeOverride (调用方显式传入)     ← 最高优先
  ├─ persistedRuntimeTaskType (task document 上)   ← 增量编排已持久化
  └─ keyword-based classification (fallback)       ← 仅在上面两个都无值时触发
```

增量编排创建的 task 在 `persistedRuntimeTaskType` 层已有值，keyword classification 不会被触发。

### 11.4 CreatePlanFromPromptDto 新增字段

```typescript
@IsOptional()
@IsEnum(['external_action', 'research', 'review', 'development', 'general'])
defaultTaskType?: 'external_action' | 'research' | 'review' | 'development' | 'general';
```

API 请求示例:
```json
POST /api/orchestration/plans/from-prompt
{
  "title": "...",
  "prompt": "...",
  "plannerAgentId": "698a0bd7db9f7e6b8cca4171",
  "defaultTaskType": "general",
  "autoGenerate": true
}
```

### 11.5 task runLogs 诊断字段

每个增量编排创建的 task 在 `runLogs[0].metadata` 中包含以下诊断字段：

| 字段 | 说明 |
|---|---|
| `plannerAssignedAgentId` | planner 指定的原始 agentId |
| `fallbackUsed` | 是否 fallback 到 ExecutorSelectionService |
| `resolvedTaskType` | 最终持久化的 runtimeTaskType |
| `plannerTaskType` | planner JSON 中的 taskType 值 |
| `planDefaultTaskType` | plan.defaultTaskType 的值 |
