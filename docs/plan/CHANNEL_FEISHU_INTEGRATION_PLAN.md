# Channel 统一渠道网关 — 飞书接入 Plan

## 1. 背景

里程碑 2（`docs/issue/MILESTONE2.MD`）要求实现飞书接入能力，支持用户通过飞书消息与 agent 交互、接收任务执行结果和日志输出。

- **Phase 1（已完成）**：通过飞书 Webhook 机器人实现单向推送，内容聚焦「任务执行结果」。
- **Phase 2（当前）**：升级为飞书自建应用 Bot，扩展推送内容（Agent 日志、系统告警、会议纪要、定时报告），支持个人私聊推送。

## 2. 整体架构决策

| 决策点 | 结论 | 原因 |
|---|---|---|
| 部署形态 | `apps/channel` 独立 NestJS app | 统一渠道网关，飞书为第一个 provider，后续可扩展钉钉/Slack |
| 交互模式 | MVP 单向推送，后续迭代双向交互 | Webhook 机器人仅支持推送，双向需自建应用 |
| 载体形式 | MVP 用飞书群机器人 Webhook | 零审批、即开即用，后续升级自建应用 |
| 事件来源 | message-center 消费后转发到 channel stream | 不改动现有事件生产方，message-center 作为扇出点 |
| 推送目标 | 群聊 + 个人（Webhook 仅群聊；个人推送留给 Phase 2 自建应用） | Webhook 天然绑定群 |
| 配置管理 | MVP 通过 seed 脚本 + REST API，不做前端 UI | 降低 MVP 范围 |
| 推送内容 | Phase 1 仅「任务执行结果」 | 最核心场景优先 |

## 3. 可执行步骤

### Step 1：创建 `apps/channel` 基础骨架

**影响点**：后端 / 配置

- 在 `backend/apps/channel/` 下创建 NestJS 独立应用
- 注册到 `nest-cli.json` monorepo 配置
- 创建 `main.ts`、`app.module.ts`、`health.controller.ts`
- 配置独立端口（环境变量 `CHANNEL_PORT`，默认 `3006`）
- 引入 `libs/infra`（Redis）、`libs/common`（Logger）等共享库
- 更新 `start.sh` / `.env.example` 新增 channel app 启动配置

### Step 2：定义渠道抽象层（contracts）

**影响点**：后端

创建 `apps/channel/src/contracts/` 目录：

- **`channel-provider.interface.ts`** — 统一 Provider 接口：
  ```typescript
  interface ChannelProvider {
    readonly providerType: string; // 'feishu' | 'dingtalk' | 'slack'
    send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult>;
    validateConfig(config: Record<string, unknown>): Promise<boolean>;
  }
  ```
- **`channel-message.types.ts`** — 统一消息模型：
  ```typescript
  interface ChannelMessage {
    title: string;
    content: string;        // 纯文本/markdown
    contentType: 'text' | 'markdown' | 'card';
    payload?: Record<string, unknown>;  // 渠道特有扩展
    sourceEvent: {
      eventId: string;
      eventType: string;
      occurredAt: string;
    };
  }
  ```
- **`channel-target.types.ts`** — 推送目标抽象：
  ```typescript
  interface ChannelTarget {
    configId: string;       // 关联 channel_configs._id
    providerType: string;
    targetType: 'group' | 'user';
    providerConfig: Record<string, unknown>; // 渠道特有配置
  }
  ```
- **`delivery-result.types.ts`** — 投递结果：
  ```typescript
  interface DeliveryResult {
    success: boolean;
    providerType: string;
    statusCode?: number;
    errorMessage?: string;
    deliveredAt: Date;
  }
  ```

### Step 3：实现飞书 Webhook Provider

**影响点**：后端

创建 `apps/channel/src/providers/feishu/` 目录：

- **`feishu-webhook.provider.ts`** — 实现 `ChannelProvider` 接口：
  - `send()`：通过 axios POST 到飞书 Webhook URL，构造飞书消息体
  - `validateConfig()`：检查 webhookUrl 格式合法性
  - 请求超时、重试（最多 2 次）、错误分类（网络/限流/业务）
- **`feishu-card-builder.ts`** — 飞书消息卡片构建器：
  - `buildTaskResultCard(message: ChannelMessage)` — 任务执行结果卡片
  - 使用飞书 Interactive Message Card JSON 格式
  - 卡片包含：标题、状态标签（成功/失败）、结果摘要、查看详情按钮（actionUrl）
- **`feishu.types.ts`** — 飞书特有类型定义
- **`feishu.module.ts`** — NestJS 模块注册

飞书 Webhook 消息体格式参考：
```json
{
  "msg_type": "interactive",
  "card": {
    "header": { "title": { "tag": "plain_text", "content": "任务完成通知" } },
    "elements": [...]
  }
}
```

### Step 4：实现渠道配置管理（Schema + Service + API）

**影响点**：后端 / 数据库

- **`channel-config.schema.ts`** — `channel_configs` 集合：
  ```typescript
  {
    name: string;                   // 配置名称，如 "研发群通知"
    providerType: 'feishu';         // 渠道类型
    targetType: 'group' | 'user';
    providerConfig: {               // 飞书特有
      webhookUrl: string;           // 群机器人 Webhook URL
      webhookSecret?: string;       // 签名密钥（可选）
    };
    eventFilters: string[];         // 订阅事件类型，如 ["orchestration.task.completed"]
    isActive: boolean;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
  }
  ```
- **`channel-delivery-log.schema.ts`** — `channel_delivery_logs` 集合：
  ```typescript
  {
    configId: string;               // 关联 channel_configs
    eventId: string;                // 源事件ID
    eventType: string;
    providerType: string;
    status: 'success' | 'failed' | 'retrying';
    attempt: number;
    errorMessage?: string;
    requestPayload?: Record<string, unknown>;
    responsePayload?: Record<string, unknown>;
    deliveredAt?: Date;
    createdAt: Date;
  }
  ```
- **`channel-config.service.ts`** — CRUD + 按 eventType 查询活跃配置
- **`channel-config.controller.ts`** — REST API：
  - `POST /channel/configs` — 创建渠道配置
  - `GET /channel/configs` — 查询列表
  - `PATCH /channel/configs/:id` — 更新配置
  - `DELETE /channel/configs/:id` — 删除配置
  - `POST /channel/configs/:id/test` — 测试推送（发送一条测试消息）

### Step 5：实现事件转发机制（message-center → channel）

**影响点**：后端（legacy app message-center 模块 + channel app）

这是核心链路。在 message-center 事件消费成功后，将符合条件的事件转发到 channel 的 Redis Stream。

#### 5a. 定义 channel 事件契约

在 `libs/infra/src/` 新增 `channel-events.ts`：
```typescript
// Stream key
export const CHANNEL_EVENTS_STREAM = 'streams:channel:events';
export const CHANNEL_CONSUMER_GROUP = 'channel-group';

// 事件 envelope（复用 message-center 事件结构，增加 channel 路由字段）
export interface ChannelEventEnvelope {
  eventId: string;
  eventType: string;        // 原始事件类型
  version: 'v1';
  occurredAt: string;
  source: string;
  traceId: string;
  data: {
    receiverId?: string;
    messageType: string;
    title: string;
    content: string;
    bizKey?: string;
    actionUrl?: string;
    priority: 'low' | 'normal' | 'high';
    extra?: Record<string, unknown>;
  };
}
```

