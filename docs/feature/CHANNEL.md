# CHANNEL 模块设计方案

## 飞书接入方案

### 需求确认

| 决策点 | 结论 |
|---|---|
| 交互模式 | **最终双向**，MVP 先单向推送 |
| 载体形式 | **MVP 用 Webhook**，后续升级自建应用 Bot |
| 部署形态 | **`apps/channel`** — 统一外部渠道网关，飞书为第一个 provider |
| 推送目标 | 群聊 + 个人私聊都支持 |
| 推送内容 | 任务执行结果、Agent 执行日志、系统告警、会议纪要、定时报告 |

### 架构设计思路

#### 1. `apps/channel` — 统一渠道网关

```
apps/channel/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── contracts/                    # 渠道抽象层
│   │   ├── channel-provider.interface.ts   # 统一 Provider 接口
│   │   ├── channel-message.types.ts        # 统一消息模型
│   │   └── channel-target.types.ts         # 推送目标抽象
│   ├── providers/
│   │   └── feishu/                   # 飞书 Provider（第一个）
│   │       ├── feishu.module.ts
│   │       ├── feishu-webhook.service.ts   # MVP: Webhook 推送
│   │       ├── feishu-card-builder.ts      # 消息卡片构建
│   │       └── feishu.types.ts
│   ├── modules/
│   │   ├── dispatcher/               # 消息分发调度
│   │   │   ├── channel-dispatcher.service.ts  # 消费事件 → 路由到 provider
│   │   │   └── channel-dispatcher.module.ts
│   │   └── config/                   # 渠道配置管理
│   │       ├── channel-config.service.ts     # 渠道/目标 CRUD
│   │       ├── channel-config.controller.ts
│   │       └── channel-config.module.ts
│   └── schemas/
│       ├── channel-config.schema.ts         # 渠道配置表
│       └── channel-delivery-log.schema.ts   # 投递日志表
```

#### 2. 核心抽象 — `ChannelProvider` 接口

```typescript
interface ChannelProvider {
  readonly providerType: string;  // 'feishu' | 'dingtalk' | 'slack'

  // 推送消息（统一入口）
  send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult>;

  // 验证配置有效性（如 webhook URL 是否可达）
  validateConfig(config: Record<string, unknown>): Promise<boolean>;
}
```

未来加钉钉/Slack 只需新增 provider，不改核心链路。

#### 3. 事件消费链路

```
已有事件源                          新增 channel app
┌─────────────────┐
│ orchestration    │──┐
│ task completed   │  │
├─────────────────┤  │   Redis Stream
│ agent runtime    │  ├─→ streams:channel:events  ──→  ChannelDispatcher
│ action log       │  │                                     │
├─────────────────┤  │                                ┌─────┴──────┐
│ scheduler alert  │──┤                                │ route by   │
├─────────────────┤  │                                 │ config     │
│ meeting ended    │──┤                                └─────┬──────┘
├─────────────────┤  │                                      │
│ system alerts    │──┘                             ┌───────┴───────┐
└─────────────────┘                                 │ FeishuProvider │
                                                    │ (Webhook POST) │
                                                    └───────────────┘
```

**关键点**：
- 复用现有 Redis Stream 事件模式（与 message-center 一致）
- 新增 `streams:channel:events` stream，由各事件源生产
- `ChannelDispatcher` 消费事件，查配置路由到对应 provider
- 投递结果写入 `channel_delivery_logs`（可追踪/重试）

#### 4. 渠道配置模型（`channel_configs`）

```typescript
{
  _id: ObjectId;
  name: string;                // "研发群通知"
  providerType: 'feishu';     // 渠道类型
  targetType: 'group' | 'user';
  providerConfig: {            // 飞书特有配置
    webhookUrl: string;        // MVP: 群机器人 webhook
    // 后续自建应用时: appId, appSecret, chatId, userId 等
  };
  eventFilters: string[];      // 订阅的事件类型 ["orchestration.task.*", "system.alert.*"]
  isActive: boolean;
  createdBy: string;           // 创建人 userId
  createdAt: Date;
  updatedAt: Date;
}
```

#### 5. MVP 分阶段路径

| 阶段 | 目标 | 飞书侧 | 系统侧 |
|---|---|---|---|
| **Phase 1** | Webhook 单向推送 | 群机器人 Webhook URL | `apps/channel` + FeishuWebhookProvider + 事件消费 |
| **Phase 2** | 自建应用推送 | 飞书企业自建应用 + Bot | FeishuAppProvider（SDK），支持个人私聊推送、消息卡片交互 |
| **Phase 3** | 双向交互 | Bot 事件订阅（接收用户消息） | 入站 Webhook 控制器 → 解析指令 → 调用 orchestration/agent |

#### 6. 与现有系统的集成点

- **事件生产方不需要感知 channel 的存在** — 只需往 `streams:channel:events` 发标准事件（可在现有事件发布点用 fan-out 模式同时写 message-center 和 channel 两个 stream）
- **`libs/infra`** 中新增 `channel-events.ts` 定义事件契约，与 `message-center-events.ts` 同级
- **配置管理** 通过 REST API 由前端管理界面操作（或直接数据库 seed）

### 需要你确认 / 补充的点

1. **事件 fan-out 策略**：是让事件源同时写两个 stream（message-center + channel），还是由 message-center 消费后再转发到 channel stream？
2. **Phase 1 的优先级排序**：5 类推送内容（任务结果、Agent日志、系统告警、会议纪要、定时报告）你希望先做哪几个？
3. **前端配置界面**：MVP 阶段是否需要前端管理渠道配置，还是先通过数据库 seed / API 配置？
4. **这个方案整体方向是否 OK？**如果 OK 我就正式输出到 `docs/plan/` 进入开发流程。

## 飞书账号绑定（一次性 Token）

为避免 `/bind <邮箱>` 被冒用，当前绑定流程升级为一次性 token 机制：

1. 用户在前端点击「绑定飞书」，调用 `POST /auth/me/feishu-bind-token`。
2. 后端生成 token，并写入 Redis：`channel:feishu-bind:{token}`，TTL 300 秒。
3. 用户在飞书中发送 `/bind token:<token>`。
4. `apps/channel` 入站服务原子消费 token（消费即删除），读取 `employeeId` 后写入 `channel_user_mappings`。
5. 成功后返回绑定完成提示；token 失效或不存在则提示“token 无效或已过期”。

兼容策略：

- 默认关闭邮箱绑定降级。
- 如需应急，可通过 `FEISHU_BIND_EMAIL_FALLBACK=true` 开启邮箱绑定分支，并限制管理员角色使用。
