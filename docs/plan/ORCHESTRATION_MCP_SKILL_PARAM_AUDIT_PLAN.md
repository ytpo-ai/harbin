# [已弃用] ORCHESTRATION_MCP_SKILL_PARAM_AUDIT_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Orchestration MCP Skill Param Audit Plan

## Goal
核对系统内计划编排 MCP 的真实参数契约，校验当前 skill 中参数是否可靠，并基于真实契约重写可执行 prompt。

## Scope
- Backend Orchestration MCP（ToolService 工具定义 + 执行校验）
- Skill 文案（`docs/meeting-sensitive-skill.md`）
- API/Feature 文档一致性检查

## Steps
1. 提取编排 MCP 工具的权威参数定义（create/update/run/get/list/reassign/complete-human/create-schedule/update-schedule/debug-task）。
2. 对照 skill 中“计划模型/JSON 模板/流程描述”逐项校验字段名、必填项、类型与约束。
3. 标记不可靠参数与风险（会议上下文依赖、`confirm=true`、字段映射偏差）。
4. 生成可靠参数清单（按工具输出必填/可选/约束/示例）。
5. 重写 skill prompt，使其严格按系统 MCP 契约调用，并补充失败回退与澄清策略。

## Impacts
- `docs/meeting-sensitive-skill.md`
- `docs/api/agents-api.md`（仅在发现不一致时建议修订）

## Risks/Dependencies
- 历史文档可能与当前代码实现存在漂移。
- Skill 当前模板偏业务语义，需映射为 MCP 可执行参数，避免“看似合理但不可调用”。