#### 5b. message-center 消费后转发

修改 `backend/src/modules/message-center/message-center-event-consumer.service.ts`：
- 在成功写入 system_messages 并 WebSocket 推送之后
- 判断事件类型是否需要转发（初期硬编码白名单，后续可配置化）
- 调用 `RedisService.xadd(CHANNEL_EVENTS_STREAM, envelope)` 转发
- 转发失败仅记日志，不影响 message-center 主流程

#### 5c. channel app 事件消费

创建 `apps/channel/src/modules/dispatcher/channel-dispatcher.service.ts`：
- 启动时创建 consumer group（`CHANNEL_CONSUMER_GROUP`）
- 循环 `xreadgroup` 拉取事件
- 解析事件 → 查询匹配的 `channel_configs`（按 eventType + isActive 过滤）
- 对每个匹配的配置，调用对应 `ChannelProvider.send()`
- 写入 `channel_delivery_logs`
- 成功后 `xack`；全部失败写 DLQ（`streams:channel:events:dlq`）后 `xack`

### Step 6：新增 orchestration 任务完成事件到 message-center

**影响点**：后端（orchestration 模块）

当前 message-center 的事件类型只有 `engineering.tool.completed` 和 `meeting.session.ended`。需要新增 orchestration 任务完成事件。

- 在 `libs/infra/src/message-center-events.ts` 中新增事件类型：`orchestration.task.completed`
- 在 orchestration 任务执行完成（成功/失败）时，发布事件到 `streams:message-center:events`
- 具体代码位置：在 task 状态变更为 `completed` / `failed` 时触发
- 事件 data 包含：任务标题、执行结果摘要、计划ID、actionUrl（指向前端任务详情页）

### Step 7：Seed 脚本与环境配置

**影响点**：配置 / 运维

- 创建 `backend/scripts/channel-config-seed.ts`：
  - 提供示例 seed 数据（飞书群 Webhook 配置模板）
  - 支持通过环境变量 `FEISHU_WEBHOOK_URL` 快速配置
- 更新 `.env.example`：
  ```
  # Channel Service
  CHANNEL_PORT=3006
  FEISHU_WEBHOOK_URL=          # 飞书群机器人 Webhook URL（可选）
  FEISHU_WEBHOOK_SECRET=       # 飞书 Webhook 签名密钥（可选）
  ```

## 4. 事件流转全链路

```
Orchestration 任务完成
        │
        ▼
streams:message-center:events      (Redis Stream)
        │
        ▼
MessageCenterEventConsumer         (legacy app)
  ├── 写入 system_messages + WS 推送（现有逻辑）
  └── 转发 → streams:channel:events  (新增)
                │
                ▼
        ChannelDispatcher           (channel app)
          ├── 查询 channel_configs（按 eventType 匹配）
          ├── 调用 FeishuWebhookProvider.send()
          ├── 写入 channel_delivery_logs
          └── xack / DLQ
                │
                ▼
        飞书群机器人消息卡片
```

## 5. 关键影响点汇总

| 影响范围 | 具体变更 |
|---|---|
| **新增 app** | `apps/channel/`（独立 NestJS 应用，独立端口） |
| **新增集合** | `channel_configs`、`channel_delivery_logs` |
| **新增 Redis Stream** | `streams:channel:events`、`streams:channel:events:dlq` |
| **修改 libs/infra** | 新增 `channel-events.ts` |
| **修改 message-center** | 消费成功后增加转发逻辑 |
| **修改 orchestration** | 任务完成时发布事件到 message-center stream |
| **修改配置文件** | `nest-cli.json`、`.env.example`、`start.sh` |
| **前端** | Phase 1 不涉及前端变更 |

## 6. 风险与依赖

| 风险 | 应对策略 |
|---|---|
| 飞书 Webhook 有 QPS 限流（默认约 100次/分钟） | Provider 层实现限流保护，超限时暂缓发送 |
| message-center 转发失败可能丢消息 | 转发失败仅记日志不阻塞主流程；channel 侧可通过 delivery_logs 追踪丢失 |
| Webhook URL 泄露导致群消息滥用 | providerConfig.webhookUrl 存储时加密（复用 API_KEY_ENCRYPTION 方案） |
| orchestration 高频任务完成导致消息轰炸 | eventFilters 支持粒度控制；后续可增加聚合/降频策略 |

## 7. Phase 路线图

| 阶段 | 目标 | 飞书侧 | 推送内容 |
|---|---|---|---|
| **Phase 1（已完成）** | Webhook 单向推送 | 群机器人 Webhook | 任务执行结果 |
| **Phase 2** | 自建应用推送 + 内容扩展 | 企业自建应用 Bot | + Agent 日志、系统告警、会议纪要、定时报告 |
| **Phase 3** | 双向交互 | Bot 事件订阅 + 卡片回调 + 长连接 | 入站：用户在飞书中下达指令 / 卡片按钮交互；出站：Agent 执行结果回传飞书 |

---

## Phase 2：自建应用推送 — 详细设计

### P2-1. 目标

在 Phase 1 Webhook 单向推送基础上：

1. **载体升级**：从 Webhook 群机器人升级为飞书企业自建应用 Bot，获得完整 API 能力
2. **推送目标扩展**：支持个人私聊推送（不再局限于群聊 Webhook）
3. **推送内容扩展**：新增 4 类推送内容
4. **卡片体验升级**：使用飞书卡片 schema 2.0，按内容类型定制差异化卡片模板
5. **Phase 1 兼容**：Webhook Provider 继续保留，自建应用作为新 Provider 并存

### P2-2. 架构决策

| 决策点 | 结论 | 原因 |
|---|---|---|
| SDK 选型 | `@larksuiteoapi/node-sdk` | 官方 SDK，MIT 协议，内置 token 缓存/自动刷新，类型完整 |
| Provider 模式 | 新增 `feishu-app` Provider，与现有 `feishu`（Webhook）并存 | 两种模式适用不同场景：Webhook 零配置群推送；App 支持个人推送 + 卡片回调 |
| 连接模式 | 优先使用**长连接（WSClient）**模式 | 无需公网 IP / 域名 / 防火墙白名单；适合内部部署场景 |
| Token 管理 | SDK 内置 `tenant_access_token` 自动缓存 | SDK `disableTokenCache: false`（默认）自动处理 token 获取和刷新 |
| 配置存储 | `channel_configs.providerConfig` 扩展 `appId`/`appSecret` 等字段（加密存储） | 复用 Phase 1 配置模型，按 providerType 区分 |
| 事件转发白名单 | 从硬编码 Set 改为可配置化 | Phase 2 新增 4 种事件类型，硬编码不再可维护 |
| 消息聚合/降频 | 引入时间窗口聚合机制 | Agent 日志高频产生，逐条推送会造成消息轰炸 |

### P2-3. 飞书侧配置要求

Phase 2 需要在飞书开放平台创建企业自建应用：

