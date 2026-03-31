# 技术方案：Planner Initialize 重构 + Skill 激活门控

## 关联文档

- Plan：`docs/plan/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE.md`
- 问题追踪：`docs/issue/PLAN_OPTIMAZE.md`

---

## 一、Skill 激活门控（Tag-Based Activation Rule）

### 1.1 设计目标

当前 `shouldActivateSkillContent()` 基于语义匹配和 task.type 标签匹配，粒度过粗，导致 rd-workflow 等 skill 在所有 planner 阶段都被激活注入。需要支持按 domainType / taskType / phase / roleInPlan 等上下文字段精确控制。

### 1.2 Tag 语法规范

```
格式：field:value[,value2,...]:rule

field   — 上下文字段名，支持：domainType | taskType | phase | roleInPlan
value   — 字段值，多个值用逗号分隔（OR 关系）
rule    — 激活规则：must | no | enable

示例：
  domainType:development:must          → 仅 development 域可激活
  taskType:development.plan,development.review:must  → taskType 为 plan 或 review 时满足
  taskType:development.exec:no         → taskType 为 exec 时排除
  phase:initialize:enable              → initialize 阶段建议激活（非强制）
```

非 `field:value:rule` 格式的 tag 保持原有语义不变（如 `rd-workflow`、`planning` 等标签用于搜索和分类）。

### 1.3 匹配算法

```
输入：
  - activationTags: 从 skill.tags 中解析出的激活规则列表
  - context: { domainType, taskType, phase, roleInPlan }

优先级：no > must > enable

Step 1 — NO 检查（最高优先级）：
  遍历 rule=no 的 tag：
    if context[field] 匹配 values 中任一值 → 返回 INACTIVE（短路）

Step 2 — MUST 检查：
  遍历 rule=must 的 tag：
    if context[field] 不匹配 values 中任何值 → 返回 INACTIVE（短路）
  所有 must 通过 → 继续

Step 3 — 激活：
  must 全部通过 + no 全部未命中 → 返回 ACTIVE
  （enable tag 命中记录到日志，用于调试和未来加权排序）
```

### 1.4 代码改动

#### `context-strategy.service.ts`

```typescript
// 新增类型
interface ActivationTag {
  field: 'domainType' | 'taskType' | 'phase' | 'roleInPlan';
  values: string[];
  rule: 'must' | 'no' | 'enable';
}

interface SkillActivationContext {
  domainType?: string;
  taskType?: string;
  phase?: string;
  roleInPlan?: string;
}

// 新增方法
parseActivationTags(tags: string[]): ActivationTag[] {
  const VALID_FIELDS = ['domainType', 'taskType', 'phase', 'roleInPlan'];
  const VALID_RULES = ['must', 'no', 'enable'];
  return tags
    .map(tag => {
      const parts = tag.split(':');
      if (parts.length !== 3) return null;
      const [field, valueStr, rule] = parts;
      if (!VALID_FIELDS.includes(field) || !VALID_RULES.includes(rule)) return null;
      return { field, values: valueStr.split(','), rule } as ActivationTag;
    })
    .filter(Boolean);
}

evaluateActivationTags(
  activationTags: ActivationTag[],
  context: SkillActivationContext
): { active: boolean; reason: string } {
  // Step 1: NO 检查
  for (const tag of activationTags.filter(t => t.rule === 'no')) {
    const contextValue = context[tag.field];
    if (contextValue && tag.values.includes(contextValue)) {
      return { active: false, reason: `no rule matched: ${tag.field}=${contextValue}` };
    }
  }

  // Step 2: MUST 检查
  for (const tag of activationTags.filter(t => t.rule === 'must')) {
    const contextValue = context[tag.field];
    if (!contextValue || !tag.values.includes(contextValue)) {
      return { active: false, reason: `must rule failed: ${tag.field}=${contextValue ?? 'undefined'}, expected ${tag.values.join(',')}` };
    }
  }

  // Step 3: 激活
  const enableHits = activationTags
    .filter(t => t.rule === 'enable')
    .filter(t => {
      const v = context[t.field];
      return v && t.values.includes(v);
    });
  return { active: true, reason: enableHits.length > 0 ? `enable hints: ${enableHits.map(t => `${t.field}=${t.values.join(',')}`).join('; ')}` : 'all must passed' };
}
```

