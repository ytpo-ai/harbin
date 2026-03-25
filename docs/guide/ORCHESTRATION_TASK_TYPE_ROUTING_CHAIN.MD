# Orchestration TaskType 路由链路完整分析

> 状态：当前有效（2026-03-25）
>
> 目的：记录 `taskType`（`runtimeTaskType`）从定义、生成、持久化到最终影响执行引擎路由的完整链路，供后续扩展新 taskType 值时评估影响范围。

---

## 1. 概述

编排系统中，每个任务（OrchestrationTask）携带一个 `runtimeTaskType` 字段，该字段决定了：

1. 编排层传给 agent 的 `runtimeChannelHint`（`native` 或 `opencode`）
2. agent 侧最终选择的执行引擎（native 引擎 或 opencode 引擎）
3. 任务执行后的验证逻辑（research/review/code 各有专属验证器）
4. 执行者选择时的角色兼容性判定

当前合法值：`'external_action' | 'research' | 'review' | 'development' | 'general'`

---

## 2. 完整路由链路图

```
                          ┌──────────────────────────────────────────┐
                          │         Planner（LLM 输出）               │
                          │  GenerateNextTaskResult.task.taskType     │
                          └──────────────┬───────────────────────────┘
                                         │
                        ┌────────────────▼────────────────────────────┐
                        │  incremental-planning.service.ts:366        │
                        │  runtimeTaskType =                          │
                        │    taskResult.taskType                      │
                        │    || 'general'                             │
                        └────────────────┬────────────────────────────┘
                                         │ 持久化到 task.runtimeTaskType
                        ┌────────────────▼────────────────────────────┐
                        │  orchestration-execution-engine.service.ts   │
                        │  executeTaskNode() 第 73-80 行              │
                        │  runtimeTaskType =                          │
                        │    options.runtimeTaskTypeOverride  (P1)     │
                        │    || task.runtimeTaskType          (P2)     │
                        │    || resolveAgentRuntimeTaskType() (P3)     │
                        └────────────────┬────────────────────────────┘
                                         │
                   ┌─────────────────────▼─────────────────────────────┐
                   │  resolveRuntimeChannelHint(runtimeTaskType, desc)  │
                   │  → 'native' | 'opencode'                          │
                   └─────────────────────┬─────────────────────────────┘
                                         │ sessionContext.runtimeChannelHint
                   ┌─────────────────────▼─────────────────────────────┐
                   │  agent-executor.service.ts                         │
                   │  resolvePreferredExecutionChannel()                │
                   │  → 作为最高优先级 channel 偏好                      │
                   │                                                    │
                   │  resolveExecutionRoute() 完整优先级：               │
                   │  1. agent.config.execution.provider != opencode    │
                   │     → 直接 native（无论 hint 是什么）              │
                   │  2. preferredChannel（来自 runtimeChannelHint）    │
                   │  3. config.taskRouting 规则                        │
                   │  4. DEFAULT_OPENCODE_TASK_TYPES 白名单             │
                   └───────────────────────────────────────────────────┘
```

---

## 3. taskType 影响的所有代码位置（23 处，17 个文件）

### 3.1 类型定义与验证（必改，否则新值被静默丢弃）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 1 | `backend/src/shared/schemas/orchestration-task.schema.ts` | 16-21, 55 | `OrchestrationTaskRuntimeType` 联合类型 + Mongoose enum |
| 2 | `backend/src/shared/schemas/orchestration-run-task.schema.ts` | 50 | Mongoose enum（导入同一类型） |
| 3 | `backend/src/modules/orchestration/dto/index.ts` | 176, 279 | `runtimeTaskType` 相关 `@IsEnum` 装饰器 + 类型联合 |
| 4 | `backend/src/modules/orchestration/services/orchestration-context.service.ts` | 341-358 | `normalizeRuntimeTaskTypeOverride` 硬编码白名单 |
| 5 | `backend/src/modules/orchestration/planner.service.ts` | 441-447 | `normalizeTaskType` 硬编码白名单 |
| 6 | `backend/src/modules/orchestration/planner.service.ts` | 55-69 | `GenerateNextTaskResult.task.taskType` 类型定义 |

**关键**：`normalizeRuntimeTaskTypeOverride`（#5）和 `normalizeTaskType`（#6）中有硬编码白名单。新值不加入这两处，planner 输出或手动设置的新 taskType 会被**静默丢弃为 null/undefined**，最终 fallback 到关键词自动分类。

### 3.2 路由与引擎选择（必改，否则新值无法路由到 opencode）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 8 | `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | 1028-1045 | `resolveRuntimeChannelHint`：只有 `development` 可走 opencode |
| 9 | `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | 81-83, 535-537 | `effectiveIsExternalAction/Research/Review` 等值判断 |
| 10 | `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | 71-85 | `DEFAULT_OPENCODE_TASK_TYPES` 白名单（agent 侧 fallback） |

