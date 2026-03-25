# [已弃用] ORCHESTRATION_PLANNER_JSON_CONFORMANCE_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Planner JSON 输出遵从性修复方案

## 背景

在增量编排（Incremental Planning）E2E 测试中发现：`IncrementalPlanningService` 调用 `PlannerService.generateNextTask()` 时，planner agent 始终返回自然语言（角色确认、寒暄），而非 prompt 要求的 JSON 结构。这导致 3 轮重试后编排终止，无法生成任何任务。

### 现象

planner prompt 中已包含 `[SYSTEM OVERRIDE] Planner JSON-only 模式` 强制指令，但 agent 仍然回复：

- 第1轮: `"您好，我是 Kim-CTO。请告诉我你要我执行的具体任务"` (74字符)
- 第2轮: `"收到，我将以 Kim-CTO（role-executive-lead）身份按你给定规则执行..."` (297字符)
- 第3轮: `"好的，我是 Kim-CTO。已准备按你的规则执行..."` (75字符)

### 根因分析

Agent executor 的消息构建链路：

```
1. Identity System Prompt (agent 的角色设定 + 工具调用规则 + 行为约束)
   ↓ 高优先级 — LLM 首先遵循
2. Skill Prompts (如有绑定)
   ↓
3. Session History (如有)
   ↓
4. User Message = planner prompt (包含 JSON-only 指令)
   ↓ 低优先级 — LLM 倾向当作"用户请求"而非"系统指令"
```

agent 的 identity prompt（由 `IdentityContextBuilder` 构建）包含：
- 角色名称与人设（如 "Kim-CTO, executive-lead"）
- 工具调用格式指令（`<tool_call>` 格式）
- 协作规则与行为约束

LLM 将 identity prompt 视为最高优先级指令，将 planner prompt 视为普通用户对话，因此优先执行"角色初始化"（问候、确认就绪），忽略了 JSON-only 要求。

### 已尝试但无效的修复

- 在 `buildIncrementalPlannerPrompt` 最前面添加 `[SYSTEM OVERRIDE] JSON-only` 指令 → 无效，因为该指令作为 user message 注入，优先级低于 system prompt
- `collaborationContext.format = 'json'` → 透传但 agent executor 未消费该字段

---

## 核心目标

让 planner agent 在增量编排场景下严格输出 JSON，不受角色 identity prompt 干扰。

---

## 影响范围

| 层级 | 影响 |
|------|------|
| **Agent Executor** | `agent-executor.service.ts` — 需要感知 `collaborationContext.format` |
| **Identity Context Builder** | `identity-context.builder.ts` — 可能需要在 planning 模式下追加指令 |
| **Planner Service** | `planner.service.ts` — prompt 构建优化 |
| **Schema** | 无变更 |
| **前端** | 无影响 |

---

## 方案选项

### 方案 A: Agent Executor 层注入 JSON 强制指令（推荐）

**思路**: 在 `AgentExecutorService` 构建 system prompt 时，检测 `collaborationContext.format === 'json'`，在 identity prompt **末尾**追加一段 JSON-only 强制输出指令。

**优点**: 改动范围最小，不影响其他场景，JSON 指令作为 system prompt 的一部分具有最高优先级。

**步骤**:

1. **`agent-executor.service.ts`** — 在 `buildSystemMessages()` 或等效方法中：
   - 检查 `executionContext.collaborationContext?.format === 'json'`
   - 如果为 json 模式，在 system prompt 末尾追加：
     ```
     [JSON-ONLY MODE] 你当前处于纯 JSON 输出模式。你的回复必须且只能是一个合法 JSON 对象，以 { 开头以 } 结尾。禁止输出任何自然语言文本、问候、确认、解释。违反此规则将导致系统错误。
     ```
2. **`identity-context.builder.ts`** — 在 `buildIdentityContext()` 返回前，检查 context 中是否携带 `format: 'json'`，如果是则追加 JSON 模式指令（备选位置，与步骤 1 二选一）
3. **`planner.service.ts`** — 保留已有的 `[SYSTEM OVERRIDE]` 前缀作为双重保障

**预估工作量**: 小

### 方案 B: 创建专用 Planner Agent

**思路**: 新建一个专门用于 planning 的轻量 agent，其 identity prompt 仅包含 "你是一个纯 JSON 输出的计划编排器"，不包含任何角色设定。

**优点**: 彻底隔离 planner 和业务 agent 的角色冲突。

**缺点**: 需要额外管理一个 agent，且需要修改现有 Plan 创建流程的 `plannerAgentId` 选择逻辑。

**步骤**:

1. 通过 seed 或 API 创建 `system-planner` agent，`systemPrompt` 仅包含 JSON 编排器指令
2. `PlanManagementService.createPlanFromPrompt()` 中，当 `generationMode === 'incremental'` 时，优先使用 `system-planner` 作为 `plannerAgentId`（可被 dto 覆盖）
3. 移除 `buildIncrementalPlannerPrompt` 中的 `[SYSTEM OVERRIDE]` 冗余指令