#### `shouldActivateSkillContent()` 改造

```typescript
shouldActivateSkillContent(
  skill: EnabledAgentSkillContext,
  task: { type: string; title?: string; description?: string },
  collaborationContext?: CollaborationContext,
  activationContext?: SkillActivationContext    // ← 新增参数
): boolean {
  // 1. precise 模式（白名单）不变
  if (collaborationContext?.skillActivation?.mode === 'precise') { ... }

  // 2. 检查是否有 tag-based 激活规则
  const activationTags = this.parseActivationTags(skill.tags || []);
  if (activationTags.length > 0 && activationContext) {
    const result = this.evaluateActivationTags(activationTags, activationContext);
    this.logger.debug(`Skill ${skill.name} tag-based activation: ${result.active} (${result.reason})`);
    return result.active;
  }

  // 3. 无激活 tag → 走原有逻辑（向后兼容）
  // ... 现有 meeting 场景、task.type 匹配、语义匹配逻辑不变
}
```

#### 上下文透传

`collaborationContext` 中已有 `roleInPlan`，需要补充透传 `domainType` / `phase`。

改动点：
- `CollaborationContextFactory.orchestration()` 新增可选字段 `domainType` 和 `phase`
- `planner.service.ts` 各阶段调用 `executeTask` 时传入当前 phase
- `orchestration-step-dispatcher.service.ts` 传入 `plan.domainType`
- `toolset-context.builder.ts` 的 `build()` 方法从 collaborationContext 提取 activationContext 传给 `shouldActivateSkillContent()`

#### 现有 Skill Tag 更新

| Skill | 新增 Tag |
|-------|---------|
| rd-workflow | `domainType:development:must` |
| orchestration-runtime-tasktype-selection | `roleInPlan:planner,planner_pre_execution:must`, `phase:pre_execute:must` |
| orchestration-runtime-task-out-validation | `roleInPlan:planner,planner_post_execution:must`, `phase:post_execute:must` |

---

## 二、orchestration-plan-initialize 工具

### 2.1 设计目标

提供结构化的 metadata 写入能力，Planner 在 initialize 阶段通过工具调用写入大纲和上下文，替代 LLM 输出 JSON 文本 + 系统侧解析的不稳定方式。

### 2.2 工具定义

```
Tool ID: builtin.sys-mg.mcp.orchestration.plan-initialize
Name: Orchestration Plan Initialize
Description: Write structured data to plan metadata during phaseInitialize

Parameters:
  planId   (string, required)  — 计划 ID
  mode     (string, required)  — 写入目标字段名，写入 plan.metadata[$mode]
  data     (object, required)  — 写入内容
```

### 2.3 mode 规范

| mode | 写入路径 | data schema | 说明 |
|------|---------|-------------|------|
| `outline` | `plan.metadata.outline` | `OutlineItem[]`（见下方） | 大纲 + 预编译 prompt + 推荐 agent + 工具列表 |
| `taskContext` | `plan.metadata.taskContext` | `Record<string, any>` | 计划级共享上下文 |
| 其他自定义 | `plan.metadata[$mode]` | `any` | 扩展预留 |

### 2.4 OutlineItem Schema

```typescript
interface OutlineItem {
  step: number;                          // 步骤序号，从 1 开始
  title: string;                         // 步骤标题
  taskType: string;                      // 任务类型（合法值见 tasktype-selection skill）
  recommendedAgent?: {                   // 推荐执行 agent（建议性）
    agentId: string;
    agentName: string;
    reason: string;
  };
  phasePrompts: {                        // 各阶段预编译 prompt
    generating: string;                  // planner 生成 task 时的指令
    pre_execute: string;                 // planner pre_execute 阶段指令
    execute: string;                     // executor 执行时的任务指导
    post_execute: string;               // planner post_execute 阶段指令
  };
  phaseTools?: {                         // 各阶段建议使用的工具（建议性）
    pre_execute?: string[];
    execute?: string[];
    post_execute?: string[];
  };
}
```

### 2.5 后端校验规则

`mode=outline` 时：
- `data` 必须为数组，每个元素校验：
  - `step`(number)、`title`(string)、`taskType`(string) 必填
  - `phasePrompts` 必填，其中 `generating` / `post_execute` 必填，`pre_execute` / `execute` 可选
  - `taskType` 必须在合法列表内（general / research / development.plan / development.exec / development.review）
