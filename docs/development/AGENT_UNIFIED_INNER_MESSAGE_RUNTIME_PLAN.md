# Agent 统一内部消息运行时改造开发总结

## 1. 目标与范围

- 将内部消息消费从业务模块硬编码逻辑迁移为统一 Agent Runtime 执行链。
- 保持 `inner-message` 的分发/重试/死信能力，同时让 Agent 在收件后基于身份和工具自主决策。
- 为会议总结补齐可被 Agent 主动调用的显式工具能力，避免会议模块内置专用消费器。

## 2. 实现内容

### 2.1 Inner Message -> Agent Runtime 统一桥接

- 新增 `backend/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts`：
  - 识别有效且可执行的接收 Agent。
  - 将内部消息标准化为 Agent 任务（含 `messageId/eventType/mode/payload` 上下文）。
  - 调用 `AgentClientService.executeTaskDetailed` 触发统一执行链。
  - 处理前回写 `processing`，处理完成回写 `processed` 并记录 `runId/sessionId/responsePreview`。

- 改造 `backend/src/modules/inner-message/inner-message-dispatcher.service.ts`：
  - 原有 inbox 投递后，增加 Runtime Bridge 调用。
  - Bridge 失败沿用现有重试和死信流程，避免消息丢失。

- 更新 `backend/src/modules/inner-message/inner-message.module.ts`：
  - 引入 `AgentClientModule`。
  - 注册 `InnerMessageAgentRuntimeBridgeService`。

### 2.2 会议总结能力工具化

- 新增会议内部接口：`POST /meetings/:id/generate-summary`（`backend/src/modules/meetings/meeting.controller.ts`）。
- 新增 MCP 工具：`builtin.sys-mg.mcp.meeting.generate-summary`：
  - 工具定义：`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
  - 工具分发：`backend/apps/agents/src/modules/tools/tool.service.ts`
  - 工具执行：`backend/apps/agents/src/modules/tools/meeting-tool-handler.service.ts`
  - 会议助理能力集补齐：`backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts`

### 2.3 移除会议模块硬编码消费挂载

- `backend/src/modules/meetings/meeting.module.ts` 中移除旧自动化消费器 provider，防止与统一桥接链路重复消费。

## 3. 验证结果

- `pnpm -C backend run lint` 通过。
- `pnpm -C backend run build` 通过。
- `pnpm -C backend run build:agents` 通过。
- `pnpm -C backend run test -- backend/apps/agents/src/modules/tools/meeting-tool-handler.service.spec.ts backend/apps/agents/src/modules/tools/tool.service.spec.ts` 通过。

新增测试文件：

- `backend/apps/agents/src/modules/tools/meeting-tool-handler.service.spec.ts`

## 4. 影响与后续建议

- 影响：内部消息进入 Agent 自主处理闭环，会议总结能力可由 Agent 主动调用并可扩展到更多事件类型。
- 建议：下一步可将 `inner:inbox:*` 事件消费与 Runtime Hook 指标打通，补充消息处理 SLA 监控（处理时延、重试率、死信率）。

## 5. v2 调整（单层执行链）

- `meeting.generate-summary` 不再在服务端内部再次 `executeTask`，避免“收件任务内二次派发任务”。
- 增加 `meeting.get-detail` 与 `meeting.save-summary` MCP 组合：Agent 在同一执行链中自行读取会议详情、生成总结并回写。
- `meeting.list-meetings` MCP 输出改为轻量列表，不再返回 `messages` 明细。
