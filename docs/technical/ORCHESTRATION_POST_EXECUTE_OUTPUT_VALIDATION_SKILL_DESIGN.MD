# ORCHESTRATION POST EXECUTE OUTPUT VALIDATION SKILL DESIGN

## 目标

将任务输出语义验证从执行引擎迁移到 planner 的 `phasePostExecute`，并通过 skill 规则驱动统一决策。

## 设计范围

- 输出验证规则定义
- post 上下文协议扩展
- planner post 输出契约扩展
- 执行引擎逻辑收敛

## Skill 规则资产

### 1) 仓库技能文档

- 路径：`docs/skill/orchestration-runtime-task-out-validation.md`
- 用途：作为规则文档与演进基线，沉淀可读版 skill。

### 2) 运行时注入内容

- 来源：`buildPostTaskContext()` 中的 skill 激活指令
- 用途：在 post 阶段 prompt 中显式激活 skill，并结合执行结果做判定。

## Post Context 协议

`buildPostTaskContext` 输入新增：

- `runtimeTaskType`

注入内容新增：

- Validation skill 文本（包含 global + type-specific 规则）
- 强制 JSON schema（含 `validation` 字段）

## Planner Post 输出契约

`PostExecutionDecision` 新增：

```ts
validation?: {
  passed: boolean;
  verdict?: 'pass' | 'needs_fix' | 'blocked';
  missing?: string[];
  ruleVersion?: string;
}
```

解析策略：

- `validation` 非对象或 `passed` 非布尔值时，按 `undefined` 忽略。
- `verdict` 白名单化：`pass | needs_fix | blocked`。

## 执行引擎改造

`OrchestrationExecutionEngineService` 中移除：

- research/review/development 的任务类型输出检测分支
- code proof strict/warn 双模分支

保留：

- 执行结果空输出异常（`succeeded` 但无输出）
- 执行状态写入、事件推送、异常失败处理

## Scene Optimization 收口

- 场景优化能力统一由 `SceneOptimizationService` 管理，执行阶段按上下文匹配触发。
- `phasePostExecute` 调用统一入口 `applyPostExecuteOptimizations(context)`，context 至少包含：
  - `planDomainType`
  - `runtimeTaskType`
  - `taskStatus`
  - `taskOutput`
- requirementId 回填规则已从 `IncrementalPlanningService` 移出，作为 `development-plan-requirement-id-backfill` 规则放入 scene optimization。

## 兼容策略

- dispatcher 中 `development.*` 自动重试限制保持不变：`retry -> redesign`。
- planner post 解析失败仍按既有逻辑降级 `stop`，避免决策失控。
- requirementId 回填能力仅作为研发规划场景优化，已放在 `phasePostExecute`（`development.plan` 且任务 completed）执行，不再放在 `IncrementalPlanningService`。

## 测试策略

- 更新 `task-output-validation.service.spec.ts`：
  - 覆盖最小通用校验
  - 覆盖 skill 文本构建
- 保持 `orchestration-step-dispatcher.service.spec.ts` 对 post 阶段决策的行为覆盖。