- 单个 phasePrompt 内容长度上限 2000 字符

`mode=taskContext` 时：
- `data` 必须为对象
- 与已有 taskContext 做 merge（非覆盖），避免扩展步骤覆盖核心步骤写入的数据

### 2.6 阶段拦截

该工具仅在 `roleInPlan = planner_initialize` 时允许调用。其他阶段调用返回错误消息并引导 LLM 回到当前阶段职责。

### 2.7 代码改动

#### `builtin-tool-catalog.ts`

新增工具注册条目，parameters schema 按 2.2 定义。

#### `orchestration-tool-handler.service.ts`

```typescript
async planInitialize(
  params: { planId: string; mode: string; data: any },
  executionContext?: ToolExecutionContext
): Promise<any> {
  // 1. planId 从 executionContext.collaborationContext.planId 覆写（防幻觉）
  const planId = executionContext?.collaborationContext?.planId || params.planId;
  if (!Types.ObjectId.isValid(planId)) {
    return { error: 'Invalid planId' };
  }

  // 2. roleInPlan 阶段拦截
  const roleInPlan = executionContext?.collaborationContext?.roleInPlan;
  if (roleInPlan !== 'planner_initialize') {
    return { error: `plan-initialize 仅在 phaseInitialize 阶段可用，当前 roleInPlan=${roleInPlan}` };
  }

  // 3. mode 校验 + data 校验（按 mode 分发）
  if (params.mode === 'outline') {
    const validation = this.validateOutlineData(params.data);
    if (!validation.valid) return { error: validation.reason };
  }

  // 4. 写入 metadata
  // mode=taskContext 时做 merge
  const updateOp = params.mode === 'taskContext'
    ? { $set: Object.fromEntries(
        Object.entries(params.data).map(([k, v]) => [`metadata.taskContext.${k}`, v])
      )}
    : { $set: { [`metadata.${params.mode}`]: params.data } };

  await this.internalApiClient.callOrchestrationApi('PATCH', `/plans/${planId}/metadata`, updateOp);
  return { success: true, mode: params.mode, written: Object.keys(params.data) };
}
```

#### `tool-execution-dispatcher.service.ts`

```typescript
case 'builtin.sys-mg.mcp.orchestration.plan-initialize':
  return this.orchestrationToolHandler.planInitialize(parameters, executionContext);
```

---

## 三、phaseInitialize 流程重构

### 3.1 新流程概览

```
advanceOnce() — phase='idle'
  ↓
  shouldRunInitialize()
    → 检查 metadata.outline 是否存在且含 phasePrompts → 不存在则需要 initialize
  ↓
  ensurePlannerSession('initialize')
  ↓
  phaseInitialize()
    ↓
    plannerService.initializePlan()
      → buildPhaseInitializePrompt()
        - 注入 skill 全文（仅本阶段，后续阶段不再注入）
        - Phase 1 核心指令：
          1) list-agents 获取可用 agent 列表
          2) 分析 skill 定义，确定步骤大纲
          3) 为每步每阶段生成 prompt 片段
          4) 调用 plan-initialize(mode=outline) 写入
        - Phase 2 扩展指令（从 skill 中提取）：
          如 rd-workflow 定义：requirement.list → requirement.get → update-status
          完成后调用 plan-initialize(mode=taskContext) 写入
      → agentClientService.executeTask()
        - roleInPlan: 'planner_initialize'
        - skill 通过 tag-based gate 激活（rd-workflow 的 phase:initialize:enable 命中）
    ↓
    从 DB 读取 plan.metadata.outline 验证写入成功
      → 成功：更新 currentPhase='idle'，发出 'planning.initialized'，autoAdvance
      → 失败：归档 session，重试（最多 N 次）
```

### 3.2 与当前流程的差异

| 项 | 当前 | 新方案 |
|----|------|--------|
| outline 写入方式 | 解析 LLM 响应 JSON | 工具调用 plan-initialize(mode=outline) |
| taskContext 写入方式 | 解析 LLM 响应 JSON | 工具调用 plan-initialize(mode=taskContext) |
| initialize 完成判断 | 解析 JSON 成功 + requirementId 存在 | DB 中 metadata.outline 存在且含 phasePrompts |
| 降级策略 | extractInitializeFieldsFromText() 正则提取 | 工具调用有后端校验，失败重试新 session |
| skill 注入范围 | skill 全文在所有阶段注入 | 仅 initialize 阶段注入全文，后续读 phasePrompts |
| requirement 获取 | initialize 阶段 planner 直接执行 | skill 扩展步骤（可剥离为独立 task） |

