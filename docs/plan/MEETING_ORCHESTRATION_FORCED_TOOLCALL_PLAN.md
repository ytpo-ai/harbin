# 会议场景编排工具强制触发计划

> 已聚合到主计划：`docs/plan/MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md`

## 背景

在会议讨论场景中，即使 Agent 已分配 `orchestration_*` 工具，模型仍可能仅输出自然语言承诺（不产生 `<tool_call>`），导致“有权限但不执行”。

根因是当前工具调用策略为“可调用”而非“必须调用”，仅少数场景（如 `code-docs-mcp`）有确定性强制分支。

## 执行步骤

1. 在 Agent 执行链路新增“编排意图识别”逻辑，识别会议消息中创建/执行/查询计划意图。
2. 命中意图后，优先走确定性强制工具调用（不依赖模型先产出 `<tool_call>`）。
3. 依据意图映射调用对应 `orchestration_*` MCP 工具，并复用现有 `executionContext`（meeting context）。
4. 在失败路径补充降级提示与日志埋点，明确是工具调用失败还是上下文不满足。
5. 保留原有模型回合机制作为非编排意图场景的默认路径。
6. 构建验证 `build:agents`，并更新开发沉淀文档。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 文档：`docs/development/AGENT_ORCHESTRATION_AGENTSESSION_UNIFICATION_PLAN.md`

## 风险与依赖

- 意图误判风险：普通讨论被误触发编排工具。
  - 缓解：结合关键词 + 会议上下文 + 工具可用性三重判定。
- 参数不足风险：用户未给出 planId/taskId。
  - 缓解：返回结构化缺参提示，指导下一步补充信息。
