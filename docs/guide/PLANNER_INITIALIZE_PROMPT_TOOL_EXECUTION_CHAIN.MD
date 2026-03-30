# Planner Initialize 阶段 Prompt 与工具执行链路分析

> 基于 2026-03-30 多轮 phaseInitialize 失败 session 的深度分析，梳理 LLM 上下文组装、工具执行循环、skill 内容注入的完整链路，以及当前已识别的冲突点。

## 一、phaseInitialize 的调用链路

```
orchestration-step-dispatcher.service.ts
  │  advanceOnce() — phase='idle'
  │    └─ shouldRunInitialize() → metadata.outline 不存在或无效
  │
  ├─ ensurePlannerSession('initialize')
  │
  └─ phaseInitialize()                               [line 245-318]
       │
       └─ plannerService.initializePlan()              [planner.service.ts:347-416]
            │
            ├─ buildPhaseInitializePrompt()            [planner.service.ts:855-1004]
            │   → 生成 user prompt（Phase 1 outline + Phase 2 扩展步骤）
            │
            ├─ agentClientService.executeTask()
            │   → collaborationContext: roleInPlan='planner_initialize'
            │   → 进入 agent-executor 的 tool-calling loop
            │
            └─ 从 DB 读取 plan.metadata.outline 验证写入结果
                 → 成功：emitPlanStreamEvent('planning.initialized') + autoAdvance
                 → 失败：归档 session + bumpFailureCounters + 重试
```

## 二、LLM 上下文的完整组装顺序

当 `executeTask()` 被调用后，LLM 收到的 messages 按以下顺序组装：

| 序号 | 角色 | 来源 | 内容 |
|------|------|------|------|
| 1 | system | `agent-runtime-baseline` skill | Agent Runtime Baseline（工具调用纪律、协作规则、降级策略） |
| 2 | system | agent.systemPrompt | "你是CTO，主要负责将日常研发需求分配给团队执行" |
| 3 | system | identity context | Agent Profile、技能矩阵、能力域、工具集列表 |
| 4 | system | skill 内容注入 | `rd-workflow` 全文（含 `## phaseInitialize 扩展步骤`） |
| 5 | system | skill 内容注入 | `orchestration-runtime-task-out-validation` 全文 |
| 6 | system | skill 内容注入 | `orchestration-runtime-tasktype-selection` 全文 |
| 7 | system | 工具列表 + Tool Use Strategy | 可用工具枚举 + 各工具的 prompt 策略 |
| 8 | system | collaborationContext | `roleInPlan='planner_initialize'` 等运行环境信息 |
| 9 | system | task info | 任务标题、类型、优先级 |
| 10 | **user** | `buildPhaseInitializePrompt()` | Phase 1 + Phase 2 指令 |

**关键发现**：LLM 上下文中，**skill 内容（#4）在 user prompt（#10）之前注入**。rd-workflow 的 `## phaseInitialize 扩展步骤` 提供了 4 步具体工具调用序列（requirement.list → requirement.get → plan-initialize(taskContext) → update-status），这些指令在 LLM 视角中是"更早出现的 system 级指令"。

## 三、Agent Executor 的工具执行循环

工具调用不是系统自动触发，而是 LLM 自主输出 `<tool_call>` 标签后由 executor 循环处理。

```
agent-executor.service.ts — tool-calling loop
  │
  ├─ LLM 输出包含 <tool_call> 标签
  │   └─ parseToolCallPayload() 解析工具 ID 和参数
  │
  ├─ tool-execution-dispatcher.service.ts 路由到具体 handler
  │   └─ orchestration-tool-handler.service.ts（plan-initialize / submit-task 等）
  │       → planId 从 executionContext.collaborationContext.planId 覆写（防幻觉）
  │       → roleInPlan 阶段拦截（submit-task 在 initialize 阶段被硬拦截）
  │
  ├─ 工具结果作为 system message 注入 LLM 上下文
  │
  └─ 下一轮 LLM 输出
      → 最多 DEFAULT_MAX_TOOL_ROUNDS=30 轮
      → 若 LLM 输出纯文本（无 tool_call），触发 text-only retry 机制
```

### planId 防幻觉机制

`tool-execution-dispatcher.service.ts` + `orchestration-tool-handler.service.ts` 中：
- `submit-task` / `report-task-run-result` / `plan-initialize` 的 planId 均从 `executionContext.collaborationContext.planId` 覆写
- LLM 传入的 planId 值被忽略（防止使用幻觉值或标题字符串）
- 但 LLM 仍须在 `<tool_call>` 参数中提供 planId 字段（schema 校验要求），否则触发"参数修正"重试

### text-only retry 机制

`agent-executor.service.ts` 中 `isPlannerTextOnlyRetryNeeded()`：
- 当 `roleInPlan` 以 `planner` 开头且 LLM 输出纯文本时，注入纠正指令 retry 一次
- 若 `roleInPlan === 'planner_initialize'`，纠正指令特化为"当前是 phaseInitialize 阶段，请继续未完成的工具调用序列或输出最终 JSON"

## 四、Skill 内容在各阶段的裁剪规则

### 当前实现

`toolset-context.builder.ts` 中 `stripPhaseInitializeSectionIfNeeded()`：

| roleInPlan | skill 内容处理 |
|------------|---------------|
| `planner_initialize` | **保留全文**（包含 phaseInitialize 扩展步骤） |
| `planner`（generating） | 裁剪 `## phaseInitialize` 段落 |
| `planner_pre_execution` | 裁剪 |
| `planner_post_execution` | 裁剪 |
| 非 planner | 保留全文（不做裁剪） |

