# WS Three-Level Protocol & Engineering Statistics Push Plan

## 1. 目标

- 建立统一的 WebSocket 三层消息模型：系统级、用户级、功能级。
- 形成可复用的标准消息协议，业务方仅需发送 Redis 消息即可触发 WS 下发。
- 首批落地“工程统计任务完成消息下发”，对消息中心形成实时通知闭环。

## 2. 协议与通道标准

### 2.1 分层

- `system`：全局系统级事件（与用户/页面无关）
- `user`：用户级定向事件（与用户有关）
- `feature`：功能级事件（与具体业务实体有关）

### 2.2 通道命名

- 系统级：`ws:system`
- 用户级：`ws:user:{userId}`
- 功能级：`ws:feature:{feature}:{entityId}`

### 2.3 消息协议（harbin.ws.v1）

```json
{
  "protocol": "harbin.ws.v1",
  "messageId": "uuid",
  "level": "user",
  "event": "engineering.statistics.completed",
  "timestamp": "2026-03-13T10:00:00.000Z",
  "source": "message-center",
  "target": {
    "channel": "ws:user:employee-1",
    "userId": "employee-1"
  },
  "data": {},
  "meta": {}
}
```

## 3. 实施步骤

1. 在 `infra` 增加 WS 协议类型与发布服务，屏蔽 Redis 发布细节。
2. 改造 WS 网关：对 `ws:*` 通道按标准协议转发；保留 legacy 通道兼容行为。
3. 在消息中心写入后，按用户级通道推送标准事件。
4. 前端 Layout 订阅用户级通道，收到事件后刷新未读数/消息抽屉。
5. 验证工程统计成功/失败两类消息均可实时下发。

## 4. 影响点

- 后端：`backend/libs/infra`、`backend/apps/ws`、`backend/src/modules/message-center`
- 前端：`frontend/src/components/Layout.tsx`
- 协议兼容：会议既有 `meeting:*` 通道保持不变

## 5. 风险与对策

- Redis 不可用时：发布服务返回 0，不影响主流程。
- 协议切换风险：仅对 `ws:*` 通道强制标准化，legacy 通道不破坏。
- 前端消息抖动：优先使用事件内 `unreadCount`，缺失时回退拉取。
