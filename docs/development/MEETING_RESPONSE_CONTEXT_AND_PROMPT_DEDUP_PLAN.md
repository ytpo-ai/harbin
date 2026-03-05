# 会议回应上下文与系统提示去重开发总结

## 背景与问题复盘

本次针对会议场景中两类高频问题进行了修复：

1. 任务描述过于泛化，session 中难以定位“被回应的具体发言”。
2. 同一 session 内 system prompt 可能被重复写入，造成上下文噪音与排障困难。

## 本次实现

### 1) 会议任务描述补全最新发言

- 文件：`backend/src/modules/meetings/meeting.service.ts`
- 在构建 discussion 任务时，将 `triggerMessage.content` 提炼为摘要并拼入 `task.description`。
- 效果：session 中可直接看到“最新发言”摘要，降低“请回应什么”不明确问题。

### 2) 会议响应触发去重

- 文件：`backend/src/modules/meetings/meeting.service.ts`
- 实现两层去重：
  - responder 列表按 `participantId` 去重，避免单轮重复调度。
  - 新增 `meetingId + agentId + triggerMessageId` 的短窗口去重（15s），拦截近实时重复触发。
- 效果：降低重复 run/重复系统块注入的概率。

### 3) Session 系统提示去重

- 文件：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`
- 在 `appendSystemMessagesToSession` 写入前读取 session 近窗口系统消息，按“内容完全一致”去重。
- 效果：避免同内容 system prompt 在同一 session 内反复堆叠。

### 4) Runtime userContent 对齐真实用户输入

- 文件：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 将 run 启动时的 `userContent` 从固定 `task.description` 改为“最近 user 消息优先”。
- 效果：运行轨迹与会议真实发言更一致，便于问题定位和审计。

## 验证结果

- 构建验证：
  - `cd backend && npm run build`
  - `cd backend && npm run build:agents`
- 结果：均通过。

## 风险与后续建议

- 当前 session 系统提示去重为“精确文本匹配”，仍可能保留语义相同但文本不同的重复提示。
- 建议后续增加指标观测：
  - 每会话 system message 去重命中次数
  - 每触发消息的 agent run 次数分布
  - 会议任务描述中“最新发言摘要”覆盖率
