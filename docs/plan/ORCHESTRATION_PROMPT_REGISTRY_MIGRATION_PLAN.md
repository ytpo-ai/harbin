# Orchestration Prompt Registry 迁移计划

## 背景

当前 orchestration 模块中用于辅助计划编排各阶段（initialize / generating / pre_execute / post_execute）的 prompt 全部硬编码在代码中，无法在不修改代码、不重新部署的情况下优化 prompt。同时存在以下架构问题：

1. **跨应用直接依赖**：`planner.service.ts`（`backend/src/`，legacy app port 3001）直接 import 了 `apps/agents/src/` 下的 `PromptResolverService` 和 `PromptRegistryModule`，违反了应用模块边界
2. **prompt 构建职责散落**：orchestration 约 400+ 行 prompt 文本分布在 `planner.service.ts`（4 个 private prompt 构建函数）、`orchestration-context.service.ts`（3 个 prompt 构建函数）、`task-output-validation.service.ts`（1 个 output contract），只有 1 个走了 registry
3. **PromptResolverService 降级链路不合理**：`cacheOnly` 分支导致 Redis miss 时直接降到 code_default，跳过 DB，发布内容可能因 Redis 丢失而失效
4. **buildPhaseInitializePrompt Phase 2 过度耦合**：Phase 2 硬编码了 rd-workflow 特有的 requirement 工具调用序列，无法适用于 general/research 域

## 目标

1. **Prompt 构建职责统一收敛到 `OrchestrationContextService`**：所有编排阶段的 prompt 构建由一个 service 统一管理，`PlannerService` 只负责"调用 agent + 解析结果"
2. orchestration 阶段 prompt 全部通过 prompt-registry 管理，支持通过管理界面/API 热更新
3. 消除跨应用直接 import，orchestration 通过 HTTP API 调用 agents 的 prompt-registry 服务
4. 简化 PromptResolverService 降级链路，去掉 `cacheOnly`，统一为 `local cache → Redis → DB → code_default`
5. buildPhaseInitializePrompt Phase 2 去 rd-workflow 耦合，改为框架声明 + skill 扩展驱动

## 关联文档

- 问题追踪：`docs/issue/PLAN_OPTIMAZE.md`
- 现有 prompt-registry 架构：`docs/guide/PROMPT&SKILL_BOUNDARY.MD`
- Planner initialize 设计：`docs/technical/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE_DESIGN.md`

---

## 架构变更：Prompt 构建职责收敛

### 当前现状（prompt 构建散落在 3 个 service）

```
planner.service.ts (private 方法，仅自身调用)
  ├── buildIncrementalPlannerPrompt()  → generating 阶段 prompt
  ├── buildPhaseInitializePrompt()     → initialize 阶段 prompt
  ├── buildDefaultOutline()            → 默认大纲
  └── resolvePlannerTaskPrompt()       → 批量任务拆解 prompt（legacy）

orchestration-context.service.ts
  ├── buildPreTaskContext()             → pre_execute 阶段 prompt
  ├── buildPostTaskContext()            → post_execute 阶段 prompt
  └── buildTaskDescription()           → 任务描述 + 输出合约

task-output-validation.service.ts
  └── buildResearchOutputContract()    → 研究类输出合约
```

### 目标架构（统一收敛到 OrchestrationContextService）

