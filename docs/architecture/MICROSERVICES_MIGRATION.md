# 微服务平滑迁移说明

## 目标

- 前端统一走 Gateway
- 业务逐步从 legacy 拆到独立服务
- 通过 Redis + WS 提供流式交互能力

## 当前落地范围

1. `apps/gateway` 已上线
   - 鉴权（JWT）
   - 路由分发
   - 用户上下文签名透传
2. `apps/agents` 已上线
   - 承载 `/api/agents`、`/api/tasks`、`/api/meetings`、`/api/discussions`
   - 校验 `x-user-context` + `x-user-signature`
   - 提供 `/api/agents/:id/test-stream`
3. `apps/ws` 已上线
   - `ws://localhost:3003/ws`
   - 订阅 Redis channel 并广播给前端

## 服务端口

- Gateway: `3100`
- Agents: `3002`
- WS: `3003`
- Legacy: `3001`

## Gateway 路由策略

- `/api/agents/**` -> `AGENTS_SERVICE_URL`
- `/api/tasks/**` -> `AGENTS_SERVICE_URL`
- `/api/meetings/**` -> `AGENTS_SERVICE_URL`
- `/api/discussions/**` -> `AGENTS_SERVICE_URL`
- 其余 `/api/**` -> `LEGACY_SERVICE_URL`

## 内部安全模型

Gateway 从 JWT 中提取用户上下文，并向下游附加：

- `x-user-context`: `base64url(JSON(userContext))`
- `x-user-signature`: `HMAC_SHA256(x-user-context, INTERNAL_CONTEXT_SECRET)`

Agents 服务对签名验签，拒绝未签名/伪造请求。

## 流式交互模型（Agent Test）

1. 前端建立 WS 连接 `ws://localhost:3003/ws`
2. 前端发送订阅：`{ "action": "subscribe", "channel": "stream:<sessionId>" }`
3. 前端调用 HTTP：`POST /api/agents/:id/test-stream`，body 带 `sessionId`
4. Agents 发布事件到 Redis channel `stream:<sessionId>`
5. WS 服务把事件推到前端

事件格式：

```json
{
  "sessionId": "...",
  "type": "start|chunk|done|error",
  "payload": "optional text",
  "timestamp": 1700000000000
}
```

## 前端接入进度

- Agent 模型测试已切换为 `test-stream` + WS 流式显示
- Meetings 页面已订阅 `meeting:<meetingId>`，实时接收消息/状态/总结事件
- Discussions 页面已接入 `/api/discussions`（经 Gateway 转发）并订阅 `discussion:<discussionId>` 实时事件
- WS 服务现在会在转发消息中附带 `channel` 字段，前端可在单连接上按 channel 多路复用
- Meetings 支持「自由讨论 / 有序发言」模式切换，并新增「暂停/恢复会议」控制
- Meetings 消息展示改为 WS 事件驱动，不再依赖定时轮询刷新
- 人类每次发言后，会议内所有在场 Agent 会依次响应
- 支持在会议消息中通过 `@AgentName` 定向点名，点名后仅指定 Agent 响应

## Redis 说明

- 推荐配置 `REDIS_URL`（含密码）
- 未配置或连接失败时，WS 侧会降级为 no-op 并输出 warning 日志
- 会议事件发布到 `meeting:<meetingId>`
- 讨论事件发布到 `discussion:<discussionId>`