### Tag-Based 激活门控（已设计，部分实现）

skill 的 tags 中支持 `field:value:rule` 格式的激活规则：

```
domainType:development:must    → 仅 development 域激活
phase:initialize:enable        → initialize 阶段建议激活
phase:pre_execute:must         → 仅 pre_execute 阶段激活
roleInPlan:planner:must        → 仅 planner 角色激活
```

优先级：`no > must > enable`。当前 rd-workflow 的 tags 包含 `domainType:development:must` 和 `phase:initialize:enable`。

## 五、已识别的 Prompt 冲突问题

### 冲突 1：Skill 扩展步骤 vs Prompt Phase 1 的优先级

| 指令来源 | 内容 | LLM 执行优先级 |
|----------|------|---------------|
| rd-workflow skill（system message #4） | "1. 调用 requirement.list(status=todo)..." — 4 步具体序列 | **高**（更早注入、更具体） |
| buildPhaseInitializePrompt（user message #10） | "Phase 1：先调 list-agents → 生成 outline → plan-initialize(mode=outline)" | **低**（后注入、需 LLM 推理生成 outline 数据） |

**结果**：LLM 在所有测试 session 中都跳过了 Phase 1（outline 生成），直接执行 skill 的扩展步骤（requirement 锚定），导致 `metadata.outline` 为空 → `hasValidOutlineWithPrompts()` 校验失败 → 进入重试循环。

### 冲突 2：existingRequirementId 与 skill 的 requirement.list 指令

当第二轮 initialize（重试）时，`existingTaskContext` 已包含 requirementId，prompt 中会渲染 `existingRequirementId=xxx` 并指示"跳过 requirement.list"。但 skill 的扩展步骤仍然要求"调用 requirement.list(status=todo)"，LLM 优先遵循 skill 指令，查到 0 条（需求已被第一轮改为 assigned）后卡死。

### 冲突 3：planId 在 plan-initialize(taskContext) 调用中缺失

尽管 prompt 中的示例包含 planId，LLM 在调用 `plan-initialize(mode=taskContext)` 时持续遗漏 planId 参数。这是因为：
- skill 文档中的 JSON 示例不含 planId 字段
- 系统的 planId 覆写机制可以兜底，但 schema 校验会先报错触发参数修正重试

## 六、关键代码文件索引

| 文件 | 路径 | 关键方法 |
|------|------|---------|
| planner.service.ts | `backend/src/modules/orchestration/planner.service.ts` | `initializePlan()` :347, `buildPhaseInitializePrompt()` :855 |
| orchestration-step-dispatcher.service.ts | `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | `phaseInitialize()` :245, `shouldRunInitialize()`, `hasValidOutlineWithPrompts()` |
| orchestration-context.service.ts | `backend/src/modules/orchestration/services/orchestration-context.service.ts` | `buildPreTaskContext()` :237, `buildPostTaskContext()`, `resolvePlanTaskContextFromMetadata()` |
| agent-executor.service.ts | `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | tool-calling loop :1086+, `isPlannerTextOnlyRetryNeeded()`, `buildForcedToolCallInstruction()` |
| toolset-context.builder.ts | `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | `stripPhaseInitializeSectionIfNeeded()` :141, skill 内容注入 :73-136 |
| context-strategy.service.ts | `backend/apps/agents/src/modules/agents/context/context-strategy.service.ts` | `shouldActivateSkillContent()`, `parseActivationTags()`, `buildToolPromptMessages()` :166 |
| orchestration-tool-handler.service.ts | `backend/src/modules/orchestration/services/orchestration-tool-handler.service.ts` | `planInitialize()`, planId 覆写, roleInPlan 阶段拦截 |
| tool-execution-dispatcher.service.ts | `backend/src/modules/orchestration/services/tool-execution-dispatcher.service.ts` | 工具路由分发 |
| agent-prompt-catalog.ts | `backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts` | `toolStrategyWrapper` :66, `forcedToolCallInstruction` :102 |
| builtin-tool-catalog.ts | `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` | plan-initialize 工具注册, requirement.list 工具注册 |
| rd-workflow.md | `docs/skill/rd-workflow.md` | phaseInitialize 扩展步骤 :48-68, 步骤定义 :70-109 |

## 七、待解决方向

### 方向 A：Initialize 阶段裁剪 skill 的 phaseInitialize 扩展步骤

在 `toolset-context.builder.ts` 中，当 `roleInPlan === 'planner_initialize'` 时，不再保留 skill 的 `## phaseInitialize 扩展步骤` 全文，而是由 `buildPhaseInitializePrompt()` 统一提供完整指引（含 existingRequirementId 条件分支和 outline 示例）。

**优点**：消除上下文中的指令冲突，LLM 只看到一套指令
**代价**：需要确保 `buildPhaseInitializePrompt()` 完整覆盖 skill 扩展步骤的所有场景

### 方向 B：在 prompt 中声明优先级

在 `buildPhaseInitializePrompt()` 开头添加"本指令优先级高于 skill 中的 phaseInitialize 扩展步骤"。

**优点**：改动最小
**代价**：不保证 LLM 一定遵循（实测中 skill 的具体指令仍可能胜出）

### 当前推荐：方向 A

方向 A 更可靠，因为 `buildPhaseInitializePrompt()` 已经覆盖了 requirement 锚定（含 existingRequirementId 分支）和 outline 生成的完整指引，skill 的扩展步骤在 initialize prompt 中是冗余信息源。