```
orchestration-context.service.ts  ← 唯一的 prompt 构建入口
  ├── buildPhaseInitializePrompt()     → initialize 阶段 prompt  [从 planner 迁入]
  ├── buildGeneratingPrompt()          → generating 阶段 prompt  [从 planner 迁入]
  ├── buildDefaultOutline()            → 默认大纲              [从 planner 迁入]
  ├── buildPreTaskContext()             → pre_execute 阶段 prompt [已有]
  ├── buildPostTaskContext()            → post_execute 阶段 prompt [已有]
  ├── buildTaskDescription()            → 任务描述 + 输出合约    [已有]
  ├── buildResearchOutputContract()     → 研究类输出合约         [从 validation 迁入]
  ├── resolvePlannerTaskPrompt()        → 批量任务拆解 prompt    [从 planner 迁入]
  └── resolvePromptFromRegistry()       → 统一的 registry 解析   [新增 private]

planner.service.ts  ← 只负责：调用 agent + 解析结果
  ├── generateNextTask()    → 调 contextService.buildGeneratingPrompt() 获取 prompt → 发给 agent
  ├── initializePlan()      → 调 contextService.buildPhaseInitializePrompt() → 发给 agent
  ├── executePreTask()      → 不变（prompt 由 dispatcher 构建后传入）
  ├── executePostTask()     → 不变（prompt 由 dispatcher 构建后传入）
  └── planFromPrompt()      → 调 contextService.resolvePlannerTaskPrompt() → 发给 agent

task-output-validation.service.ts  ← 只保留纯校验逻辑
  └── validateGeneralOutput()  → 输出有效性校验（不含 prompt 构建）
```

### 迁移后的调用链路变化

**generateNextTask（generating 阶段）：**
```
Before: PlannerService.generateNextTask()
          → this.buildIncrementalPlannerPrompt()  // 自身 private
          → this.agentClientService.executeTask()

After:  PlannerService.generateNextTask()
          → this.contextService.buildGeneratingPrompt()  // 委托 contextService
          → this.agentClientService.executeTask()
```

**initializePlan（initialize 阶段）：**
```
Before: PlannerService.initializePlan()
          → this.buildPhaseInitializePrompt()  // 自身 private
          → this.agentClientService.executeTask()

After:  PlannerService.initializePlan()
          → this.contextService.buildPhaseInitializePrompt()  // 委托 contextService
          → this.agentClientService.executeTask()
```

**planFromPrompt（legacy 批量拆解）：**
```
Before: PlannerService.planByAgent()
          → this.resolvePlannerTaskPrompt()  // 自身 private，内部调 promptResolver.resolve()
          → this.agentClientService.executeTask()

After:  PlannerService.planByAgent()
          → this.contextService.resolvePlannerTaskPrompt()  // 委托 contextService
          → this.agentClientService.executeTask()
```

### 依赖注入变化

**OrchestrationContextService（扩展依赖）：**
```diff
  constructor(
    @InjectModel(OrchestrationTask.name) ...,
    @InjectModel(OrchestrationRunTask.name) ...,
    private readonly taskOutputValidationService: TaskOutputValidationService,
+   private readonly agentClientService: AgentClientService,
  ) {}
```

**PlannerService（精简依赖）：**
```diff
  constructor(
    @InjectModel(Agent.name) ...,
    @InjectModel(OrchestrationPlan.name) ...,
    private readonly agentClientService: AgentClientService,
-   private readonly promptResolver: PromptResolverService,
+   private readonly contextService: OrchestrationContextService,
  ) {}
```

---

## Step 1：简化 PromptResolverService — 去掉 cacheOnly，统一降级链路

### 目标

去掉 `cacheOnly` 参数和分支逻辑，统一为 **local cache → Redis → DB → code_default** 一条链路。

### 当前问题

`resolve()` 有两条分支：
- `cacheOnly=true`：local → Redis → code_default（跳过 DB，Redis miss 则降到 code_default）
- `cacheOnly=false`：DB → 写入 Redis → Redis 兜底 → code_default

这导致运行时热路径（`cacheOnly=true`）在 Redis 缺失时，即使 DB 中有已发布的 prompt 也无法获取。

### 改动

**文件**：`backend/apps/agents/src/modules/prompt-registry/prompt-resolver.service.ts`

1. 从 `PromptResolveInput` 接口中移除 `cacheOnly?: boolean` 字段
2. `resolve()` 方法统一为一条链路：
   ```
   sessionOverride 存在 → 直接返回
   ↓
   local cache 命中 → 直接返回
   ↓
   Redis 命中 → 写入 local cache → 返回
   ↓
   DB 查询 published → 写入 Redis + local cache → 返回
   ↓
   code_default
   ```
