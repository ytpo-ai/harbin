# [已弃用] ORCHESTRATION_TASK_DEBUG_MCP_PLAN

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# 计划编排任务调试 MCP 能力实施计划

## 1. 需求目标

- 在系统中新增面向计划编排任务的调试 MCP 能力。
- 支持 Agent 主动调试单个任务，而非仅依赖页面或人工 API 调用。
- 返回结构化调试结果，便于 Agent 自动继续处理（重试、改写草稿、转人工）。

## 2. 实施步骤

1. 梳理现有编排任务调试链路，确认 `/orchestration/tasks/:id/debug-run` 的输入输出契约与可复用逻辑。
2. 定义并注册 MCP 工具（建议：`orchestration_debug_task`），明确参数 schema 与失败场景约束。
3. 在 Agent 工具执行链路接入该工具，将请求路由到 Orchestration 调试执行能力。
4. 标准化调试返回结构，至少包含状态、关键日志、错误原因与下一步建议字段。
5. 将工具纳入 MCP Profile/工具白名单治理，确保仅授权 Agent 可见与可执行。
6. 增加或更新测试用例，覆盖工具注册、参数校验、成功执行、失败执行与权限限制。
7. 更新功能文档与 API 文档，补充任务调试 MCP 的能力说明和使用示例。

## 3. 关键影响点

- 后端 API：Orchestration 任务调试接口与返回模型
- 后端 Agent Runtime：MCP 工具注册、调用编排、错误透传
- 治理模块：MCP Profile 白名单与工具权限控制
- 测试：Agent 工具执行与 Orchestration 调试链路回归
- 文档：feature / api 文档同步

## 4. 风险与依赖

- 若现有 debug-run 返回信息不足，需扩展返回模型，可能影响前端现有展示。
- 若白名单配置未放行，工具虽注册成功但实际调用会被拦截。
- 调试任务可能涉及外部副作用，需沿用或补充安全限制（避免误触发正式动作）。
