# Agent 统一内部消息运行时改造计划

## 背景与目标

- 当前 `meeting.ended` 的消费由 `MeetingSummaryAutomationService` 在会议模块内硬编码处理，不符合“Agent 收件后自主思考并决策”的统一运行时目标。
- 目标是把内部消息处理收敛到 Agent 执行链：消息到达后统一进入 Agent 任务执行入口（与 `executeTask` 同类路径），由 Agent 基于角色能力与工具自主完成动作。

## 执行步骤

1. 在 `inner-message` 模块新增“Agent Runtime Bridge”服务，接管内部消息到 Agent 执行入口的桥接逻辑（仅做统一投递与状态回写，不做业务硬编码分支）。
2. 改造 `InnerMessageDispatcherService`：消息分发到 inbox 后，统一调用 Runtime Bridge 触发 Agent 执行流程，并记录投递/桥接失败日志。
3. 为 Agent 消费 internal message 定义统一任务上下文与提示模板（包含 `messageId/eventType/mode/payload`），通过 `AgentClientService.executeTaskDetailed` 驱动 Agent LLM 思考与工具调用。
4. 在会议域补充“会议总结生成”显式工具能力：新增内部 API 入口 + MCP Tool（`meeting.generate-summary`），让 meeting-assistant 可在统一流程中自主调用。
5. 下线会议模块内硬编码收件消费（移除 `MeetingSummaryAutomationService` provider），避免双消费与行为分叉。
6. 补充/更新测试与文档，覆盖内部消息统一处理链路、会议总结工具路径与迁移后的行为说明。

## 关键影响点

- 后端 / Inner Message：`backend/src/modules/inner-message/*`
- 后端 / Agents Client：`backend/src/modules/agents-client/*`
- 后端 / Meeting：`backend/src/modules/meetings/*`
- Agents 工具层：`backend/apps/agents/src/modules/tools/*`
- 文档：`docs/feature/INNER_MESSAGE.md`、`docs/feature/MEETING_CHAT.md`、`docs/feature/AGENT_RUNTIME.md`

## 风险与依赖

- 统一桥接后，消息处理延迟与 Agent 执行稳定性耦合，需要保障失败重试与可观测日志。
- 迁移窗口若同时保留旧自动化消费，存在重复处理风险；需确保只保留单条消费路径。
- 会议总结从“模块自动执行”变为“Agent 决策执行”后，需要通过提示词与工具权限保证期望动作可达。