3. 保留 local cache TTL（5min）和 Redis 超时/bypass 机制不变
4. DB 查询失败时（异常），降级到 code_default，不阻断流程

### 受影响调用方（agents 内部，去掉 cacheOnly 参数即可）

| 文件 | 行号 | 当前值 |
|---|---|---|
| `context-prompt.service.ts` | 19 | `cacheOnly: true` |
| `agent-executor.service.ts` | 1924 | `cacheOnly: true` |
| `agent-executor.service.ts` | 2271 | `cacheOnly: true` |
| `identity-context.builder.ts` | 139 | `cacheOnly: true` |

### 测试影响

| 文件 | 调整 |
|---|---|
| `backend/test/prompt-resolver.service.spec.ts` | 移除 `cacheOnly` 相关测试，新增统一链路测试 |
| `identity-context.builder.spec.ts` | 移除 `cacheOnly: true` 断言 |
| `agent-executor.service.spec.ts` | 移除 `cacheOnly: true` 断言 |

---

## Step 2：在 AgentClientService 新增 resolvePrompt() HTTP 方法

### 目标

为 orchestration 模块提供通过 HTTP 调用 agents prompt-registry 的能力。

### 改动

**文件**：`backend/src/modules/agents-client/agent-client.service.ts`

新增方法：

```typescript
async resolvePrompt(input: {
  scene: string;
  role: string;
  defaultContent: string;
}): Promise<{ content: string; source: string; version?: number }> {
  try {
    const response = await axios.get(
      `${this.baseUrl}/api/prompt-registry/templates/effective`,
      {
        params: { scene: input.scene, role: input.role },
        headers: this.buildSignedHeaders(),
        timeout: this.timeout,
      },
    );
    const content = String(response.data?.content || '').trim();
    if (content) {
      return {
        content,
        source: String(response.data?.source || 'api'),
        version: response.data?.version,
      };
    }
    // agents 侧无发布版 → 使用调用方提供的 code_default
    return { content: input.defaultContent, source: 'code_default' };
  } catch (error) {
    // HTTP 调用失败 → 降级到 code_default，不阻断编排流程
    this.logger.warn(
      `[prompt_resolve_http_failed] scene=${input.scene} role=${input.role} ` +
      `error=${error instanceof Error ? error.message : 'unknown'}`,
    );
    return { content: input.defaultContent, source: 'code_default' };
  }
}
```

### 设计要点

- 调用 agents 已有端点 `GET /api/prompt-registry/templates/effective?scene=X&role=Y`
- `defaultContent` 由调用方（orchestration）自持，不传给 API
- HTTP 异常时降级到 code_default，不阻断编排流程
- 复用已有 `buildSignedHeaders()` 做内部认证
- 复用已有 `this.timeout`（20s）

---

## Step 3：新建 orchestration-prompt-catalog.ts

### 目标

将 orchestration 模块中 7 个硬编码 prompt 提取为 catalog entry，每个 entry 定义 `scene`、`role`、`buildDefaultContent`。

### 改动

**新文件**：`backend/src/modules/orchestration/orchestration-prompt-catalog.ts`

提取以下 7 个 prompt：

| 符号 | scene | role | 来源函数 | 来源文件 | 说明 |
|---|---|---|---|---|---|
| `plannerTaskDecomposition` | `orchestration` | `planner-task-decomposition` | `DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT` | `planner.service.ts:119` | 批量任务拆解模板 |
| `plannerGenerating` | `orchestration` | `planner-generating` | `buildIncrementalPlannerPrompt()` | `planner.service.ts:600` | generating 阶段框架 |
| `plannerInitialize` | `orchestration` | `planner-initialize` | `buildPhaseInitializePrompt()` | `planner.service.ts:855` | initialize 阶段框架 |
| `plannerDefaultOutline` | `orchestration` | `planner-default-outline` | `buildDefaultOutline()` | `planner.service.ts:1106` | 默认大纲模板 |
| `preExecuteContext` | `orchestration` | `pre-execute-context` | `buildPreTaskContext()` | `orchestration-context.service.ts:237` | pre_execute 阶段框架 |
| `postExecuteContext` | `orchestration` | `post-execute-context` | `buildPostTaskContext()` | `orchestration-context.service.ts:329` | post_execute 阶段框架 |
| `researchOutputContract` | `orchestration` | `research-output-contract` | `buildResearchOutputContract()` | `task-output-validation.service.ts:14` | 研究类输出合约 |