1. 登录 [飞书开放平台](https://open.feishu.cn) → 创建企业自建应用
2. 启用「机器人」能力
3. 申请权限：
   - `im:message:send_as_bot` — 以 Bot 身份发送消息
   - `im:chat:readonly` — 读取群信息（用于群聊推送）
   - `contact:user.id:readonly` — 通过手机号/邮箱反查 user open_id（用于个人推送）
4. 提交管理员审核发布
5. 获取 `App ID` 和 `App Secret`
6. 如使用长连接模式：无需配置回调地址；如使用 Webhook 模式：配置事件订阅回调地址

需要提供给系统的信息：

| 信息 | 说明 |
|---|---|
| `appId` | 自建应用 App ID |
| `appSecret` | 自建应用 App Secret |
| `encryptKey`（可选） | 事件加密密钥（使用长连接模式时不需要） |

### P2-4. 可执行步骤

#### Step 1：安装飞书 SDK 并实现 `feishu-app` Provider

**影响点**：后端（`apps/channel`）/ 依赖

- 安装依赖：`pnpm add @larksuiteoapi/node-sdk`
- 创建 `apps/channel/src/providers/feishu/feishu-app.provider.ts`：
  - 实现 `ChannelProvider` 接口
  - `providerType = 'feishu-app'`
  - 内部构造 `lark.Client` 实例，启用 token 缓存
  - `send()` 实现：
    - `targetType === 'group'`：调用 `client.im.message.create({ receive_id_type: 'chat_id', ... })`
    - `targetType === 'user'`：调用 `client.im.message.create({ receive_id_type: 'open_id', ... })`
  - `validateConfig()`：尝试获取 `tenant_access_token` 验证凭证有效性
  - 错误分类：token 过期自动重试、限流退避、业务错误分类
- 在 `ChannelProviderRegistry` 中注册新 Provider
- `channel_configs.providerType` 枚举扩展为 `'feishu' | 'feishu-app'`

**FeishuAppProvider 核心结构**：

```typescript
import * as lark from '@larksuiteoapi/node-sdk';

class FeishuAppProvider implements ChannelProvider {
  readonly providerType = 'feishu-app';
  private clientCache = new Map<string, lark.Client>();

  async send(target: ChannelTarget, message: ChannelMessage): Promise<DeliveryResult> {
    const client = this.getOrCreateClient(target.providerConfig);
    const card = this.cardBuilder.build(message);
    const receiveIdType = target.targetType === 'group' ? 'chat_id' : 'open_id';
    const receiveId = String(target.providerConfig.receiveId || '');

    const res = await client.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: {
        receive_id: receiveId,
        content: JSON.stringify(card),
        msg_type: 'interactive',
      },
    });
    // ... 处理响应
  }

  private getOrCreateClient(config: Record<string, unknown>): lark.Client {
    const appId = String(config.appId || '');
    let client = this.clientCache.get(appId);
    if (!client) {
      client = new lark.Client({
        appId,
        appSecret: String(config.appSecret || ''),
        appType: lark.AppType.SelfBuild,
        domain: lark.Domain.Feishu,
      });
      this.clientCache.set(appId, client);
    }
    return client;
  }
}
```

#### Step 2：扩展 channel_configs 配置模型

**影响点**：后端（Schema / DTO / Service）

- `channel-config.schema.ts` 的 `providerConfig` 扩展：

  ```typescript
  // feishu-app 类型的 providerConfig
  {
    appIdEncrypted: string;           // 加密存储
    appSecretEncrypted: string;       // 加密存储
    encryptKeyEncrypted?: string;     // 加密存储（可选）
    receiveId: string;                // chat_id（群聊）或 open_id（个人）
    receiveIdType: 'chat_id' | 'open_id';
  }
  ```

- DTO 新增 `FeishuAppConfigDto` / `UpdateFeishuAppConfigDto`
- `CreateChannelConfigDto.providerType` 扩展为 `'feishu' | 'feishu-app'`
- `ChannelConfigService` 中 `normalizeProviderConfig` / `encryptProviderConfig` / `decryptProviderConfig` 按 providerType 分支处理
- `toResponse()` 脱敏逻辑扩展：`appId` 部分脱敏，`appSecret` 完全隐藏

#### Step 3：事件转发白名单配置化

**影响点**：后端（`message-center-event-consumer.service.ts`）/ 配置

当前 Phase 1 硬编码了 `CHANNEL_FORWARD_EVENT_TYPES = new Set(['orchestration.task.completed'])`，Phase 2 需扩展为 5 种事件。将白名单改为环境变量 / Redis 配置驱动：

- 新增环境变量 `CHANNEL_FORWARD_EVENT_TYPES`（逗号分隔）
- 默认值包含所有已支持事件类型
- 消费者启动时读取配置，运行时可通过 Redis key 动态更新（热加载）
- 不在白名单中的事件仍然正常走 message-center 落库 + WS 推送，只是不转发到 channel stream

#### Step 4：新增 Agent 执行日志事件

**影响点**：后端（`apps/agents` action-logs 模块 + `libs/infra` + `message-center`）

**现状问题**：`AgentActionLogService.record()` 目前只做 MongoDB 写入，没有事件发射。

**方案**：在 action-log 写入后，对关键状态（`completed` / `failed`）发布事件到 message-center stream。

- 在 `libs/infra/src/message-center-events.ts` 新增事件类型：`agent.action.completed`
- 在 `AgentActionLogService.record()` 中，当 `status ∈ {completed, failed}` 且 `contextType === 'orchestration'` 时，发布事件
- 事件 data：
  ```typescript
  {
    receiverId: plan.createdBy,       // 从关联的 plan 获取
    messageType: 'orchestration',
    title: `Agent 执行${statusLabel}`,
    content: `Agent「${agentName}」执行任务「${taskTitle}」${statusLabel}`,
    actionUrl: `/orchestration?planId=${planId}&taskId=${taskId}`,
    priority: status === 'failed' ? 'high' : 'low',
    extra: {
      agentId, agentName, action, contextType, contextId,
      runId, sessionId, durationMs, status,
    },
  }
  ```
- 引入**时间窗口聚合**（见 Step 8）避免高频日志导致消息轰炸

**消息卡片**：
- 新增 `FeishuCardBuilder.buildAgentLogCard(message)` — Agent 日志卡片
- 卡片内容：Agent 名称、任务名称、执行状态、耗时、查看详情按钮

#### Step 5：新增系统告警事件

**影响点**：后端（scheduler 模块 + `libs/infra`）

**现状问题**：scheduler 的 `notifyScheduleFailure()` 使用独立的 `axios.post(SCHEDULER_ALERT_WEBHOOK_URL)`，完全绕过 message-center 和 channel 体系。

**方案**：在现有 axios 告警的基础上，增加向 message-center stream 发布告警事件。

- 在 `libs/infra/src/message-center-events.ts` 新增事件类型：`system.alert.scheduler`
- 修改 `scheduler.service.ts` 的 `notifyScheduleFailure()`：
  - 保留原有 `SCHEDULER_ALERT_WEBHOOK_URL` 逻辑（向下兼容）
  - 新增向 `streams:message-center:events` 发布 `system.alert.scheduler` 事件
  - 事件 data：
    ```typescript
    {
      receiverId: undefined,          // 系统级告警，无特定接收人
      messageType: 'system_alert',
      title: '调度告警',
      content: `调度任务「${scheduleName}」执行失败：${reason}`,
      bizKey: `scheduler:${scheduleId}:dead_letter:${timestamp}`,
      priority: 'high',
      extra: { scheduleId, scheduleName, reason },
    }
    ```
- `receiverId` 为空时，channel dispatcher 仍可匹配（channel_configs 按 eventType 匹配，不依赖 receiverId）

**消息卡片**：
- 新增 `FeishuCardBuilder.buildAlertCard(message)` — 告警卡片（红色/橙色 header）
- 卡片内容：告警级别标签、告警来源、详细原因

#### Step 6：转发会议纪要事件

**影响点**：后端（`message-center-event-consumer.service.ts`）/ 卡片构建

**现状**：`meeting.session.ended` 事件已经发布到 `streams:message-center:events`，但 Phase 1 的 `CHANNEL_FORWARD_EVENT_TYPES` 未包含它。

**方案**：
- 将 `meeting.session.ended` 加入转发白名单
- 注意：会议结束时 summary 数据通常尚未生成（summary 由 agent 异步生成）
- 两种策略（推荐 A）：
  - **A（推荐）- 先推送结束通知，summary 生成后再推送一条**：新增事件类型 `meeting.summary.generated`，在 `MeetingSummaryService` 生成 summary 后发布到 message-center stream
  - B - 延迟推送：等待 summary 生成后统一推送（增加复杂度，且 summary 生成时间不确定）

**策略 A 的具体实现**：
- 会议结束 → `meeting.session.ended` → channel 推送「会议已结束」卡片
- Summary 生成完成 → 新增 `meeting.summary.generated` 事件 → channel 推送「会议纪要」卡片
- 在 `MeetingSummaryService` 中，summary 写入 DB 成功后发布事件到 message-center stream
- 事件 data.extra 携带 `summary.content`、`summary.actionItems`、`summary.decisions`

**消息卡片**：
- 新增 `FeishuCardBuilder.buildMeetingEndedCard(message)` — 会议结束卡片（蓝色 header）
- 新增 `FeishuCardBuilder.buildMeetingSummaryCard(message)` — 会议纪要卡片（含决议/待办列表）

#### Step 7：新增定时报告事件

**影响点**：后端（scheduler 模块 / inner-message 模块）

**现状问题**：定时调度任务（如 `system-engineering-statistics`、`system-cto-daily-requirement-triage`）的执行结果通过 inner-message 系统发送给 agent，agent 生成报告后存储在 agent session 中。整个链路不经过 message-center，无法被 channel 消费。

**方案**：在调度任务的 agent 执行完成后，将产出的报告摘要发布到 message-center stream。

- 新增事件类型：`scheduler.report.generated`
- 触发点：在 `scheduler.service.ts` 的生命周期监控中，当调度任务执行成功且产出了 output 时，发布事件
- 事件 data：
  ```typescript
  {
    receiverId: undefined,          // 报告面向团队，不特定到个人
    messageType: 'orchestration',
    title: `${scheduleName} 执行完成`,
    content: outputSummary.slice(0, 500),  // 报告摘要截取
    actionUrl: `/scheduler/${scheduleId}`,
    priority: 'normal',
    extra: {
      scheduleId, scheduleName, scheduleType,
      executionTime, outputSummary,
    },
  }
  ```

**消息卡片**：
- 新增 `FeishuCardBuilder.buildReportCard(message)` — 定时报告卡片（紫色 header）
- 卡片内容：报告名称、执行时间、摘要内容、查看完整报告按钮

#### Step 8：消息聚合/降频机制

**影响点**：后端（`apps/channel` dispatcher）

Agent 日志事件可能高频产生（一个 orchestration plan 包含多个 task，每个 task 有多个 action log）。逐条推送会造成消息轰炸，需要引入聚合机制。

**方案**：在 `ChannelDispatcherService` 中增加时间窗口聚合：

- 新增 `ChannelAggregatorService`：
  - 按 `eventType + configId` 维度聚合
  - 可配置的时间窗口（默认 60 秒）
  - 窗口内的同类事件合并为一条聚合消息
  - 窗口结束后统一推送

- 聚合逻辑：
  ```
  收到 agent.action.completed 事件
    → 检查是否有该 (eventType, configId) 的活跃窗口
    → 有：将事件追加到窗口缓冲区
    → 无：创建新窗口，设置 60s 定时器
    → 定时器触发：合并窗口内所有事件为一条聚合消息，推送
  ```

- 聚合消息卡片示例：
  ```
  ┌─────────────────────────────┐
  │ 📋 Agent 执行日志汇总        │
  │ 过去 1 分钟共 5 条执行记录    │
  ├─────────────────────────────┤
  │ ✅ 任务A - Agent小明 - 成功   │
  │ ✅ 任务B - Agent小红 - 成功   │
  │ ❌ 任务C - Agent小明 - 失败   │
  │ ... 共 5 条                  │
  ├─────────────────────────────┤
  │ [查看详情]                    │
  └─────────────────────────────┘
  ```

- 哪些事件需要聚合、哪些立即推送：
  | 事件类型 | 推送策略 |
  |---|---|
  | `orchestration.task.completed` | **立即推送**（单条卡片） |
  | `agent.action.completed` | **聚合推送**（60s 窗口） |
  | `system.alert.scheduler` | **立即推送**（告警不延迟） |
  | `meeting.session.ended` | **立即推送** |
  | `meeting.summary.generated` | **立即推送** |
  | `scheduler.report.generated` | **立即推送** |

#### Step 9：卡片模板升级到 Schema 2.0

**影响点**：后端（`feishu-card-builder.ts`）

Phase 1 使用飞书卡片 schema 1.0（`{ config, header, elements }`），Phase 2 统一升级到 schema 2.0（`{ schema: "2.0", config, header, body: { elements } }`）。

- 重构 `FeishuCardBuilder`，按事件类型分发卡片模板：
  - `buildTaskResultCard()` — 任务结果（绿色/红色）
  - `buildAgentLogCard()` — Agent 日志（灰色）
  - `buildAgentLogAggregatedCard()` — Agent 日志聚合（灰色）
  - `buildAlertCard()` — 系统告警（红色/橙色）
  - `buildMeetingEndedCard()` — 会议结束（蓝色）
  - `buildMeetingSummaryCard()` — 会议纪要（蓝色）
  - `buildReportCard()` — 定时报告（紫色）
- `ChannelDispatcherService.buildChannelMessage()` 根据 `eventType` 设置 `contentType` 和路由到对应卡片 builder

#### Step 10：Seed 脚本与环境配置更新

**影响点**：配置 / 运维

- 更新 `.env.example`：
  ```
  # Channel Service - Feishu App (Phase 2)
  FEISHU_APP_ID=                    # 飞书自建应用 App ID
  FEISHU_APP_SECRET=                # 飞书自建应用 App Secret
  FEISHU_APP_ENCRYPT_KEY=           # 事件加密密钥（可选）
  CHANNEL_FORWARD_EVENT_TYPES=orchestration.task.completed,agent.action.completed,system.alert.scheduler,meeting.session.ended,meeting.summary.generated,scheduler.report.generated
  ```
- 更新 `channel-config-seed.ts`：新增 `feishu-app` 类型配置模板
- 保留 Phase 1 的 Webhook 配置，两种模式并存

### P2-5. Phase 2 事件流转全链路

```
                     事件生产方
  ┌──────────────────────────────────────────┐
  │ Orchestration 任务完成                     │ → orchestration.task.completed
  │ Agent Action Log (completed/failed)       │ → agent.action.completed         (新增)
  │ Scheduler 调度失败                         │ → system.alert.scheduler         (新增)
  │ Meeting 结束                              │ → meeting.session.ended          (已有，新增转发)
  │ Meeting Summary 生成                      │ → meeting.summary.generated      (新增)
  │ Scheduler 定时报告完成                     │ → scheduler.report.generated     (新增)
  └──────────────────────────────────────────┘
                       │
                       ▼
           streams:message-center:events               (Redis Stream)
                       │
                       ▼
           MessageCenterEventConsumer                   (legacy app)
             ├── 写入 system_messages + WS 推送
             └── 按白名单转发 → streams:channel:events
                                    │
                                    ▼
                          ChannelDispatcher              (channel app)
                            │
                   ┌────────┴────────┐
                   ▼                 ▼
             立即推送            聚合窗口（60s）
          (task/alert/         (agent.action.*)
           meeting/report)          │
                   │           窗口结束
                   │                │
                   ▼                ▼
            查询 channel_configs 匹配
                   │
           ┌───────┴───────┐
           ▼               ▼
   FeishuWebhook     FeishuApp              (两个 Provider 并存)
   Provider          Provider
   (群 Webhook)      (SDK API)
           │               │
           ▼               ▼
     飞书群消息       飞书群消息 / 个人私聊消息
```

### P2-6. 关键影响点汇总

| 影响范围 | 具体变更 |
|---|---|
| **新增依赖** | `@larksuiteoapi/node-sdk` |
| **新增 Provider** | `feishu-app.provider.ts`（SDK 驱动，支持群聊 + 个人推送） |
| **新增事件类型** | `agent.action.completed`、`system.alert.scheduler`、`meeting.summary.generated`、`scheduler.report.generated` |
| **修改 action-logs** | `AgentActionLogService.record()` 新增事件发布 |
| **修改 scheduler** | `notifyScheduleFailure()` 新增 message-center 事件发布；成功完成时发布报告事件 |
| **修改 meetings** | `MeetingSummaryService` summary 生成后发布事件 |
| **修改 message-center** | 转发白名单配置化（环境变量 / Redis 热加载） |
| **修改 channel dispatcher** | 新增聚合器（`ChannelAggregatorService`） |
| **修改 channel config** | Schema 扩展 `feishu-app` providerConfig；DTO 扩展 |
| **修改 card builder** | 升级 schema 2.0；新增 6 种卡片模板 |
| **修改配置文件** | `.env.example` 新增飞书 App 凭证和转发白名单配置 |
| **前端** | Phase 2 不涉及前端变更 |

### P2-7. 风险与依赖

| 风险 | 应对策略 |
|---|---|
| 飞书自建应用审核流程需要管理员参与 | 提前走审核；Phase 1 Webhook 作为降级方案持续可用 |
| `tenant_access_token` 过期导致推送中断 | SDK 内置 token 缓存和自动刷新；Provider 层增加 token 获取失败重试 |
| Agent 日志高频触发导致飞书 API 限流 | 聚合窗口机制降频；飞书 App API 限流比 Webhook 宽松（通常 50次/秒） |
| 会议 summary 生成时间不确定（依赖 agent 异步执行） | 采用两段推送策略：先推会议结束通知，summary 完成后再推纪要 |
| 多个 channel_config 匹配同一事件导致重复推送 | 属于预期行为（不同群/个人收到同一事件是合理的）；delivery_log 可追踪 |
| `appSecret` 等敏感凭证的安全性 | 复用 Phase 1 的 `EncryptionUtil` 加密存储；API 响应中完全脱敏 |

### P2-8. Phase 2 内部优先级排序

Phase 2 范围较大，建议按以下优先级分批实施：

| 批次 | 内容 | 依赖关系 |
|---|---|---|
| **P2-Batch-1** | Step 1（feishu-app Provider） + Step 2（配置扩展） + Step 9（卡片 2.0） + Step 10（环境配置） | 基础设施，后续所有功能依赖 |
| **P2-Batch-2** | Step 3（白名单配置化） + Step 6（会议纪要转发） | 已有事件，仅需开放转发 + 新增 summary 事件 |
| **P2-Batch-3** | Step 5（系统告警） + Step 7（定时报告） | 需改动 scheduler 模块 |
| **P2-Batch-4** | Step 4（Agent 日志） + Step 8（聚合降频） | Agent 日志需要聚合机制配合，复杂度最高 |

---

## Phase 3：双向交互 — 详细设计

### P3-1. 目标

在 Phase 2 单向推送基础上，实现用户通过飞书与系统的完整双向交互闭环：

1. **入站消息处理**：用户在飞书中 @Bot 或私聊 Bot 发送文本消息，系统解析为指令并执行
2. **卡片交互回调**：用户点击推送卡片上的交互按钮（审批、重试、取消等），系统响应并更新卡片
3. **执行结果回传**：Agent 执行完成后，结果以更新卡片或新消息的形式回传到飞书
4. **用户身份映射**：飞书用户自动关联到系统 Employee，无需重复登录
5. **会话上下文保持**：同一飞书会话中的多轮对话共享上下文

### P3-2. 前置依赖

Phase 3 依赖 Phase 2 的以下能力：

| 依赖 | 说明 |
|---|---|
| `@larksuiteoapi/node-sdk` 已安装 | SDK 的 `EventDispatcher`、`CardActionHandler`、`WSClient` |
| `feishu-app` Provider 已就绪 | 复用 `lark.Client` 实例发送回复消息 |
| 飞书自建应用已创建并审核通过 | Phase 2 已完成应用创建 |

### P3-3. 架构决策

| 决策点 | 结论 | 原因 |
|---|---|---|
| 事件接收模式 | **长连接（WSClient）** 优先，HTTP Webhook 回调为备选 | 长连接无需公网 IP / 域名 / 防火墙白名单，降低部署复杂度 |
| 入站消息入口 | 通过 **Inner-Message Direct** (`sendDirectMessage`) 注入到目标 Agent | 复用现有 agent runtime bridge，inner-message 自动触发 agent 执行 |
| 目标 Agent 选择 | 默认路由到用户的 **Exclusive Assistant Agent** | 每个 Employee 有 1:1 绑定的专属助理（`exclusiveAssistantAgentId`）；指令可通过前缀路由到其他 agent |
| 用户身份映射 | 新增 `channel_user_mappings` 集合，建立 飞书 open_id ↔ employeeId 映射 | 飞书事件携带 `open_id`，需要映射到系统 Employee 才能确定目标 agent 和权限 |
| 会话上下文 | 按飞书 chat_id 维护 `channelSessionId`，映射到 agent session | 同一飞书会话中的多轮对话共享同一 agent session 上下文 |
| 卡片回调模式 | 使用 SDK `CardActionHandler` 处理卡片交互 | 支持按钮点击回调 → 执行系统动作 → 响应更新卡片 |
| 指令解析 | 简单前缀匹配 + 自然语言透传 | MVP 不做复杂 NLU；`/plan`、`/status`、`/cancel` 等前缀指令 + 其他文本直接作为 agent prompt |
| 认证模式 | Channel 服务以 **内部服务身份** 调用后端 API | 使用 `x-user-context` + `x-user-signature` 签名头传递映射后的 employeeId |

### P3-4. 飞书侧配置要求（在 Phase 2 基础上追加）

| 配置项 | 说明 |
|---|---|
| 启用「接收消息」事件 | 事件与回调 → 添加事件 → `im.message.receive_v1` |
| 启用「卡片回传交互」 | 事件与回调 → 回调配置 → 配置卡片请求地址（HTTP 模式）或使用长连接自动注册 |
| 新增权限 | `im:message` — 获取与发送单聊、群组消息；`im:message.p2p_msg` — 获取用户发给机器人的单聊消息 |
| 提交审核 | 权限变更需管理员重新审核 |

### P3-5. 核心概念：身份映射与指令路由

#### 身份映射链

```
飞书用户发送消息
    │
    ▼
飞书事件 (im.message.receive_v1)
    │  携带: open_id, chat_id, message.content
    │
    ▼
ChannelInboundService
    │
    ├─ 查询 channel_user_mappings: open_id → employeeId
    │     │
    │     ├─ 已映射 → 获取 Employee
    │     │     │
    │     │     └─ Employee.exclusiveAssistantAgentId → 目标 Agent
    │     │
    │     └─ 未映射 → 回复卡片引导用户绑定
    │
    ▼
指令解析 & Agent 执行
```

#### 指令路由规则

| 用户输入 | 解析结果 | 系统动作 |
|---|---|---|
| `/plan <描述>` | 创建编排计划 | 调用 `POST /orchestration/plans/from-prompt` |
| `/status [planId]` | 查询计划状态 | 调用 `GET /orchestration/plans/:id` |
| `/cancel <planId>` | 取消运行中的计划 | 调用 `POST /orchestration/runs/:runId/cancel` |
| `/agent <agentName> <消息>` | 指定 Agent 对话 | 向指定 Agent 发送 inner-message |
| `/help` | 显示帮助 | 回复指令帮助卡片 |
| 其他纯文本 | 自然语言对话 | 转发到 Exclusive Assistant Agent 执行 |
| 卡片按钮点击 | 回调交互 | 解析 action.value → 执行对应系统动作 |

### P3-6. 可执行步骤

#### Step 1：建立飞书用户身份映射

**影响点**：后端（`apps/channel`）/ 数据库

- 新增 `channel_user_mappings` 集合：
  ```typescript
  {
    providerType: 'feishu-app';
    externalUserId: string;         // 飞书 open_id
    employeeId: string;             // 系统 Employee ID
    displayName?: string;           // 飞书昵称（缓存）
    boundAt: Date;
    lastActiveAt: Date;
    isActive: boolean;
  }
  ```
  索引：`{ providerType: 1, externalUserId: 1 }` unique；`{ employeeId: 1 }` 

- 新增 `ChannelUserMappingService`：
  - `resolveEmployee(providerType, externalUserId)` → 返回 `{ employeeId, exclusiveAssistantAgentId }` 或 `null`
  - `bindUser(providerType, externalUserId, employeeId)` → 创建映射
  - `unbindUser(providerType, externalUserId)` → 删除映射

- 绑定方式（两种并存）：
  - **A. 管理员预配置**：通过 REST API 或 seed 脚本批量导入 `open_id → employeeId` 映射
  - **B. 用户自助绑定**：未映射用户首次发消息时，Bot 回复一张绑定引导卡片，用户输入系统账号邮箱完成绑定（需验证邮箱匹配）

- REST API：
  - `POST /channel/user-mappings` — 创建映射
  - `GET /channel/user-mappings` — 查询列表
  - `DELETE /channel/user-mappings/:id` — 删除映射
  - `POST /channel/user-mappings/bind-by-email` — 通过邮箱自助绑定

#### Step 2：实现飞书事件监听（入站消息接收）

**影响点**：后端（`apps/channel`）

在 `apps/channel` 中新增入站消息模块：

- 新增 `apps/channel/src/modules/inbound/`：
  - `feishu-event-listener.service.ts` — 飞书事件监听入口
  - `channel-inbound.service.ts` — 入站消息处理核心逻辑
  - `command-parser.service.ts` — 指令解析
  - `inbound.module.ts`

- **`FeishuEventListenerService`**（OnModuleInit）：
  ```typescript
  import * as lark from '@larksuiteoapi/node-sdk';

  // 使用长连接模式（优先）
  onModuleInit() {
    const wsClient = new lark.WSClient({
      appId, appSecret,
      loggerLevel: lark.LoggerLevel.info,
    });

    const eventDispatcher = new lark.EventDispatcher({})
      .register({
        'im.message.receive_v1': (data) => this.handleIncomingMessage(data),
      });

    wsClient.start({ eventDispatcher });
  }
  ```

  - `handleIncomingMessage(data)` 提取：
    - `data.sender.sender_id.open_id` → 飞书用户 ID
    - `data.message.chat_id` → 飞书会话 ID
    - `data.message.chat_type` → `'p2p'`（私聊）或 `'group'`（群聊）
    - `data.message.content` → JSON 解析后获取 `text`
    - `data.message.message_id` → 用于回复引用

  - 群聊场景下，仅处理 @Bot 的消息（检查 `mentions` 字段包含 Bot 的 open_id）
  - 私聊场景下，所有消息都处理

- 飞书事件 3 秒响应限制处理：
  - `handleIncomingMessage` 立即返回空响应（3 秒内）
  - 将消息投入 Redis 队列 `channel:inbound:queue` 异步处理
  - 后台 worker 消费队列，执行指令解析 → agent 执行 → 结果回传

#### Step 3：实现指令解析与路由

**影响点**：后端（`apps/channel`）

- **`CommandParserService`**：

  ```typescript
  interface ParsedCommand {
    type: 'plan' | 'status' | 'cancel' | 'agent' | 'help' | 'chat';
    args: Record<string, string>;
    rawText: string;
  }

  parse(text: string): ParsedCommand {
    if (text.startsWith('/plan '))   return { type: 'plan', args: { prompt: text.slice(6) }, rawText: text };
    if (text.startsWith('/status'))  return { type: 'status', args: { planId: text.slice(8).trim() }, rawText: text };
    if (text.startsWith('/cancel ')) return { type: 'cancel', args: { planId: text.slice(8).trim() }, rawText: text };
    if (text.startsWith('/agent '))  return { type: 'agent', args: parseAgentCommand(text), rawText: text };
    if (text === '/help')            return { type: 'help', args: {}, rawText: text };
    return { type: 'chat', args: { prompt: text }, rawText: text };
  }
  ```

- **`ChannelInboundService`** 路由逻辑：

  | 指令类型 | 执行方式 | 回复方式 |
  |---|---|---|
  | `plan` | 以映射后的 employeeId 身份调用 orchestration API 创建计划 | 回复「计划创建中」卡片 → 计划完成后通过 Phase 2 事件推送结果 |
  | `status` | 调用 orchestration API 查询计划状态 | 直接回复状态卡片 |
  | `cancel` | 调用 orchestration API 取消运行 | 回复「已取消」确认 |
  | `agent` | 向指定 Agent 发送 inner-message direct | 回复「处理中」→ agent 完成后回传结果 |
  | `help` | 本地生成帮助信息 | 回复帮助卡片 |
  | `chat` | 向 Exclusive Assistant Agent 发送 inner-message direct | 回复「处理中」→ agent 完成后回传结果 |

#### Step 4：实现 Agent 执行与结果回传

**影响点**：后端（`apps/channel`）/ inner-message 模块

这是双向交互的核心闭环：用户消息 → Agent 执行 → 结果回传飞书。

- **执行链路**（以 `chat` 类型为例）：

  ```
  用户消息 → CommandParser → type='chat'
    → ChannelInboundService
      → resolveEmployee(open_id) → { employeeId, exclusiveAssistantAgentId }
      → 创建/复用 channel session（按 chat_id 映射）
      → 调用 inner-message direct API:
          {
            senderAgentId: 'system',
            receiverAgentId: exclusiveAssistantAgentId,
            eventType: 'channel.user.message',
            title: '飞书用户消息',
            content: userText,
            payload: {
              channelSource: 'feishu',
              channelChatId: feishuChatId,
              channelMessageId: feishuMessageId,
              channelUserId: openId,
              employeeId,
              sessionId: channelSessionId,
            },
          }
      → Inner-Message Bridge 自动触发 agent 执行
  ```

- **结果回传链路**：

  方案：在 inner-message 的 agent 执行完成回调中，检查 payload 是否包含 `channelSource`，如果是，将 agent output 通过 `FeishuAppProvider` 回传到对应的飞书会话。

  - 修改 `InnerMessageAgentRuntimeBridge`：
    - agent 执行完成后，检查原始 inner-message 的 `payload.channelSource`
    - 如果 `channelSource === 'feishu'`，发布结果到 Redis channel `channel:outbound:feishu`
    - 新增 `ChannelOutboundWorker`（在 channel app 中）消费该 channel
    - Worker 从 payload 中提取 `channelChatId`、`channelMessageId`
    - 调用 `FeishuAppProvider` 发送回复消息（以 `reply` 形式引用原消息）

  - 回复消息格式：
    - 短回复（< 500 字）：直接发送文本/Markdown 消息
    - 长回复（> 500 字）：发送结果摘要卡片 + 「查看完整结果」按钮

- **超时处理**：
  - 用户发送消息后，立即回复「处理中...」提示（如 typing indicator 或简短文本）
  - 设置超时阈值（如 120s），超时后回复「处理超时，请稍后查看」
  - Agent 执行完成后如果已超时，仍然发送结果（作为新消息而非回复）

#### Step 5：实现卡片交互回调

**影响点**：后端（`apps/channel`）/ 卡片构建

Phase 2 推送的卡片目前仅有「查看详情」跳转按钮。Phase 3 增加**回传交互按钮**：

- 在 `FeishuEventListenerService` 中注册 `CardActionHandler`：
  ```typescript
  const cardHandler = new lark.CardActionHandler(
    { encryptKey, verificationToken },
    (data: InteractiveCardActionEvent) => this.handleCardAction(data),
  );
  ```

- 扩展 Phase 2 的推送卡片，增加交互按钮：

  | 卡片类型 | 新增按钮 | 回调 action.value |
  |---|---|---|
  | 任务执行结果（失败） | 「重试」 | `{ action: 'retry_task', planId, taskId }` |
  | 任务执行结果（成功） | 「创建后续计划」 | `{ action: 'create_followup', planId }` |
  | 编排计划推送 | 「取消计划」 | `{ action: 'cancel_plan', planId }` |
  | 系统告警 | 「确认告警」「静默 1 小时」 | `{ action: 'ack_alert', alertId }` / `{ action: 'mute_alert', duration: 3600 }` |
  | Agent 执行中 | 「取消执行」 | `{ action: 'cancel_task', taskId }` |

- **`handleCardAction(data)`** 处理流程：
  1. 从 `data.operator.open_id` 获取操作者 → 通过 user-mapping 解析 employeeId
  2. 从 `data.action.value` 解析 action 类型和参数
  3. 以 employeeId 身份执行对应系统动作
  4. 返回更新后的卡片 JSON（SDK 自动更新原卡片）

- 卡片更新示例（重试任务后）：
  ```
  原卡片：任务「数据分析」执行失败 [重试] [查看详情]
                        ↓ 用户点击「重试」
  更新卡片：任务「数据分析」重试中... ⏳
                        ↓ 重试完成
  新消息卡片：任务「数据分析」重试成功 ✅
  ```

#### Step 6：会话上下文管理

**影响点**：后端（`apps/channel`）/ 数据库

维护飞书会话到 Agent Session 的映射，支持多轮对话上下文连续：

- 新增 `channel_sessions` 集合：
  ```typescript
  {
    providerType: 'feishu-app';
    externalChatId: string;         // 飞书 chat_id
    externalUserId: string;         // 飞书 open_id
    employeeId: string;             // 系统 Employee ID
    agentId: string;                // 目标 Agent ID
    agentSessionId?: string;        // Agent Runtime Session ID
    lastMessageAt: Date;
    messageCount: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }
  ```
  索引：`{ providerType: 1, externalChatId: 1, externalUserId: 1 }` unique

- 新增 `ChannelSessionService`：
  - `getOrCreate(providerType, chatId, userId, agentId)` → 查找或创建 channel session
  - `updateAgentSessionId(channelSessionId, agentSessionId)` → agent 执行后回填 session ID
  - `expire(channelSessionId)` → 会话过期（可配置超时，如 30 分钟无活动）
  - `reset(channelSessionId)` → 用户发送 `/new` 指令时重置会话

- 会话上下文传递：
  - inner-message payload 中携带 `sessionId: channelSession.agentSessionId`
  - Agent Runtime Bridge 使用该 sessionId 复用历史上下文
  - 首次对话时 agentSessionId 为空，agent runtime 自动创建新 session，通过回调回填

#### Step 7：内部服务调用认证桥接

**影响点**：后端（`apps/channel`）

Channel 服务需要代表飞书用户调用后端 API（orchestration、agents 等），需要桥接认证体系：

- 新增 `ChannelAuthBridgeService`：
  - 根据映射后的 `employeeId`，构造 `GatewayUserContext`
  - 使用 `encodeUserContext()` + `signEncodedContext()` 生成签名头
  - 所有出站 HTTP 调用附带 `x-user-context` + `x-user-signature` 头
  - 内部调用走 `LEGACY_SERVICE_URL` / `AGENTS_SERVICE_URL` 等环境变量

- 安全约束：
  - Channel 服务只能代理已完成身份映射的用户
  - 所有代理请求记录 audit log（操作来源标记为 `channel:feishu`）
  - 不代理管理员特权操作（如用户管理、系统配置等）

#### Step 8：飞书侧额外权限与配置

**影响点**：飞书开放平台配置

在 Phase 2 配置基础上追加：

- 新增权限：
  - `im:message` — 获取与发送单聊、群组消息
  - `im:message.p2p_msg` — 获取用户发给机器人的单聊消息
  - `im:message.group_msg`（可选） — 获取群组中 @Bot 的消息
- 新增事件订阅：
  - `im.message.receive_v1` — 接收消息事件
- 配置卡片回调：
  - 长连接模式下自动注册，无需额外配置
  - HTTP 模式下需配置回调请求地址（`https://<domain>/api/channel/feishu/card-callback`）
- 提交管理员审核

- 更新 `.env.example`：
  ```
  # Channel Service - Phase 3
  FEISHU_APP_VERIFICATION_TOKEN=    # 事件验证 Token
  CHANNEL_INBOUND_ENABLED=true      # 是否启用入站消息处理
  CHANNEL_SESSION_TIMEOUT_MINUTES=30  # 会话超时时间（分钟）
  CHANNEL_AGENT_EXECUTE_TIMEOUT_MS=120000  # Agent 执行超时（毫秒）
  ```

### P3-7. Phase 3 双向交互全链路

```
                         入站链路（飞书 → 系统）
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  飞书用户 @Bot / 私聊 Bot                              │
  │       │                                              │
  │       ▼                                              │
  │  im.message.receive_v1 事件                           │
  │       │                                              │
  │       ▼  (长连接 WSClient)                            │
  │  FeishuEventListenerService                          │
  │       │                                              │
  │       ├─ 立即回复「处理中」（3秒内）                      │
  │       └─ 入队 → channel:inbound:queue                 │
  │                    │                                  │
  │                    ▼                                  │
  │           ChannelInboundWorker                        │
  │                    │                                  │
  │        ┌───────────┴───────────┐                      │
  │        ▼                       ▼                      │
  │  resolveEmployee          CommandParser               │
  │  (open_id → employeeId)   (指令解析)                   │
  │        │                       │                      │
  │        ▼                       ▼                      │
  │  ┌─────┴───────────────────────┴─────┐               │
  │  │          路由到执行方式              │               │
  │  ├─ /plan   → Orchestration API      │               │
  │  ├─ /status → Orchestration API      │               │
  │  ├─ /cancel → Orchestration API      │               │
  │  ├─ /agent  → Inner-Message Direct   │               │
  │  ├─ /help   → 本地回复               │               │
  │  └─ (chat)  → Inner-Message Direct   │               │
  │              (→ Exclusive Assistant)  │               │
  │                    │                  │               │
  └────────────────────┼──────────────────┘               │
                       │                                  │
                       ▼                                  │
                                                          │
                         出站链路（系统 → 飞书）              │
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  Agent Runtime 执行完成                                │
  │       │                                              │
  │       ▼                                              │
  │  InnerMessageAgentRuntimeBridge                      │
  │       │                                              │
  │       ├─ 检查 payload.channelSource === 'feishu'      │
  │       └─ 发布到 Redis channel:outbound:feishu         │
  │                    │                                  │
  │                    ▼                                  │
  │           ChannelOutboundWorker                       │
  │                    │                                  │
  │                    ▼                                  │
  │           FeishuAppProvider.send()                    │
  │                    │                                  │
  │                    ▼                                  │
  │           飞书会话中回复结果卡片/消息                     │
  │                                                      │
  └──────────────────────────────────────────────────────┘

                       卡片回调链路
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │  用户点击卡片交互按钮                                   │
  │       │                                              │
  │       ▼                                              │
  │  CardActionHandler（SDK 长连接自动接收）                 │
  │       │                                              │
  │       ▼                                              │
  │  handleCardAction(data)                              │
  │       │                                              │
  │       ├─ 解析 operator.open_id → employeeId           │
  │       ├─ 解析 action.value → { action, params }       │
  │       ├─ 执行系统动作（retry/cancel/ack/...）           │
  │       └─ 返回更新后的卡片 JSON                         │
  │                                                      │
  └──────────────────────────────────────────────────────┘
```

### P3-8. 关键影响点汇总

| 影响范围 | 具体变更 |
|---|---|
| **新增集合** | `channel_user_mappings`（身份映射）、`channel_sessions`（会话映射） |
| **新增 Redis 队列** | `channel:inbound:queue`（入站消息队列）、`channel:outbound:feishu`（出站结果 channel） |
| **新增模块** | `apps/channel/src/modules/inbound/`（事件监听 + 指令解析 + 入站处理） |
| **新增 Service** | `ChannelUserMappingService`、`ChannelSessionService`、`ChannelInboundService`、`CommandParserService`、`ChannelAuthBridgeService`、`FeishuEventListenerService`、`ChannelOutboundWorker` |
| **修改 inner-message bridge** | agent 执行完成后检查 `channelSource` 并发布到出站 channel |
| **修改卡片模板** | Phase 2 卡片增加回传交互按钮（重试/取消/确认等） |
| **修改 feishu-app Provider** | 新增 `reply()` 方法（引用回复原消息） |
| **修改 channel config** | REST API 新增 user-mapping 端点 |
| **修改配置文件** | `.env.example` 新增入站相关配置 |
| **飞书侧** | 新增权限（im:message）+ 事件订阅（im.message.receive_v1） |
| **前端** | Phase 3 不涉及前端变更（交互完全在飞书内完成） |

### P3-9. 风险与依赖

| 风险 | 应对策略 |
|---|---|
| 飞书事件需 3 秒内响应，Agent 执行远超此时间 | 入站消息立即入队异步处理，3 秒内返回空响应；发送「处理中」提示后异步回传结果 |
| 长连接断开导致消息丢失 | SDK 内置重连机制；关键消息落库 + 队列化；可监控连接状态并告警 |
| 用户身份映射不存在时无法执行 | 返回绑定引导卡片；管理员可预配置批量映射 |
| Agent 执行超时用户无反馈 | 120s 超时后主动回复超时提示；后台完成后仍发送结果 |
| 群聊中多人 @Bot 造成并发压力 | 入站队列自然限流；按用户 + 会话维度串行处理防止上下文混乱 |
| 卡片回调需要公网可达（HTTP 模式） | 优先使用长连接模式（无需公网 IP）；HTTP 模式下需配置反向代理 |
| 代理认证存在安全风险（channel 代表用户执行） | 仅代理已绑定用户；限制可代理操作范围；audit log 记录所有代理请求 |
| 飞书 open_id 与系统 employeeId 多对一映射 | 一个飞书用户只能绑定一个 employeeId；绑定时验证邮箱唯一性 |

### P3-10. Phase 3 内部优先级排序

| 批次 | 内容 | 依赖关系 |
|---|---|---|
| **P3-Batch-1** | Step 1（用户身份映射） + Step 7（认证桥接） + Step 8（飞书权限配置） | 基础设施，后续所有功能依赖 |
| **P3-Batch-2** | Step 2（事件监听） + Step 3（指令解析） + Step 6（会话管理） | 入站链路核心，依赖 Batch-1 |
| **P3-Batch-3** | Step 4（Agent 执行与结果回传） | 出站闭环，依赖 Batch-2 完成入站链路 |
| **P3-Batch-4** | Step 5（卡片交互回调） | 增强体验，依赖 Phase 2 卡片已推送 + Batch-1 身份映射 |
