# [已弃用] ORCHESTRATION_INCREMENTAL_PLANNING_REFACTOR_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration 增量计划编排重构方案

## 背景

当前 Orchestration 计划编排采用 **"planner 一次性批量生成全部任务"** 的模式，存在以下严重问题：

1. **生成质量低**：planner 一次生成 3-8 个任务，任务描述空泛、可执行性极低
2. **场景硬编码**：通过 `SceneOptimizationService` 用关键词匹配 + 代码规则做依赖优化（email/code_dev 场景），扩展性差
3. **Executor 分配脱离 AI**：`ExecutorSelectionService` 通过多维评分矩阵自动分配执行者，planner 无法控制任务由谁执行
4. **质量校验依赖代码**：`validateTaskQuality()` 和 `validateAgainstSkillConstraints()` 通过正则/规则校验任务质量，无法适应多变场景
5. **缺乏反馈闭环**：任务生成后没有执行验证环节，无法根据执行结果调整后续任务

## 核心目标

**从"批量生成"改为"逐步生成、逐步执行、逐步验证、按需合并"的增量编排模式。**

### 设计准则

> **不依赖代码来优化智能，通过 prompt 来增强编排能力。**

所有基于关键词匹配的场景识别（email/research/code_dev）、基于规则的依赖优化、基于打分的 executor 路由——全部废弃或降级为 fallback。编排决策完全由 planner agent 通过 prompt 驱动。

## 影响范围

| 层级 | 影响 |
|---|---|
| **backend 编排模块** | `planner.service.ts`（核心重写）、`plan-management.service.ts`（创建流程改造）、新增 `incremental-planning.service.ts` |
| **废弃的服务** | `scene-optimization.service.ts`（整个废弃）、`executor-selection.service.ts`（降为 fallback）、`planning-context.service.ts`（精简） |
| **Schema** | `OrchestrationPlan` 新增增量编排相关字段 |
| **DTO** | `CreatePlanFromPromptDto` 新增 `autoGenerate` 字段 |
| **API** | 新增 `POST /orchestration/plans/:id/generate-next` endpoint |
| **前端** | Plan 创建 UI 新增"创建并生成"选项 |
| **数据库** | 向后兼容，旧 plan 不受影响 |

## 执行步骤

### Step 1: Schema & DTO 扩展

**关键影响点**: 数据库 / API

- `OrchestrationPlan` schema 新增：
  - `generationMode: 'batch' | 'incremental'`（默认 `'incremental'`，旧 plan 为 `'batch'`）
  - `generationConfig: { maxRetries: number, maxCostTokens: number, maxTasks: number }`
  - `generationState: { currentStep: number, totalGenerated: number, totalRetries: number, totalCost: number, isComplete: boolean, lastError?: string }`
- `OrchestrationTask` schema 新增：
  - `mergedFromTaskIds?: string[]`（记录合并来源）
- `CreatePlanFromPromptDto` 新增：
  - `autoGenerate?: boolean`（默认 false；勾选"创建并生成"时为 true）

### Step 2: PlannerService 重构 — 从批量拆解改为增量指令引擎

**关键影响点**: 后端核心逻辑

- 新增 `generateNextTask(planId, context)` 方法：
  - planner agent 根据 plan 目标 + 已完成任务上下文，生成**下一个**最小粒度任务
  - planner 直接在输出中指定 `agentId`（从 agent manifest 中选择）
  - 输出 JSON：`{"task": {"title","description","priority","agentId"}, "isGoalReached": boolean, "reasoning": string}`
- 废弃：
  - `planByAgent()` 批量拆解逻辑
  - `planByHeuristic()` 启发式降级
  - `validateAgainstSkillConstraints()` 代码约束校验
  - 所有 `sceneOptimizationService` 调用

### Step 3: 新增增量编排引擎 — `IncrementalPlanningService`

**关键影响点**: 后端新增服务