### Catalog 结构

```typescript
export interface OrchestrationPromptEntry {
  symbol: string;        // 常量标识
  scene: string;         // prompt-registry scene
  role: string;          // prompt-registry role
  buildDefaultContent: () => string;  // 代码默认值（降级用）
}

export const ORCHESTRATION_PROMPTS: Record<string, OrchestrationPromptEntry> = {
  plannerTaskDecomposition: { ... },
  plannerGenerating: { ... },
  plannerInitialize: { ... },
  plannerDefaultOutline: { ... },
  preExecuteContext: { ... },
  postExecuteContext: { ... },
  researchOutputContract: { ... },
};
```

### Prompt 书写规范

所有 `buildDefaultContent()` 统一使用 **数组 `.join('\n')` 格式**书写，每行一个元素，结构清晰、易读、易改：

```typescript
plannerGenerating: {
  symbol: 'PLANNER_GENERATING_PROMPT',
  scene: 'orchestration',
  role: 'planner-generating',
  buildDefaultContent: () => [
    '【当前阶段声明 — 最高优先级】',
    '你当前处于 generating 阶段，只负责提交下一步任务。',
    '- 仅允许调用 `builtin.sys-mg.internal.agent-master.list-agents` 与 `builtin.sys-mg.mcp.orchestration.submit-task`。',
    '- 禁止调用 requirement.* 工具，禁止输出确认性文本。',
    '- 每次只提交一个任务。',
    '- submit-task 的 planId 必须是: {{planId}}',
    '',
    '## 当前步骤指导（Step {{nextStep}}）',
    '{{generatingPrompt}}',
    '',
    '## 计划上下文',
    '- 当前步骤: {{nextStep}} / {{totalSteps}}',
    '- requirementId: {{requirementId}}',
    '- Plan 目标: {{planGoal}}',
    '{{completedTasksSummary}}',
    // ... 更多行
  ].join('\n'),
},
```

### 设计要点

- `buildDefaultContent()` 返回的是**纯模板文本**，其中动态部分使用 `{{variable}}` mustache 占位符
- 条件分支（如 initialize 中有/无 existingRequirementId）仍在代码中处理，registry 中存储的是含变量的完整模板
- 各 prompt 的当前硬编码内容作为 `buildDefaultContent()` 的返回值，确保无 DB 发布版时行为不变
- 从 DB 发布覆盖时，发布内容也应遵循同样的 `{{variable}}` 占位符约定，由 `renderTemplate()` 统一替换

---

## Step 4：扩展 PROMPT_SCENES / PROMPT_ROLES 常量

### 目标

在 agents 侧的 `prompt-resolver.constants.ts` 中注册 orchestration 新增的 role，供 admin API 和前端管理界面使用。

### 改动

**文件**：`backend/apps/agents/src/modules/prompt-registry/prompt-resolver.constants.ts`

```typescript
export const PROMPT_SCENES = {
  meeting: 'meeting',
  orchestration: 'orchestration',  // 已有
} as const;

export const PROMPT_ROLES = {
  meetingExecutionPolicy: 'meeting-execution-policy',
  plannerTaskDecomposition: 'planner-task-decomposition',  // 已有
  // ── 新增 ──
  plannerGenerating: 'planner-generating',
  plannerInitialize: 'planner-initialize',
  plannerDefaultOutline: 'planner-default-outline',
  preExecuteContext: 'pre-execute-context',
  postExecuteContext: 'post-execute-context',
  researchOutputContract: 'research-output-contract',
} as const;
```

