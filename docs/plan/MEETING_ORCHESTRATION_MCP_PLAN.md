# 会议场景编排 MCP 工具接入计划

## 背景

目标是在会议场景中，允许指定 Agent 通过 MCP 工具直接触发和管理计划编排（orchestration），实现“会议内发起计划、执行计划、查询状态、处理人工接管”的闭环。

## 执行步骤

1. 在 `apps/agents` 的 ToolService 中新增 orchestration MCP 工具定义与实现映射（create/run/get/list/reassign/complete-human）。
2. 为工具执行链路增加上下文透传能力（`teamContext/taskType/teamId`），用于识别会议场景并写入审计元数据。
3. 实现 ToolService 到 legacy orchestration API 的内部调用封装，使用内部签名上下文头。
4. 增强 legacy orchestration controller 的鉴权逻辑：兼容内部签名上下文（无 Bearer Token 场景）。
5. 对高风险编排动作增加参数约束与确认门槛（`confirm: true`），并在工具返回中附带会议元数据。
6. 更新 API/架构文档与示例，补充“会议中通过 MCP 执行编排计划”的调用方式。

## 关键影响点

- 后端（agents）：`backend/apps/agents/src/modules/tools/*`、`backend/apps/agents/src/modules/agents/agent.service.ts`
- 后端（legacy）：`backend/src/modules/orchestration/orchestration.controller.ts`
- 文档：`docs/api/agents-api.md`、`docs/api/legacy-api.md`、`docs/architecture/*`

## 风险与依赖

- 跨服务调用一致性：MCP 工具调用 legacy 编排 API，需保证鉴权与组织隔离正确。
- 高风险动作误触发：需通过 `confirm` 机制与会议上下文校验降低风险。
- 会议上下文识别精度：依赖 `teamContext/task` 信息透传，需保证调用链稳定。