### 3.3 buildPhaseInitializePrompt() 重写

核心 prompt 结构：

```
## 你正在执行 phaseInitialize 阶段

### Phase 1：大纲与 Prompt 预编译（必做）

1. 调用 list-agents 获取可用 agent 列表及其 capabilitySet
2. 根据本次计划的 domainType 和 skill 定义，确定步骤大纲
3. 为每个步骤的 4 个阶段（generating / pre_execute / execute / post_execute）生成专用 prompt
   - generating prompt：描述 planner 在生成该步骤 task 时应包含的指令
   - pre_execute prompt：描述 planner 在执行前检查应完成的动作
   - execute prompt：描述 executor 执行任务时的详细指导
   - post_execute prompt：描述 planner 在执行后评估应遵循的规则
4. 为每个步骤选择推荐 agent（根据 capabilitySet 匹配 taskType）
5. 调用 plan-initialize(mode=outline, data=[...]) 写入

### Phase 2：扩展步骤（由 skill 定义，可选）

{从 skill 中提取的 phaseInitialize 扩展步骤，如果有的话}

完成扩展步骤后，调用 plan-initialize(mode=taskContext, data={...}) 写入结果

### 约束
- 本阶段严禁调用 submit-task
- 所有数据写入必须通过 plan-initialize 工具完成
- 禁止输出确认性文本

### 输入
- planId: {planId}
- domainType: {domainType}
- sourcePrompt: {sourcePrompt}
```

### 3.4 shouldRunInitialize() 改造

```typescript
private shouldRunInitialize(plan: OrchestrationPlan): boolean {
  const outline = plan.metadata?.outline;
  if (!Array.isArray(outline) || outline.length === 0) return true;

  // 检查是否含有 phasePrompts（区分新旧格式）
  const hasPhasePrompts = outline.every(
    item => item.phasePrompts && item.phasePrompts.generating && item.phasePrompts.post_execute
  );
  if (!hasPhasePrompts) return true;

  return false;
}
```

---

## 四、后续阶段 Prompt 注入链路改造

### 4.1 generating 阶段

当前 `buildIncrementalPlannerPrompt()` 中有大段硬编码的 skill 步骤引导指令。

改造后：

```typescript
// planner.service.ts — buildIncrementalPlannerPrompt()

const currentOutlineStep = plan.metadata?.outline?.[context.currentStep - 1];
const generatingPrompt = currentOutlineStep?.phasePrompts?.generating;

// 框架性 prompt（保留）
const frameworkPrompt = [
  '## 阶段隔离声明',
  '你当前处于 generating 阶段，只负责通过 submit-task 提交下一个任务。',
  '',
  '## submit-task 工具使用说明',
  '...',  // 保留现有工具说明
  '',
  '## 行为约束',
  '- 每次只提交一个任务',
  '- 禁止输出确认性文本',
  '',
].join('\n');

// 步骤指导（来自预编译 prompt）
const stepGuidance = generatingPrompt
  ? `## 当前步骤指导（Step ${context.currentStep}）\n\n${generatingPrompt}`
  : ''; // 降级：无预编译 prompt 时走原有逻辑

// 上下文信息（保留）
const contextInfo = [
  `## 计划上下文`,
  `- 当前步骤: ${context.currentStep} / ${context.totalSteps}`,
  `- 已完成任务: ${context.completedTasks.map(t => t.title).join(', ')}`,
  // ...
].join('\n');
```

### 4.2 pre_execute 阶段

```typescript
// orchestration-context.service.ts — buildPreTaskContext()

const outlineStep = plan.metadata?.outline?.[stepIndex];
const preExecutePrompt = outlineStep?.phasePrompts?.pre_execute;

if (preExecutePrompt) {
  // 使用预编译 prompt
  sections.push(`## Pre-Execute 指令\n\n${preExecutePrompt}`);
} else {
  // 降级：使用现有 preExecuteActions 逻辑
  if (outlineStep?.preExecuteActions) { ... }
}
```

### 4.3 post_execute 阶段

```typescript
// orchestration-context.service.ts — buildPostTaskContext()