### 注意

这些常量仅在 agents 侧使用（admin API、前端管理界面过滤等）。orchestration 侧通过 `orchestration-prompt-catalog.ts` 中的 `scene`/`role` 字符串字面量调用 HTTP API，**不需要 import 这个常量文件**，避免跨应用依赖。

---

## Step 5：改造 planner.service.ts — 移除跨模块 import，prompt 构建委托给 contextService

### 目标

1. 移除对 `PromptResolverService` 和 `PROMPT_SCENES`/`PROMPT_ROLES` 的跨应用 import
2. prompt 构建函数迁移到 `OrchestrationContextService`
3. `PlannerService` 改为调用 `contextService` 获取 prompt

### 改动

**文件**：`backend/src/modules/orchestration/planner.service.ts`

#### 5.1 移除跨模块 import，新增 contextService 依赖

```diff
- import { PromptResolverService } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.service';
- import { PROMPT_ROLES, PROMPT_SCENES } from '../../../apps/agents/src/modules/prompt-registry/prompt-resolver.constants';
+ import { OrchestrationContextService } from './services/orchestration-context.service';

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(OrchestrationPlan.name) private readonly planModel: Model<OrchestrationPlanDocument>,
    private readonly agentClientService: AgentClientService,
-   private readonly promptResolver: PromptResolverService,
+   private readonly contextService: OrchestrationContextService,
  ) {}
```

#### 5.2 generateNextTask 改造

```diff
  async generateNextTask(...) {
-   const prompt = this.buildIncrementalPlannerPrompt(context, { ... });
+   const prompt = await this.contextService.buildGeneratingPrompt(context, { ... });
    // ... 调用 agentClientService.executeTask() 不变
  }
```

#### 5.3 initializePlan 改造

```diff
  async initializePlan(...) {
-   const prompt = this.buildPhaseInitializePrompt({ ... });
+   const prompt = await this.contextService.buildPhaseInitializePrompt({ ... });
    // ... 调用 agentClientService.executeTask() 不变
  }
```

#### 5.4 planByAgent (legacy) 改造

```diff
  private async planByAgent(...) {
-   const plannerPrompt = await this.resolvePlannerTaskPrompt({ ... });
+   const plannerPrompt = await this.contextService.resolvePlannerTaskPrompt({ ... });
    // ... 调用 agentClientService.executeTask() 不变
  }
```

#### 5.5 删除迁移走的 private 方法

从 `planner.service.ts` 中删除：
- `buildIncrementalPlannerPrompt()` (line 600-683)
- `buildPhaseInitializePrompt()` (line 855-1013)
- `buildDefaultOutline()` (line 1106-1150)
- `resolvePlannerTaskPrompt()` (line 1175-1197)
- `renderPlannerPromptTemplate()` (line 1199-1227)
- `DEFAULT_PLANNER_TASK_DECOMPOSITION_PROMPT` 常量 (line 119-129)

#### 5.6 保留在 planner.service.ts 中的逻辑

- `normalizeOutline()` — 解析 outline 数据结构，非 prompt 构建
- `tryParseJson()` — JSON 解析工具
- `extractPostDecisionPayload()` — 结果提取
- 其他纯数据处理方法

---

## Step 6：改造 orchestration-context.service.ts — 统一 prompt 构建入口

### 目标

1. 接收从 `planner.service.ts` 迁入的 prompt 构建函数
2. 新增 `resolvePromptFromRegistry()` 统一 HTTP 解析方法
3. 所有 prompt 构建函数走 registry 解析 + mustache 渲染

### 改动

**文件**：`backend/src/modules/orchestration/services/orchestration-context.service.ts`

#### 6.1 新增依赖

```diff
+ import { AgentClientService } from '../../agents-client/agent-client.service';
+ import { ORCHESTRATION_PROMPTS, OrchestrationPromptEntry } from '../orchestration-prompt-catalog';

  constructor(
    @InjectModel(OrchestrationTask.name) ...,
    @InjectModel(OrchestrationRunTask.name) ...,
    private readonly taskOutputValidationService: TaskOutputValidationService,
+   private readonly agentClientService: AgentClientService,
  ) {}
```

