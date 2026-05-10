# Plan: DISCUSSION_SPACE_AGENT_RUNNING_STATUS_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | 69f096d658f9498921a8bd27 |
| OpenCode Session | — |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-05-02 |

## 2. 背景

当前讨论空间在用户发送消息并唤醒 Agent 后，前端只能等待 AI 消息落库并回推，缺少“Agent 已开始执行”的明确可视反馈。用户在等待阶段无法判断：

1. Agent 是否已被成功触发；
2. 是正在执行还是链路异常；
3. 多 Agent 并发时，当前是谁在回复。

这会造成“点击后无反馈”的感知，交互体验明显弱于会议聊天中的 thinking/执行中提示。

## 3. 目标

1. 讨论空间在 Agent 开始执行时实时展示“执行中”状态。
2. 支持多 Agent 并发执行时的独立状态展示。
3. Agent 完成/失败后自动清理执行中状态，避免状态卡死。
4. 保持现有讨论消息链路不变，不新增独立前端工程。

## 4. 执行步骤

1. [x] **后端：讨论消息 SSE 扩展执行状态事件**
   - 在讨论消息流新增 `discussion.agent.execution.status` 事件。
   - 事件字段包含 `spaceId/threadId/participantId/agentId/status/reason`。
   - 状态约定：`running | completed | failed`。

2. [x] **后端：AI 回复异步链路注入状态发射点**
   - `generateAiMessagesAsync` 每个 Agent 开始前发 `running`。
   - 成功落库 AI 消息后发 `completed`。
   - 异常分支发 `failed`，并保证不会阻断其他 Agent 执行。

3. [x] **前端：讨论详情页接入执行状态流并展示**
   - 扩展 `DiscussionMessageStreamEvent` 联合类型，解析状态事件。
   - 在 `DiscussionDetail` 维护当前讨论线的执行中 Agent 集合。
   - 在消息区头部展示“{Agent} 执行中”状态标签（支持多 Agent）。

4. [x] **前端：状态清理与兜底**
   - 收到 `completed/failed` 时移除执行中状态。
   - 收到对应 AI 消息创建事件时兜底移除，防止状态残留。
   - 切换讨论线时清空本地执行状态，避免跨线程串状态。

5. [x] **测试与回归**
   - 增补后端消息流单测，覆盖执行状态事件发射。
   - 本地执行 `frontend` 构建，验证类型与页面编译通过。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-024 | 讨论空间 Agent 执行中状态展示 | [链接](../requirement/DISCUSSION_SPACE_REQ-024_AGENT_RUNNING_STATUS.md) | completed |

## 6. 关键影响点

- **后端**：`discussion-message-stream.service.ts`、`discussion-message.service.ts`
- **前端**：`discussionService.ts`、`DiscussionDetail.tsx`
- **测试**：`discussion-message-stream.service.spec.ts`
- **文档**：`docs/plan/`、`docs/requirement/`、`docs/feature/`、`docs/dailylog/day/`

## 7. 风险与依赖

- **风险**：前端状态与消息到达时序可能乱序，需要以 `completed/failed + message.created` 双重清理。
- **风险**：多 Agent 并发时若仅靠全局布尔态会互相覆盖，需使用 `participantId` 维度隔离。
- **依赖**：现有讨论消息 SSE 通道稳定可用，无需新增 WebSocket 通道。

## 8. 备注

- 仅增强讨论空间状态可视反馈，不改变消息写库结构。
- 不引入 `organizationId` 字段。
