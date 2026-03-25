# [已弃用] ORCHESTRATION_CREATE_PLAN_400_DIAGNOSTICS_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration Create-Plan 400 诊断优化计划

## 背景

- 会议场景下调用 `builtin.sys-mg.mcp.orchestration.create-plan` 时出现 `Request failed with status code 400`，错误信息不够直观，排障成本高。
- 已确认后端 `CreatePlanFromPromptDto` 对 `prompt` 有 `MaxLength(4000)` 约束，超长输入是高概率触发条件。

## 执行步骤

1. 在 `apps/agents` 的工具层为 `orchestration_create_plan` 增加前置参数校验，明确提示长度上限与当前长度。
2. 在 Orchestration API 调用封装中补充 Axios 失败日志，记录状态码、接口路径与响应体关键信息。
3. 保持对外工具参数契约不变，避免影响现有 Agent 的工具调用行为。
4. 进行最小化验证，确保错误场景返回可读信息且不引入编译错误。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/tools/tool.service.ts`。
- API 交互：`/orchestration/plans/from-prompt` 的调用前校验与失败日志。
- 运维排障：日志可观测性提升（定位 400 的具体原因）。

## 风险与依赖

- 风险：新增本地校验后，部分此前“透传到后端再失败”的请求会在工具层提前失败（属于预期行为变化）。
- 依赖：Orchestration 后端 DTO 约束（当前为 `prompt <= 4000`）保持不变。

## 执行结果

- [x] 已在工具层增加 `prompt/title/mode` 前置校验，避免无效请求直达 Orchestration API。
- [x] 已在 Orchestration API 封装中增加 Axios 失败日志（状态码 + 响应体摘要）。
- [x] 已执行 `npm run build:agents`，编译通过。

## 开发沉淀

- 开发总结：`docs/development/ORCHESTRATION_CREATE_PLAN_400_DIAGNOSTICS_PLAN.md`