#### 6.2 新增统一 registry 解析方法

```typescript
/**
 * 通过 HTTP 调用 agents prompt-registry 解析 prompt 模板。
 * 如果 registry 有发布版则使用发布版，否则使用 catalog 中的 code_default。
 */
private async resolvePromptFromRegistry(
  entry: OrchestrationPromptEntry,
): Promise<string> {
  const resolved = await this.agentClientService.resolvePrompt({
    scene: entry.scene,
    role: entry.role,
    defaultContent: entry.buildDefaultContent(),
  });
  return resolved.content;
}
```

#### 6.3 迁入 planner 的 prompt 构建函数

以下函数从 `planner.service.ts` 迁入，改为 `async` 并内部调用 `resolvePromptFromRegistry()`：

- `buildGeneratingPrompt()` — 原 `buildIncrementalPlannerPrompt()`
- `buildPhaseInitializePrompt()` — 原同名函数
- `buildDefaultOutline()` — 原同名函数
- `resolvePlannerTaskPrompt()` — 原同名函数
- `renderTemplate()` — 原 `renderPlannerPromptTemplate()`，通用化

每个函数的改造模式：
1. 调用 `resolvePromptFromRegistry(ORCHESTRATION_PROMPTS.xxx)` 获取模板
2. 调用 `renderTemplate()` 替换 mustache 变量
3. 动态数据段（列表、条件块）仍在代码中拼装

#### 6.4 已有函数改造

`buildPreTaskContext()` 和 `buildPostTaskContext()` 中的框架 prompt 部分提取到 catalog，同理走 resolve + render。

#### 6.5 buildResearchOutputContract 迁入

从 `task-output-validation.service.ts` 迁入 `buildResearchOutputContract()`，走 registry 解析。

---

## Step 7：精简 task-output-validation.service.ts

### 目标

移除 `buildResearchOutputContract()`（已迁入 contextService），只保留纯校验逻辑。

### 改动

**文件**：`backend/src/modules/orchestration/services/task-output-validation.service.ts`

```diff
- buildResearchOutputContract(kind: ResearchTaskKind): string { ... }
  // 保留：
  validateGeneralOutput(output: string): { valid: boolean; reason?: string; missing?: string[] }
```

### 受影响调用方

`orchestration-context.service.ts` 中的 `buildTaskDescription()` 原本调 `this.taskOutputValidationService.buildResearchOutputContract()`，改为调自身的 `this.buildResearchOutputContract()`。

---

## Step 8：清理 orchestration.module.ts 跨模块 import

### 目标

移除 `PromptRegistryModule` 的跨应用 import。

### 改动

**文件**：`backend/src/modules/orchestration/orchestration.module.ts`

```diff
- import { PromptRegistryModule } from '../../../apps/agents/src/modules/prompt-registry/prompt-registry.module';

  @Module({
    imports: [
      AuthModule,
      AgentClientModule,
-     PromptRegistryModule,
      MessagesModule,
      ...
    ],
```

---

## Step 9：（已确认无需修改）

`getEffectiveTemplate` 返回空内容是正确行为，`AgentClientService.resolvePrompt()` 已处理空内容降级。

---

## Step 10：更新相关测试

### 影响范围

| 文件 | 调整 |
|---|---|
| `backend/test/prompt-resolver.service.spec.ts` | 移除 `cacheOnly` 测试，新增统一链路测试（local → Redis → DB → default） |
| `identity-context.builder.spec.ts` | 移除 `cacheOnly: true` 断言 |
| `agent-executor.service.spec.ts` | 移除 `cacheOnly: true` 断言 |
| `orchestration-context.service.spec.ts` | 更新：mock `AgentClientService`，验证 prompt 解析链路 |
| 新增 `orchestration-prompt-catalog.spec.ts` | 验证所有 entry 的 scene/role 唯一、buildDefaultContent 返回非空 |

