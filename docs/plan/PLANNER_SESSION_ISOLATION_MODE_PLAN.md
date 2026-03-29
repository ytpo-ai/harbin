# Planner Session 隔离模式 Plan

> 创建时间: 2026-03-30
> 状态: 已开发（2026-03-30）

## 背景与问题

当前 Planner 的四个阶段（`initialize` / `generating` / `pre_execute` / `post_execute`）共用一个 `plannerSessionId`（格式 `plan-${planId}-${agentId}-run-planner`），存储在 `plan.generationState.plannerSessionId` 中。

整个 plan 生命周期内所有对话都追加到同一个 agent session，导致：

1. **上下文累积过长** — 多轮 generate + pre + post 对话叠加，token 消耗快速增长，影响 LLM 推理质量
2. **阶段职责混淆** — pre_execute 的决策被 post_execute 的历史干扰，反之亦然
3. **调试困难** — 无法区分哪个阶段产生了哪些对话记录

## 目标

- 引入 `isolated` 模式：不同阶段使用独立 session，session ID 中包含 task type/phase 标识
- 保留 `shared` 模式：原有逻辑完全不变，作为默认行为
- 通过环境变量 `PLANNER_SESSION_ISOLATION_MODE` 切换，无需改代码即可回退

## 涉及文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/.env.example` | 新增配置 | 新增 `PLANNER_SESSION_ISOLATION_MODE` |
| `backend/src/shared/schemas/orchestration-plan.schema.ts` | Schema 扩展 | `OrchestrationGenerationState` 新增 `plannerSessionIds` 字段 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | 核心改造 | `ensurePlannerSession` / `advanceOnce` / `archivePlannerSessionIfNeeded` / `stopGeneration` |

## 执行步骤

### 步骤 1: 新增环境变量

- **文件**: `backend/.env.example`
- **内容**: 新增 `PLANNER_SESSION_ISOLATION_MODE=shared`，注释说明可选值 `shared | isolated`
- **影响**: 配置层

### 步骤 2: 扩展 OrchestrationGenerationState 数据模型

- **文件**: `backend/src/shared/schemas/orchestration-plan.schema.ts`
- **改动**:
  - `OrchestrationGenerationState` 接口新增可选字段:
    ```typescript
    plannerSessionIds?: Record<string, string>;
    ```
    key 为 phase 名称（`initialize` / `generating` / `pre_execute` / `post_execute`），value 为该阶段对应的 session ID
  - Mongoose raw schema 同步新增 `plannerSessionIds: { type: Object }`
- **兼容性**: 新字段可选，已有数据无需迁移；`shared` 模式下该字段始终为 undefined

### 步骤 3: 改造 ensurePlannerSession() — 核心分叉

- **文件**: `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- **改动**:
  - 注入 `ConfigService`，读取 `PLANNER_SESSION_ISOLATION_MODE`
  - 新增私有属性 `get isIsolatedSessionMode(): boolean`
  - 修改 `ensurePlannerSession()` 签名，增加 `phase: Phase` 参数
  - `shared` 模式: 保持原逻辑完全不变
  - `isolated` 模式:
    - 从 `state.plannerSessionIds?.[phase]` 读取已有 session ID
    - 若不存在，调用 `agentClientService.getOrCreatePlanSession()` 时使用 `orchestrationRunId: \`planner-${phase}\``，生成的 session ID 格式为 `plan-${planId}-${agentId}-run-planner-${phase}`
    - 将新 session ID 写入 `state.plannerSessionIds[phase]`

### 步骤 4: 改造 advanceOnce() 中的 session 传递

- **文件**: `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- **改动**:
  - 在 `advanceOnce()` 中调用 `ensurePlannerSession()` 时传入目标 phase
  - `shared` 模式: 行为不变，所有 phase 拿到同一个 session ID
  - `isolated` 模式: 根据即将执行的 phase 获取/创建对应的独立 session ID
  - 各 `phaseXxx()` 方法接收到的 `plannerSessionId` 在 `isolated` 模式下为该阶段专属

### 步骤 5: 改造 archivePlannerSessionIfNeeded()

- **文件**: `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- **改动**:
  - `shared` 模式: 归档 `state.plannerSessionId`（不变）
  - `isolated` 模式: 遍历 `state.plannerSessionIds` 所有值，逐一归档

### 步骤 6: 改造 stopGeneration()

- **文件**: `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- **改动**:
  - `shared` 模式: 清理 `plannerSessionId`（不变）
  - `isolated` 模式: 清理 `plannerSessionIds` 中所有 session，全部归档

### 步骤 7: 改造 resolveGenerationState()

- **文件**: `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts`
- **改动**: 在 state 解析中增加 `plannerSessionIds` 字段的透传

## 关键设计决策

### Session ID 命名规则（isolated 模式）

| Phase | orchestrationRunId | Session ID 格式 |
|-------|-------------------|-----------------|
| initialize | `planner-initialize` | `plan-${planId}-${agentId}-run-planner-initialize` |
| generating | `planner-generating` | `plan-${planId}-${agentId}-run-planner-generating` |
| pre_execute | `planner-pre_execute` | `plan-${planId}-${agentId}-run-planner-pre_execute` |
| post_execute | `planner-post_execute` | `plan-${planId}-${agentId}-run-planner-post_execute` |

### 兼容性保证

- 默认值 `shared` 确保不配置时行为完全不变
- `plannerSessionId` 字段保留，`shared` 模式继续使用
- `plannerSessionIds` 为可选字段，不影响已有数据
- `getOrCreatePlanSession()` 底层通过 `orchestrationRunId` 做隔离，无需修改 agents 侧代码

### 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| isolated 模式下阶段间缺少对话上下文 | 中 | 每个阶段通过 prompt 注入必要上下文（当前已有此机制） |
| 数据库多出 session 记录 | 低 | 最多 4x session 数，plan 完成后统一 archive |
| 环境变量配错导致运行时异常 | 低 | 不识别的值 fallback 到 `shared` |