- 新建 `services/incremental-planning.service.ts`
- 核心循环 `executeIncrementalPlanning(planId)`:
  1. 构建当前上下文（plan 目标 + 已有任务 + 各任务执行结果）
  2. 调用 `planner.generateNextTask()` → 得到 task 定义 + agentId
  3. 创建 OrchestrationTask，由 planner 指定的 agent 执行
  4. 调用 `executionEngine.executeTaskNode()` 执行
  5. 验证执行结果：
     - 成功 → 尝试与上一步合并 → 继续下一步
     - 失败 → planner 调整上下文重试，重试计数 +1
     - 重试超限 → plan 失败并终止
  6. planner 返回 `isGoalReached: true` → 编排完成
- 任务合并逻辑 `tryMergeWithPreviousTask()`:
  - 条件：同一个 agentId + 标题/描述关键词重叠率 > 阈值
  - 操作：合并 description，保留后一个 result，前一个标记 cancelled，记录 mergedFromTaskIds

### Step 4: PlanManagementService 改造

**关键影响点**: 后端 Plan CRUD

- `createPlanFromPrompt()` 改造：
  - 默认只创建 Plan 文档（status='draft'），**不触发任务生成**
  - `dto.autoGenerate === true` 时，异步启动增量编排
- 废弃 `generatePlanTasksAsync()` 中的批量任务生成管线
- 新增 `startGeneration(planId)` 供 replan 和手动触发使用

### Step 5: 废弃代码清理

**关键影响点**: 后端代码清理

| 文件 | 处理方式 |
|---|---|
| `scene-optimization.service.ts` | 废弃：清空规则引擎，仅保留常量导出（`MAX_TASKS` 等）|
| `executor-selection.service.ts` | 降级：保留作为 fallback（planner 未指定 agentId 时），不再作为主路由 |
| `planning-context.service.ts` | 精简：移除 skill constraint 提取，保留 agent manifest + requirement detail |
| `task-classification.service.ts` | 保留：作为执行引擎辅助（runtime type 判断），不再参与编排决策 |
| `planner.service.ts` | 移除所有 `sceneOptimizationService` 调用和 `validateAgainstSkillConstraints` |

### Step 6: Prompt 能力增强

**关键影响点**: Prompt / AI 能力

增量 planner prompt 注入以下内容（替代原代码逻辑）：
- Agent manifest（可用 agent 列表 + 能力描述 + agentId）
- Plan 目标（sourcePrompt 原文）
- 已完成任务摘要（title + result.output 摘要）
- 上一步失败原因（如果是重试场景）
- 行为约束提示：
  - "每个任务应足够简单、可快速验证"
  - "你必须从 agent manifest 中选择一个 agentId 来执行这个任务"
  - "如果目标已全部达成，设置 isGoalReached: true"

### Step 7: Controller & Module 更新

**关键影响点**: API / 模块注册

- `orchestration.controller.ts`：新增 `POST plans/:id/generate-next`
- `orchestration.module.ts`：注册 `IncrementalPlanningService`
- `orchestration.service.ts`（Facade）：新增 `startGeneration` 委派

## 风险与应对

| 风险 | 应对措施 |
|---|---|
| 成本翻倍（每步调 planner + executor） | `generationConfig.maxCostTokens` 硬限制 |
| planner 无限循环不收敛 | `maxTasks`（默认 15）+ `maxRetries`（默认 3/任务）兜底 |
| 合并策略过于简单导致误合并 | 初期保守（高阈值），后续迭代优化 |
| 旧 plan 兼容 | `generationMode='batch'` 走原流程，增量仅对新 plan 生效 |

## 依赖关系

- 前置完成：Orchestration Service 拆分（已完成 ✅，见 `ORCHESTRATION_SERVICE_SPLIT_PLAN.md`）
- 后续迭代：合并策略优化、前端增量编排进度展示、成本统计面板
