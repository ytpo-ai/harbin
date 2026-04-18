# Plan: ORCHESTRATION_EASY_RUN_MODE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [编排引擎](../feature/ORCHESTRATION.md) |
| 需求管理 ID | - |
| 所属项目 | - |
| OpenCode Session | - |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-15 |

## 2. 背景

当前编排引擎的所有 plan（general / development / research）都走同一条标准流水线：

```
idle → initialize → generating → pre_execute → executing → post_execute → ...
```

这个流程假设所有任务都需要 planner 拆步骤、分配 executor 执行。但实际存在一类轻量任务——planner 自己拥有所需工具，一轮 LLM 调用就能完成所有工作，不需要生成 outline，也不需要 executor。

典型场景：`rd-plan-requirement-extract` skill（从 plan 文档提取 requirement 入库 EI 系统）。该 skill 强制要求 `phase:initialize:must`，在标准流程中空 outline 会导致 plan 进入失败重试循环，最终 status=failed。

### 核心问题

- 标准流程唯一的成功出口要求有效 outline + 至少一个 task，轻量任务无法干净结束
- 空 outline 触发 `hasValidOutlineWithPrompts` 校验失败，plan 进入 retry → failAndArchive
- Skill 内容仅在匹配 phase 时注入，post_execute 等阶段无法激活 initialize-only 的 skill

## 3. 目标

为 plan 新增 `easy` 执行模式（`executionMode: 'easy'`）：
- Planner 直接在单轮 LLM 调用中使用工具完成所有工作
- 不生成 outline，不创建 task，不经过 generating → executing 循环
- 执行结果写入 `metadata.easyRunResult`，plan 干净完成（status=completed）
- 前端根据 executionMode 切换展示模式（easy: 摘要视图；standard: 任务列表）

## 4. 执行步骤

1. [x] Schema 改动：`orchestration-plan.schema.ts` 中 strategy 新增 `executionMode` 字段，`currentPhase` 枚举新增 `easy_run`
2. [x] DTO 改动：`CreatePlanFromPromptDto` 新增 `executionMode` 可选字段
3. [x] Plan 创建适配：`plan-management.service.ts` 的 `createPlanFromPrompt` 透传 `executionMode` 到 strategy
4. [x] Dispatcher 改动：`orchestration-step-dispatcher.service.ts` 的 `advanceOnce` idle 分支识别 easy 模式，新增 `phaseEasyRun()` 方法
5. [x] PlannerService 改动：`planner.service.ts` 新增 `executeEasyRun()` 方法
6. [x] Prompt 改动：`orchestration-prompt-catalog.ts` 新增 `EASY_RUN_PROMPT`；`orchestration-context.service.ts` 新增 `buildEasyRunPrompt()`
7. [x] Skill 适配：`rd-plan-requirement-extract.md` activation tag 增加 `easy_run` phase 支持

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | 后端 easy 模式全链路实现（Schema + DTO + Dispatcher + PlannerService + Prompt） | - | draft |
| REQ-002 | Skill 适配：rd-plan-requirement-extract 支持 easy_run phase | - | draft |

## 6. 关键影响点

- **后端**：orchestration-plan.schema / dto / step-dispatcher / planner.service / prompt-catalog / context-service
- **前端**：plan 详情页需根据 executionMode 切换展示模式（后续 plan 处理）
- **数据库**：orchestration_plans 集合 strategy 子文档新增 executionMode 字段
- **API**：POST /plans（创建）新增 executionMode 参数
- **文档**：rd-plan-requirement-extract skill 文档更新

## 7. 风险与依赖

- **向后兼容**：executionMode 默认 undefined，等同 standard，所有现有 plan 不受影响
- **前端展示**：easy 模式 plan 没有 task 列表，前端暂时可只展示 plan 基本信息 + metadata.easyRunResult
- **Skill 激活**：easy_run phase 需要在 context-strategy.service.ts 的 tag 匹配中正确识别（现有逻辑已支持多值匹配，无需改代码）

## 8. 技术设计

### 8.1 Easy 模式流程

```
plan 创建（executionMode='easy'）
  → startGeneration
    → advanceOnce
      → idle: 检测 executionMode === 'easy'
        → phaseEasyRun（跳过 initialize + generating + executing）
          → 创建 planner session（phase='easy_run'）
          → 构建 easyRun prompt（注入 skill 内容 + sourcePrompt）
          → planner 在单轮 LLM 调用中用工具完成所有工作
          → 将执行结果写入 metadata.easyRunResult
          → completeAndArchive()
```

### 8.2 对比标准模式

| 维度 | standard | easy |
|------|----------|------|
| 流程 | initialize → generating → pre_execute → executing → post_execute → ... | easyRun（单轮） |
| 产出 | outline + N 个 task | metadata.easyRunResult（执行摘要） |
| 执行者 | planner 调度 + executor 执行 | planner 自己用工具完成 |
| LLM 调用 | 多轮（每个 phase 至少一轮） | 一轮 |
| 前端展示 | 任务列表 | 执行摘要 |

### 8.3 easyRunResult 数据结构

```typescript
metadata.easyRunResult = {
  summary: string;       // planner 输出的执行摘要文本
  completedAt: string;   // ISO 时间戳
}
```

### 8.4 Prompt 设计

```
## 你正在执行 easyRun 模式

本次计划为轻量任务，由你（Planner）直接使用工具完成所有工作。
不需要生成大纲、不需要分配任务给其他 agent。

### 执行要求
1. 阅读已激活 skill 中的执行步骤定义
2. 按 skill 定义的步骤序列，逐步调用工具完成工作
3. 所有工具调用完成后，输出执行结果摘要

### 输入
- planId: {{planId}}
- domainType: {{domainType}}
- sourcePrompt: {{sourcePrompt}}
```

### 8.5 CollaborationContext

```typescript
CollaborationContextFactory.orchestration({
  planId,
  roleInPlan: 'planner_easy_run',
  domainType,
  phase: 'easy_run',
  taskType: 'planning',
  ...(skillActivation ? { skillActivation } : {}),
})
```
