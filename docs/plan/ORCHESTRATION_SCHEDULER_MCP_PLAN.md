# 定时计划编排 MCP 能力补齐计划

## 背景

当前系统已支持会议场景下的计划编排 MCP（`mcp.orchestration.*Plan` 与任务相关动作）。
本次调整将“定时计划编排”统一为“两步法”：

1. 先用 `builtin.sys-mg.mcp.orchestration.create-plan` 创建编排计划。
2. 再用 `builtin.sys-mg.mcp.orchestration.create-schedule` 为指定 `planId` 添加 schedule 信息。

因此，`create-schedule/update-schedule` 不再让调用方重复提供执行目标与输入任务内容，而是围绕已有 plan 的调度配置进行创建和修改。

## 执行步骤

1. 梳理现有 Orchestration MCP 工具实现与确认机制，复用 meeting 上下文校验与内部签名调用链路。
2. 调整 `create-schedule/update-schedule` 的 MCP 参数契约：以 `planId` + `schedule` 为主，隐藏 target/input 细节。
3. 在 ToolService 中实现“plan -> schedule”桥接：读取 plan 元数据后落库到 scheduler 接口。
4. 调整 Agent 编排意图：优先形成“create-plan -> create-schedule”的连续操作语义。
5. 更新文档（API 与功能文档）以反映新参数约定与使用顺序。

## 关键影响点

- 后端（agents）：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 后端（agents）：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 文档：`docs/api/agents-api.md`、`docs/feature/ORCHETRATION_SCHEDULER.md`

## 风险与依赖

- scheduler 接口位于 legacy backend，`create-schedule` 仍需桥接为底层可接受字段，避免破坏现有页面。
- `planId` 对应 plan 若缺少可执行 agent 上下文，创建 schedule 时需要明确报错提示。
- 调度参数（`cron/interval/timezone`）校验不严格会导致运行时失败，需在 MCP 层做基础约束。