**预估工作量**: 中

### 方案 C: 双消息注入（system + user）

**思路**: 在 `generateNextTask` 调用 agent 时，将 JSON-only 约束作为额外的 **system message** 注入到消息链中，而非放在 user message 里。

**优点**: JSON 约束以 system 角色注入，LLM 优先级等同于 identity prompt。

**缺点**: 需要修改 `AgentExecutionTask` 的 `messages` 结构，影响 agent executor 对消息的处理。

**步骤**:

1. `PlannerService.generateNextTask()` 构建 task 时，在 `messages` 数组中添加一条 `role: 'system'` 的 JSON-only 指令
2. `AgentExecutorService` 需要正确处理 task 中预置的 system messages（确认已支持）

**预估工作量**: 中

---

## 推荐方案

**方案 A**（Agent Executor 层注入）。理由：
- 改动最小（1 个文件，约 10 行代码）
- 不引入新 agent，不改变现有 Plan 创建流程
- JSON 指令作为 system prompt 的一部分，具有最高 LLM 遵从优先级
- 复用性好——任何需要 JSON 输出的 agent 调用场景都能受益

---

## 执行步骤（方案 A）

### Step 1: Agent Executor 支持 JSON-only 模式

**关键影响点**: Agent Executor / Agent 运行时

- 在 `AgentExecutorService` 的 system prompt 构建环节，检测 `collaborationContext.format`
- 当 `format === 'json'` 时，在最终 system prompt 末尾追加 JSON-only 强制指令
- 指令内容需同时覆盖中英文，避免多语言 LLM 忽略单一语言约束

### Step 2: 保留 Planner Prompt 中的双重保障

**关键影响点**: Planner Service

- 保留 `buildIncrementalPlannerPrompt` 中已添加的 `[SYSTEM OVERRIDE]` 前缀
- 作为 system prompt 注入失败时的 fallback（防御性编程）

### Step 3: 验证测试

**关键影响点**: 端到端验证

- 重启 agents(3002) 服务
- 创建新 Plan（`autoGenerate=true`），观察 planner agent 是否输出 JSON
- 验证 `generateNextTask` 能正确解析返回的 JSON，创建 task 并执行
- 验证完整编排循环：task 生成 → 执行 → 结果验证 → 下一步（或 goalReached）

### Step 4: 异常场景验证

- planner 返回的 JSON 中 `agentId` 无效 → 验证 `executorSelectionService` fallback
- planner 返回 `isGoalReached: true` → 验证编排正确终止
- 执行 task 失败 → 验证重试逻辑和失败上下文传递

---

## 风险与应对

| 风险 | 应对措施 |
|------|---------|
| JSON-only 指令影响非 planning 场景的 agent 行为 | 仅在 `format === 'json'` 时注入，默认不注入 |
| LLM 仍然不遵循（概率性问题） | 保留 planner prompt 层的双重约束 + maxRetries 兜底 |
| 不同 LLM 模型对 system prompt 的遵从度差异 | 后续可针对模型类型调整指令措辞强度 |

---

## 最终实施方案（2026-03-24 确认）

经代码分析，原方案 A 的方向正确但遗漏了一个关键 bug：`collaborationContext` 中未传入 `planId`，
导致 `scenarioType` 被错误判定为 `'chat'` 而非 `'orchestration'`。最终方案在方案 A 基础上增加一处修复。

### 改动 1: 修复 scenarioType 判定 — 补传 planId

**文件**: `backend/src/modules/orchestration/planner.service.ts`

`generateNextTask()` 和 `planByAgent()` 调用 `executeTask()` 时，`collaborationContext` 缺少 `planId`，
导致 `agent-executor.service.ts:1735-1740` 的 scenarioType 判定逻辑落到了 `'chat'`。

修复：在 `collaborationContext` 中补传 `planId`。同时对 batch planning 路径 `planByAgent()` 做同样修复。

### 改动 2: Collaboration Context Builder 注入 JSON-only 约束

**文件**: `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts`

在 orchestration 分支中，检测 `collaborationContext.format === 'json'`，
在 system message **末尾**追加 JSON-only 强制输出指令。

该指令作为 system prompt 的一部分注入，优先级高于 user message 中的 `[SYSTEM OVERRIDE]`，
能有效压制角色 identity prompt 的"初始化问候"行为。

### 改动文件清单

| 文件 | 改动内容 |
|------|---------|
| `planner.service.ts` | `generateNextTask()` 补传 `planId`；`planByAgent()` 不涉及 planId 暂不改 |
| `collaboration-context.builder.ts` | orchestration 分支末尾追加 JSON-only 约束（当 `format=json`） |

---

## 依赖关系

- 前置完成：增量编排引擎实现（已完成）
- 关联文档：
  - `docs/plan/ORCHESTRATION_INCREMENTAL_PLANNING_REFACTOR_PLAN.md`
  - `docs/technical/ORCHESTRATION_INCREMENTAL_PLANNING_TECHNICAL_DESIGN.md`
  - `docs/guide/TEST_GUIDELINE.MD`
