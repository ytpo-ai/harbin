# ORCHESTRATION POST EXECUTE OUTPUT VALIDATION SKILL PLAN

## 背景

- 当前 `TaskOutputValidationService` 在执行阶段承担了大量任务类型相关输出检测（general/research/review/development），逻辑分散且维护成本高。
- 近期编排链路已收敛为四阶段调度，任务类型判断前置到 planner/pre_execute，具备将“输出语义判定”统一迁移到 `phasePostExecute` 的条件。
- 目标是把“规则”以 skill 形式提供给 planner，在 post 阶段由 planner 基于 skill 统一验证并决策。

## 目标

- 将任务类型相关输出检测从执行引擎迁移到 planner `phasePostExecute`。
- 将输出检测规则沉淀为可复用的“Planner Post-Execute Validation Skill”。
- `TaskOutputValidationService` 收敛为最小通用能力，减少复杂分支。
- 保持现有状态机决策（`generate_next|retry|redesign|stop`）与 `development.*` 自动重试限制兼容。

## 执行步骤

1. 梳理并拆分现有检测逻辑：区分执行期最小校验与任务语义校验，语义校验迁移目标明确为 post 阶段。
2. 新增 skill 规则资产：定义按 `runtimeTaskType` 的输出验收规则、失败信号、期望证据与决策建议。
3. 扩展 post 上下文构建：`buildPostTaskContext()` 注入 runtimeTaskType、执行结果及 skill 规则，强化 JSON-only 输出约束。
4. 扩展 planner post 决策契约：在 `executePostTask()` 支持 `validation` 结构化字段（如 passed/verdict/missing/ruleVersion）。
5. 精简执行引擎检测：移除 research/review/development 等任务类型特定检测，仅保留最小执行兜底（如空输出异常）。
6. 调整 dispatcher 后处理：消费 planner+skill 决策，保留 `development.*` retry -> redesign 的兼容降级。
7. 更新测试与文档：同步单测、链路测试及 `docs/guide`/`docs/technical` 的实现说明。

## 关键影响点

- 后端：`planner.service.ts`、`orchestration-context.service.ts`、`orchestration-step-dispatcher.service.ts`、`orchestration-execution-engine.service.ts`
- 规则资产：新增 orchestration planner post-execute skill 文件
- 测试：`backend/test/orchestration/*`（重点 post_execute 与 output validation）
- 文档：`docs/guide`、`docs/technical`

## 风险与依赖

- planner 输出结构不稳定会导致 post 阶段决策抖动，需要严格 schema 与 fallback。
- 规则迁移后执行阶段“立即失败”行为减少，需确认业务可接受“先完成执行、后在 post 阶段纠偏”的语义。
- skill 规则迭代需版本化，避免后续升级引发不可追踪行为变化。
