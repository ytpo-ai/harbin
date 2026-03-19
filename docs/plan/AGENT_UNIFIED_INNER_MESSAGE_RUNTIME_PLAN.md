# Agent 统一内部消息运行时改造计划

## 背景与目标

- 当前 `meeting.ended` 的消费曾在会议模块内使用硬编码自动化处理，不符合“Agent 收件后自主思考并决策”的统一运行时目标。
- 目标是把内部消息处理收敛到 Agent 执行链：消息到达后统一进入 Agent 任务执行入口（与 `executeTask` 同类路径），由 Agent 基于角色能力与工具自主完成动作。

## 执行步骤

1. 在 `inner-message` 模块新增“Agent Runtime Bridge”服务，接管内部消息到 Agent 执行入口的桥接逻辑（仅做统一投递与状态回写，不做业务硬编码分支）。
2. 改造 `InnerMessageDispatcherService`：消息分发到 inbox 后，统一调用 Runtime Bridge 触发 Agent 执行流程，并记录投递/桥接失败日志。
3. 为 Agent 消费 internal message 定义统一任务上下文与提示模板（包含 `messageId/eventType/mode/payload`），通过 `AgentClientService.executeTaskDetailed` 驱动 Agent LLM 思考与工具调用。
4. 在会议域补充“会议总结生成”显式工具能力：新增内部 API 入口 + MCP Tool（`meeting.generate-summary`），让 meeting-assistant 可在统一流程中自主调用。
5. 下线会议模块内硬编码收件消费（移除旧自动化消费器），避免双消费与行为分叉。
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

## 需求补充（v2）

- `meeting.generate-summary` 禁止在服务端再次触发 `executeTask`，避免“收件任务内二次派发任务”的双层执行链。
- 增加会议详情 MCP 能力（`meeting.get-detail`），用于 Agent 按需拉取完整会话内容。
- `meeting.list-meetings` 改为轻量列表视图，不再返回 `messages` 明细。

### v2 实施步骤

1. 会议服务改造为“总结写入”能力：新增/调整 API 支持直接写入 summary 内容，不在服务端二次执行 Agent 任务。
2. 新增 `meeting.get-detail` MCP 工具，供 Agent 显式获取会议详情与消息内容。
3. 调整 `meeting.list-meetings` 输出与接口查询，默认不返回 `messages` 字段。
4. 更新 meeting-assistant 工具集、提示词约束与相关功能/API文档。
5. 补充测试与回归验证，确保总结链路为单层执行。