---

## Step 11：buildPhaseInitializePrompt Phase 2 去业务耦合

### 当前问题

`buildPhaseInitializePrompt()` 的 Phase 2 部分硬编码了 rd-workflow 特有的工具调用序列：
- 有 existingRequirementId：直接写入 taskContext + update-status(assigned)
- 无 existingRequirementId：requirement.list → requirement.get → plan-initialize(taskContext) → update-status(assigned)

这些指令仅适用于 `domainType=development`，对 general/research 域无意义甚至有害。

### 改造方案

Phase 2 的具体工具调用序列应由 **skill 的 `## phaseInitialize 扩展步骤` 段落**驱动（已有机制，`toolset-context.builder.ts` 的 skill 注入），而非 prompt 模板硬编码。

将 Phase 2 改为框架声明：

```
### Phase 2：扩展步骤（Phase 1 完成后执行）

检查已激活的 skill 中是否定义了 `## phaseInitialize 扩展步骤`。
- 如果有：按 skill 中定义的工具调用序列执行，调用结果通过 plan-initialize(mode=taskContext) 写入。
- 如果没有：Phase 2 跳过，直接结束 phaseInitialize 阶段。

{{extensionStepHint}}
```

其中 `{{extensionStepHint}}` 是代码侧根据 `existingTaskContext` 注入的简短提示（如"已有 requirementId=xxx，可直接使用"），但不包含具体工具调用序列。

### 影响

- `orchestration-context.service.ts`：`buildPhaseInitializePrompt()` Phase 2 段落精简为框架声明
- `docs/skill/rd-workflow.md`：确保 `## phaseInitialize 扩展步骤` 段落完整描述了工具调用序列（已有）
- `toolset-context.builder.ts`：`stripPhaseInitializeSectionIfNeeded()` 的裁剪逻辑需要调整，确保 `planner_initialize` 角色能看到 skill 的扩展步骤

---

## 执行顺序与依赖关系

```
Step 1 (PromptResolverService 简化)          ─┐
Step 4 (PROMPT_SCENES/ROLES 扩展)            ─┤── 无互相依赖，可并行
                                               │
Step 2 (AgentClientService.resolvePrompt)    ←─┘
                                               │
Step 3 (orchestration-prompt-catalog.ts)     ←── 依赖 Step 2
                                               │
Step 6 (contextService 统一 prompt 构建)     ←── 依赖 Step 2 + Step 3
Step 5 (planner 迁出 prompt 构建)            ←── 依赖 Step 6（contextService 就绪后才能迁出）
Step 7 (validation service 精简)             ←── 依赖 Step 6
Step 8 (module 跨模块 import 清理)           ←── 依赖 Step 5 + Step 6
Step 11 (Phase 2 去耦合)                     ←── 依赖 Step 6
                                               │
Step 10 (测试更新)                           ←── 依赖所有上游
```

Step 9 已确认无需修改。

## 风险与降级

| 风险 | 降级 |
|---|---|
| agents 服务不可达 | `AgentClientService.resolvePrompt()` catch 后返回 code_default，编排流程不中断 |
| Redis 缓存丢失 | 统一链路下自动回查 DB，不再跳过 |
| DB 查询超时 | 保留现有超时机制，降级到 code_default |
| prompt 模板变量缺失 | `renderTemplate()` 保留未替换的 `{{variable}}`，不崩溃 |
| 发布了空内容的 prompt | `resolvePrompt()` 判断空内容后使用 code_default |
| contextService 循环依赖 | `PlannerService` → `OrchestrationContextService` 单向依赖，无循环风险 |

## 向后兼容

- 所有 prompt 的 `buildDefaultContent()` 保持当前硬编码内容不变，无 DB 发布版时行为完全一致
- agents 侧 `PromptResolverService.resolve()` 接口签名变更（移除 cacheOnly），agents 内部调用方同步清理
- orchestration 侧对外接口无变化
- `PlannerService` 的公开方法签名不变，内部实现委托给 contextService