### 3.3 执行者选择与兼容性判定（应改，否则新值降级为 general）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 11 | `backend/src/modules/orchestration/services/incremental-planning.service.ts` | 581-594 | `mapRuntimeTaskTypeToExecutorTaskType`：新值 fallback 到 `general` |
| 12 | `backend/src/modules/orchestration/services/executor-selection.service.ts` | 593-606 | `normalizeExternalTaskType`：同上逻辑 |
| 13 | `backend/src/modules/orchestration/services/executor-selection.service.ts` | 61-74 | `TIER_TASK_COMPATIBILITY` 和 `TASK_TOOL_HINTS` 映射表 |
| 14 | `backend/src/modules/orchestration/services/executor-selection.service.ts` | 141 | `validateAgentToolFit` 输入类型 |

### 3.4 分类与自动检测（如需自动分类则改）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 15 | `backend/src/modules/orchestration/services/orchestration-context.service.ts` | 248-270 | `resolveAgentRuntimeTaskType` 自动分类 |
| 16 | `backend/src/modules/orchestration/services/task-classification.service.ts` | 89-99 | `isCodeTask` 关键词匹配 |
| 17 | `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | 530-550 | agent 侧 taskType heuristic |

### 3.5 Planner Prompt 模板（必改，否则 LLM 不会生成新值）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 18 | `backend/src/modules/orchestration/planner.service.ts` | 310-311, 388 | prompt 中 taskType 可选值列表和说明 |

### 3.6 前端（应改，否则 UI 不展示新值）

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 19 | `frontend/src/services/orchestrationService.ts` | 4 | `DebugRuntimeTaskTypeOverride` 类型 |
| 20 | `frontend/src/components/orchestration/constants.ts` | 62-69, 71-77 | `DEBUG_RUNTIME_TYPE_OPTIONS` 下拉 + `TASK_RUNTIME_TYPE_LABEL` 标签 |
| 21 | `frontend/src/pages/Orchestration.tsx` | 80-95 | 重复的下拉选项和标签映射 |

### 3.7 测试文件

| # | 文件 | 行号 | 说明 |
|---|------|------|------|
| 22 | `backend/test/orchestration/incremental-planning.redesign-taskid.spec.ts` | 41, 58 | 测试用例中的 taskType 值 |
| 23 | `backend/test/orchestration/planner.incremental-redesign.spec.ts` | 40, 54 | 测试用例中的 taskType 值 |

---

## 4. 新增 taskType 值的评估结论

### 4.1 曾考虑的方案：扩展为 `development_plan` / `development_exec` / `development_review`

**结论：不推荐。**

改动代价：**17 个文件、23 处代码**。

| 层 | 文件数 | 改动点 |
|---|---|---|
| Schema/DTO（类型定义+Mongoose枚举+DTO验证） | 4 | 9 处 |
| 编排核心服务（路由、分类、规范化、执行器选择） | 6 | 8 处 |
| Planner（prompt模板+响应解析+类型定义） | 1 | 4 处 |
| Agent 执行层（DEFAULT_OPENCODE_TASK_TYPES + worker） | 2 | 2 处 |
| 前端（类型+下拉选项+标签映射） | 3 | 4 处 |
| 测试 | 2 | 2 处 |

核心风险：

1. `normalizeRuntimeTaskTypeOverride` 和 `normalizeTaskType` 有硬编码白名单，新值不加入会被**静默丢弃**为 null
2. `mapRuntimeTaskTypeToExecutorTaskType` 和 `normalizeExternalTaskType` 不认识新值，降级为 `general`，导致执行者选择错误
3. `effectiveIsReviewTask = runtimeTaskType === 'review'` 的等值判断不会匹配 `development_review`，review 验证逻辑被跳过
4. `DEFAULT_OPENCODE_TASK_TYPES` 不含新值，agent 侧 fallback 路由到 native

### 4.2 推荐方案：复用现有 `development` + `review` + 微调 1 处代码

用现有 `development`（step2方案+step3开发）+ `review`（step4评估），加上 `resolveRuntimeChannelHint` 一处微调（让 review 也可走 opencode），总改动 **1 个文件 1 个方法（~10行）**。

详见 `docs/plan/ORCHESTRATION_OPENCODE_ROUTING_FOR_DEV_WORKFLOW_PLAN.md`。

---

## 5. 备注：系统中已有的非标准 taskType 用法

`inner-message-agent-runtime-bridge.service.ts:65` 使用了 `runtimeTaskType: 'internal_message'`——这个值不在标准 enum 中，但因为它只在 agent 内部上下文中传递，不经过编排层的 `normalizeRuntimeTaskTypeOverride` 验证，所以能正常工作。这说明 agent 侧的 `resolveExecutionTaskType` 是宽松的（接受任意字符串），但编排层是严格的（有硬编码白名单）。
