# WebSocket API

## 基础信息

- 服务地址：`ws://localhost:3003/ws`
- 实现位置：`backend/apps/ws/src/main.ts`
- 作用：订阅 Redis channel，向前端推送实时事件

## 客户端消息协议

客户端发送 JSON：

```json
{ "action": "subscribe", "channel": "meeting:<meetingId>" }
```

支持动作：

- `subscribe`
- `unsubscribe`
- `ping`

## 服务端回包

- 订阅成功：`{ "type": "subscribed", "channel": "..." }`
- 取消订阅：`{ "type": "unsubscribed", "channel": "..." }`
- 心跳响应：`{ "type": "pong", "timestamp": 1700000000000 }`
- 协议错误：`{ "type": "error", "message": "..." }`

## 事件通道示例

- `meeting:<meetingId>`：会议消息、状态、总结事件
- `discussion:<discussionId>`：讨论协作事件
- `stream:<sessionId>`：模型流式输出事件

服务端推送消息会附加 `channel` 字段，便于前端单连接多路复用。
