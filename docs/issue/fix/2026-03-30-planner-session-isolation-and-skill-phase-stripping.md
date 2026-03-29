# Planner Session 隔离 + Skill phaseInitialize 裁剪 + 纯文本 Retry

> 日期: 2026-03-30
> Commit: f56c325
> 关联 Plan: docs/plan/PLANNER_SESSION_ISOLATION_MODE_PLAN.md
> 关联 Issue: docs/issue/PLAN_OPTIMAZE.md (#7 计划编排-fix9)

## 问题现象

1. **Session 共用导致上下文污染**: Planner 的 initialize / generating / pre_execute / post_execute 四个阶段共用一个 agent session，历史对话相互干扰。例如 initialize 阶段的"需求池为空"结论被 generating 阶段 planner 看到后直接复用，导致 generating 也返回空结果。
2. **Skill phaseInitialize 指令污染非 initialize 阶段**: `rd-workflow` skill 的 `phaseInitialize 行为` 段落通过 system messages 注入到所有 planner 阶段。generating / pre_execute / post_execute 阶段的 planner 被 skill 中的 `requirement.list` / `requirement.get` 等工具调用指令误导，执行了 phaseInitialize 流程而非当前阶段的职责。
3. **Planner 输出确认性文本**: LLM 在收到大量 skill/约束说明后，首轮输出"已收到约束..."等确认性文本而非 `<tool_call>`，导致 planner response 解析失败。

## 根因分析

### 问题 1: Session 共用
- `ensurePlannerSession()` 使用统一的 `orchestrationRunId: 'planner'`，所有阶段复用同一个 agent session
- `phaseInitialize` 和 `phaseGenerate` 方法中硬编码 `plannerSessionId` 赋值，isolated 模式下 session ID 写入了错误字段

### 问题 2: Skill 污染
- `ToolsetContextBuilder` 将完整的 skill 文档注入 system messages，包含 phaseInitialize 的工具调用序列
- System prompt 的优先级高于 user prompt 中的阶段隔离声明，LLM 优先执行 system 层级的 skill 指令

### 问题 3: 确认性文本
- 3 个 skill 全量注入 + agent baseline + identity + tool specs 形成过长的 system context
- LLM 被触发"先确认理解再行动"模式，输出确认文本而非 tool_call

## 修复方案

### 1. Session 隔离模式（可配置）

**环境变量**: `PLANNER_SESSION_ISOLATION_MODE=shared|isolated`（默认 shared）

**文件**: `orchestration-step-dispatcher.service.ts`
- `ensurePlannerSession()`: isolated 模式下按 phase 生成独立 session ID（`planner-initialize` / `planner-generating` / `planner-pre_execute` / `planner-post_execute`）
- `withPlannerSession()`: 统一的 session state 写入辅助方法
- `resolvePlannerSessionIds()`: 统一的 session ID 读取辅助方法
- `phaseInitialize()` / `phaseGenerate()`: 修复硬编码 `plannerSessionId` 为 `withPlannerSession()` 调用

**文件**: `orchestration-plan.schema.ts`
- `OrchestrationGenerationState` 新增 `plannerSessionIds?: Record<string, string>` 字段

### 2. Skill phaseInitialize 段落裁剪

**文件**: `toolset-context.builder.ts`
- 新增 `stripPhaseInitializeSectionIfNeeded()` 方法
- 当 `collaborationContext.roleInPlan` 以 `planner` 开头时，用正则替换 `## phaseInitialize 行为` 段落为占位说明
- 原因：initialize 阶段有独立的 `buildPhaseInitializePrompt` 提供工具指令；其他阶段不需要 phaseInitialize 指令

### 3. Prompt 阶段隔离声明

**文件**: `planner.service.ts`
- `buildIncrementalPlannerPrompt`（generating）: 最前面注入阶段隔离声明，明确禁止 phaseInitialize 指令，限定允许的工具范围
- `buildPhaseInitializePrompt`（initialize）: 注入反确认约束（"第一条回复必须是 tool_call"）

**文件**: `orchestration-context.service.ts`
- `buildPreTaskContext`（pre_execute）: 注入阶段隔离声明
- `buildPostTaskContext`（post_execute）: 注入阶段隔离声明

### 4. Planner 纯文本 Retry

**文件**: `agent-executor.service.ts`
- 新增 `isPlannerTextOnlyRetryNeeded()` 方法：当 `roleInPlan` 以 `planner` 开头且 LLM 输出纯文本（无 `<tool_call>`）时返回 true
- 在 `executeWithToolCalling()` 的非 tool_call 分支中，afterStepHooks 之后、会议场景检测之前，加入 planner 专属 retry 逻辑
- 仅 retry 一次（`plannerTextOnlyRetryUsed` 标志），注入系统纠正消息要求输出 `<tool_call>`

## 验证结果

| 场景 | 结果 |
|------|------|
| Session 隔离 | 各阶段独立 session，`plannerSessionIds` 正确存储 |
| Generating 阶段 | planner 正确调用 `submit-task` 生成任务（totalGenerated=1, consecutiveFailures=0） |
| Skill 裁剪 | system prompt 中 phaseInitialize 段落被替换为占位说明 |
| 纯文本 Retry | `[planner_text_only_retry]` 正确触发，retry 后 planner 尝试调用 tool_call |

## 待跟进

1. **Initialize 阶段 LLM 行为不稳定**: retry 后 planner 在 initialize 阶段调用了 `submit-task`（应调用 `requirement.list`），混淆了 initialize 和 generating 的职责。需要进一步约束 initialize 阶段的可用工具范围或 prompt 设计。
2. **非 development 域验证**: general/research 域计划的 phaseInitialize 行为是否受影响。

## 涉及文件

| 文件 | 改动类型 |
|------|---------|
| `backend/src/shared/schemas/orchestration-plan.schema.ts` | Schema 注释 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | Session 写入修复 |
| `backend/src/modules/orchestration/planner.service.ts` | Prompt 阶段隔离声明 |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | Pre/post prompt 阶段隔离声明 |
| `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | Skill 裁剪 |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | Planner 纯文本 retry |