const outlineStep = plan.metadata?.outline?.[stepIndex];
const postExecutePrompt = outlineStep?.phasePrompts?.post_execute;

// 执行结果注入（保留，XML 标签包裹）
sections.push(`<execution_output>${executionOutput}</execution_output>`);

// 决策指令（来自预编译 prompt）
if (postExecutePrompt) {
  sections.push(`## Post-Execute 决策规则\n\n${postExecutePrompt}`);
} else {
  // 降级：使用现有硬编码决策规则
}
```

### 4.4 execute 阶段

executor 的 prompt 中注入 `phasePrompts.execute` 作为任务详细指导：

```typescript
// orchestration-context.service.ts — buildTaskDescription() 或 orchestration-execution-engine

const outlineStep = plan.metadata?.outline?.[stepIndex];
const executePrompt = outlineStep?.phasePrompts?.execute;

if (executePrompt) {
  // 注入为任务描述的补充段落
  taskDescription += `\n\n## 执行指导\n\n${executePrompt}`;
}
```

### 4.5 降级策略

所有阶段的预编译 prompt 读取都应有降级路径：
- 如果 `plan.metadata.outline` 不存在或格式不符 → 走当前硬编码逻辑
- 如果某个 step 的 phasePrompts 缺失某个 phase → 该 phase 走硬编码逻辑
- 这保证了向后兼容：已有计划（metadata 中无 phasePrompts）不受影响

---

## 五、Requirement 获取剥离（可延后）

### 5.1 方案

将 rd-workflow skill 中 phaseInitialize 扩展步骤的 requirement 获取改为 outline 中的正常 step：

```json
{
  "step": 0,
  "title": "选定开发需求",
  "taskType": "general",
  "phasePrompts": {
    "generating": "生成一个需求选定任务：调用 requirement.list 获取 todo 状态需求，选择优先级最高的，调用 requirement.get 获取详情，调用 requirement.update-status 设为 assigned",
    "execute": "...",
    "post_execute": "验证 taskContext 中已写入 requirementId，决定 generate_next"
  }
}
```

或者保留在 initialize 扩展步骤中（通过 plan-initialize(mode=taskContext) 写入），两种方式均可。

### 5.2 影响

- 如果剥离为 step0：总步骤从 3 变为 4，post_execute 的进度计算需调整
- 如果保留在 initialize 扩展：当前方式不变，仅需更新 skill 文档格式

建议先保留在 initialize 扩展步骤中，后续视需要再剥离。

---

## 六、数据流总览

```
┌─────────────────────────────────────────────────────────────┐
│                    phaseInitialize                           │
│                                                             │
│  Planner + Skill 全文                                       │
│    │                                                        │
│    ├─ list-agents → 获取 agent 列表                          │
│    ├─ 分析 skill → 确定步骤 + 生成 phasePrompts              │
│    ├─ plan-initialize(mode=outline) → metadata.outline       │
│    │   [{step, title, taskType, recommendedAgent,            │
│    │     phasePrompts: {generating, pre_execute,             │
│    │                    execute, post_execute},              │
│    │     phaseTools: {...}}]                                 │
│    │                                                        │
│    ├─ Skill 扩展步骤（如 requirement 获取）                   │
│    └─ plan-initialize(mode=taskContext) → metadata.taskContext│
│        {requirementId, requirementTitle, ...}               │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │     generating          │
          │  读取 outline[i]        │
          │  .phasePrompts          │
          │  .generating            │
          │  + 框架 prompt          │
          │  → submit-task          │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │     pre_execute         │
          │  读取 outline[i]        │
          │  .phasePrompts          │
          │  .pre_execute           │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │     execute             │
          │  读取 outline[i]        │
          │  .phasePrompts          │
          │  .execute               │
          │  → executor 执行        │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │     post_execute        │
          │  读取 outline[i]        │
          │  .phasePrompts          │
          │  .post_execute          │
          │  + 执行结果(XML)        │
          │  → 决策 next/stop       │
          └────────────┬────────────┘
                       │
                  下一步 / 结束
```

**关键变化**：Skill 全文仅在 initialize 阶段进入 LLM 上下文，后续四个阶段全部读取预编译的 phasePrompts，上下文大幅精简。
