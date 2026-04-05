# 飞书 Bot 会议参与能力 Plan

## 1. 背景

当前飞书 Bot（`apps/channel` Phase 3）已实现双向交互：入站指令（`/plan`、`/status`、`/cancel`、`/agent`、`chat`）和出站推送（任务结果、Agent 日志、系统告警、会议通知等）。但会议相关能力仅限于**出站通知**（会议结束、会议纪要卡片推送），人类员工无法通过飞书 Bot 参与会议。

目标是让已绑定的飞书用户能够通过 Bot 完成会议核心操作，实现"飞书内参会"的闭环体验。

### 前置依赖

本 Plan 依赖 **MEETING_REMOVE_EMPLOYEE_PROXY_PLAN**（会议系统移除 Employee 代理发言机制）先行完成。完成后，employee 直接以自身身份在会议中发言（`senderType = 'employee'`），飞书侧以员工身份调用 `POST /meetings/:id/messages` 即可；relay 侧自消息过滤统一按 `senderType === 'employee' && senderId === employeeId` 判断。

## 2. 整体架构

### 命令体系（两级命令）

本次开发同时将命令解析器从扁平一级结构**重构为两级命令体系**。原有一级命令（`/plan`、`/status`、`/cancel` 等）语义不够明确（如 `/cancel` 没有表达操作对象），且扩展性差。两级命令以 `/领域 子命令 [参数]` 的格式组织，语义清晰、按领域分组、便于扩展。

#### 全局命令（保持一级）

| 命令 | type | 说明 |
|---|---|---|
| `/help` | `help` | 显示帮助信息 |
| `/bind token:<token>` | `bind` | 绑定账号 |
| 纯文本 | `chat` | Agent 对话 / 会议发言（会议模式下） |

#### 两级命令

| 命令 | type | 说明 |
|---|---|---|
| `/plan new <需求>` | `plan_new` | 创建计划 |
| `/plan status <planId>` | `plan_status` | 查询计划状态 |
| `/plan cancel <id>` | `plan_cancel` | 取消运行 |
| `/agent chat <agentId> <消息>` | `agent_chat` | 指定 Agent 对话 |
| `/session reset` | `session_reset` | 重置当前会话上下文 |
| `/meeting list` | `meeting_list` | 查看进行中的会议 |
| `/meeting create <标题>` | `meeting_create` | 创建临时会议 |
| `/meeting join <meetingId>` | `meeting_join` | 加入会议（进入会议模式） |
| `/meeting leave` | `meeting_leave` | 离开当前会议 |
| `/meeting end` | `meeting_end` | 结束当前会议 |

### 消息流转

```
飞书用户发送 /meeting join xxx
    │
    ▼
FeishuEventListenerService (WSClient)
    │
    ▼
ChannelInboundWorkerService (Redis 队列消费)
    │
    ▼
ChannelInboundService.handleInboundEvent()
    ├─ CommandParser.parse() → type = meeting_join（两级解析）
    ├─ resolveEmployee() → employeeId
    └─ routeCommand()
         ├─ plan_new     → POST /api/orchestration/plans/from-prompt
         ├─ plan_status  → GET  /api/orchestration/plans/{planId}
         ├─ plan_cancel  → POST /api/orchestration/runs/{runId}/cancel
         ├─ agent_chat   → POST /api/inner-messages/direct
         ├─ session_reset→ session.reset()
         ├─ meeting_list  → GET  /api/meetings?status=active
         ├─ meeting_create→ POST /api/meetings
         ├─ meeting_join  → POST /api/meetings/:id/join + startRelay + session 写入 activeMeetingId
         ├─ meeting_leave → POST /api/meetings/:id/leave + stopRelay + session 清除 activeMeetingId
         └─ meeting_end   → POST /api/meetings/:id/end

会议消息实时转发（join 后激活）：
    Redis subscribe meeting:{meetingId}
        │ 收到 message 事件
        ▼
    ChannelMeetingRelayService
        │ 过滤自己的消息 + 合并窗口
        ▼
    FeishuAppProvider.replyText() → 飞书会话
```

## 3. 可执行步骤

### Step 1：重构命令解析器为两级架构

**影响点**：`apps/channel/src/modules/inbound/command-parser.service.ts`

将现有扁平解析重构为两级解析。`ParsedChannelCommandType` 更新为：

```typescript
type ParsedChannelCommandType =
  // 全局命令（一级）
  | 'help'
  | 'bind'
  | 'chat'
  // plan 领域
  | 'plan_new'
  | 'plan_status'
  | 'plan_cancel'
  // agent 领域
  | 'agent_chat'
  // session 领域
  | 'session_reset'
  // meeting 领域
  | 'meeting_list'
  | 'meeting_create'
  | 'meeting_join'
  | 'meeting_leave'
  | 'meeting_end';
```

解析规则：

```
1. 非 / 开头 → type = 'chat', args = { prompt: rawText }
2. / 开头，取第一个词判断：
   ├─ /help  → type = 'help'
   ├─ /bind  → type = 'bind', 解析 token/email
   ├─ /plan  → 取第二个词：
   │    ├─ new     → type = 'plan_new',    args = { prompt: rest }
   │    ├─ status  → type = 'plan_status', args = { planId: rest }
   │    ├─ cancel  → type = 'plan_cancel', args = { id: rest }
   │    └─ 其他/缺失 → type = 'unknown_command'
   ├─ /agent → 取第二个词：
   │    ├─ chat    → type = 'agent_chat',  args = { agentId, prompt }
   │    └─ 其他/缺失 → type = 'unknown_command'
   ├─ /session → 取第二个词：
   │    ├─ reset   → type = 'session_reset'
   │    └─ 其他/缺失 → type = 'unknown_command'
   ├─ /meeting → 取第二个词：
   │    ├─ list    → type = 'meeting_list'
   │    ├─ create  → type = 'meeting_create', args = { title: rest }
   │    ├─ join    → type = 'meeting_join',   args = { meetingId: rest }
   │    ├─ leave   → type = 'meeting_leave'
   │    ├─ end     → type = 'meeting_end'
   │    └─ 其他/缺失 → type = 'unknown_command'
   └─ 其他 → type = 'unknown_command'
```

- 新增 `unknown_command` 类型，路由层统一回复帮助文案
- `/agent chat <agentId> <msg>` 中 `agentId` 和 `msg` 的拆分复用现有 `parseAgentArgs()` 逻辑

### Step 2：同步更新路由层的 type 引用

**影响点**：`apps/channel/src/modules/inbound/channel-inbound.service.ts`

`routeCommand()` 中所有 case 分支更新为新 type：

| 旧 type | 新 type | 逻辑变更 |
|---|---|---|
| `plan` | `plan_new` | 无，仅 type 名变更 |
| `status` | `plan_status` | 无 |
| `cancel` | `plan_cancel` | 无 |
| `agent` | `agent_chat` | 无 |
| `new` | `session_reset` | 无 |
| `help` | `help` | 不变 |
| `bind` | `bind` | 不变 |
| `chat` | `chat` | 不变 |

新增 `unknown_command` 分支：回复「未知指令，输入 /help 查看可用命令」。

同步更新 `command-parser.service.spec.ts` 测试用例。

### Step 3：扩展 Channel Session 模型

**影响点**：`apps/channel/src/modules/inbound/schemas/channel-session.schema.ts` + `channel-session.service.ts`

`channel_sessions` 新增可选字段：

```typescript
@Prop()
activeMeetingId?: string;   // 当前参与的会议 ID
```

`ChannelSessionService` 新增方法：

```typescript
async setActiveMeeting(filter: SessionFilter, meetingId: string): Promise<void>
async clearActiveMeeting(filter: SessionFilter): Promise<void>
async getActiveMeetingId(filter: SessionFilter): Promise<string | undefined>
```

`SessionFilter` 复用现有的 `{ providerType, externalChatId, externalUserId }` 维度。

### Step 4：实现会议指令路由

**影响点**：`apps/channel/src/modules/inbound/channel-inbound.service.ts`

在 `routeCommand` 中新增会议指令分支：

#### meeting_list

```typescript
const meetings = await this.callApiAsUser(employeeId, {
  method: 'get',
  url: '/api/meetings',
  params: { status: 'active' },
});
// 格式化为文本列表：序号、标题、ID、参与人数
// 若无进行中的会议，回复「当前没有进行中的会议」
```

#### meeting_create

```typescript
const meeting = await this.callApiAsUser(employeeId, {
  method: 'post',
  url: '/api/meetings',
  data: {
    title: args.title,
    type: 'ad_hoc',
    hostId: employeeId,
    hostType: 'employee',
  },
});
// 回复「会议已创建：{title}（{meetingId}），使用 /meeting join {meetingId} 加入」
```

#### meeting_join

```typescript
// 1. 加入会议
await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${meetingId}/join`,
  data: { id: employeeId, type: 'employee' },
});

// 2. session 写入 activeMeetingId
await this.sessionService.setActiveMeeting(sessionFilter, meetingId);

// 3. 启动实时消息转发
await this.meetingRelayService.startRelay({
  meetingId,
  chatId: event.externalChatId,
  employeeId: resolved.employeeId,
});

// 4. 获取最近 N 条消息作为上下文摘要推送
const detail = await this.callApiAsUser(employeeId, {
  method: 'get',
  url: `/api/meetings/${meetingId}`,
});
// 推送：参与者列表 + 最近消息摘要

// 5. 回复提示
// 「已加入会议「{title}」，当前进入会议模式——直接输入文字即为发言，/meeting leave 退出会议。」
```

#### meeting_leave

```typescript
const meetingId = await this.sessionService.getActiveMeetingId(sessionFilter);
if (!meetingId) {
  // 回复「你当前不在任何会议中」
  return;
}

await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${meetingId}/leave`,
  data: { id: employeeId, type: 'employee' },
});

// 停止实时转发
await this.meetingRelayService.stopRelay(meetingId, resolved.employeeId);

// 清除 session
await this.sessionService.clearActiveMeeting(sessionFilter);

// 回复「已离开会议，恢复正常对话模式。」
```

#### meeting_end

```typescript
const meetingId = await this.sessionService.getActiveMeetingId(sessionFilter);
if (!meetingId) {
  // 回复「你当前不在任何会议中」
  return;
}

await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${meetingId}/end`,
});

// relay 和 session 由 relay 服务监听到 status_changed → ended 后自动清理
// 回复「会议已结束。」
```

### Step 5：会议消息实时转发到飞书

**影响点**：新增 `apps/channel/src/modules/inbound/channel-meeting-relay.service.ts`

这是体验的核心——用户在飞书参与会议时，需要看到其他参与者的发言。

#### 核心设计

```typescript
@Injectable()
export class ChannelMeetingRelayService implements OnModuleDestroy {
  // 活跃的 relay 映射：key = `${meetingId}:${employeeId}`
  private activeRelays = new Map<string, RelayContext>();

  /**
   * 启动转发：订阅 Redis 频道 meeting:{meetingId}
   */
  async startRelay(input: {
    meetingId: string;
    chatId: string;       // 飞书 chat_id
    employeeId: string;
  }): Promise<void>

  /**
   * 停止转发：取消 Redis 订阅，清理上下文
   */
  async stopRelay(meetingId: string, employeeId: string): Promise<void>

  /**
   * 模块销毁时清理所有订阅
   */
  onModuleDestroy(): void
}
```

#### 消息过滤与格式化

收到 Redis `meeting:{meetingId}` 频道的 `message` 事件后：

1. **过滤自己的消息**：检查 `senderType === 'employee' && senderId === employeeId`，跳过自己发的
2. **过滤系统消息**：`senderType === 'system'` 的消息按需过滤或简化
3. **格式化**：`[发言者名称] 内容`
4. **推送**：调用 `FeishuAppProvider.replyText(chatId, text)`

#### 防刷合并

会议消息可能短时间内密集产生（多个 Agent 同时响应），设置合并窗口：

- 每条消息不立即推送，先放入 1.5 秒缓冲窗口
- 窗口内的多条消息合并为一条推送：
  ```
  [Agent-小明] 我认为可以从技术架构入手...
  [Agent-小红] 同意，补充一下测试策略...
  ```
- 窗口结束后统一调用一次 `replyText`
- 设置 buffer 上限（10 条）或最大等待时间（3 秒），防止持续流入时 buffer 无限增长

#### 会议结束自动清理

监听 `status_changed` 事件，当 `status === 'ended'` 时：

1. 停止该会议的所有 relay
2. 向对应的飞书会话推送「会议已结束」
3. 清除相关 session 的 `activeMeetingId`

#### 服务重启恢复

channel 服务重启时，从 `channel_sessions` 查询所有 `activeMeetingId` 不为空的 session，重新建立 relay 订阅。需在 `OnModuleInit` 中执行。

### Step 6：纯文本直接发言模式

**影响点**：`channel-inbound.service.ts` 指令路由逻辑

当用户处于会议中时（`activeMeetingId` 存在），非指令的纯文本消息改为直接发送到会议：

```typescript
// routeCommand 入口处，parsed.type === 'chat' 时
if (parsed.type === 'chat') {
  const activeMeetingId = await this.sessionService.getActiveMeetingId(sessionFilter);
  if (activeMeetingId) {
    // 转为会议发言
    await this.callApiAsUser(resolved.employeeId, {
      method: 'post',
      url: `/api/meetings/${activeMeetingId}/messages`,
      data: {
        senderId: resolved.employeeId,
        senderType: 'employee',
        content: parsed.args.prompt,
        type: 'opinion',
      },
    });
    return; // 不回复，消息已入会议流
  }
  // 否则走原有 Agent 对话逻辑
}
```

**保留指令优先级**：所有 `/` 开头的指令（包括 `/meeting leave`、`/help` 等）仍然正常解析，不受会议模式影响。只有纯文本才走会议发言。

### Step 7：更新 `/help` 指令

**影响点**：`channel-inbound.service.ts` help 回复文本

更新帮助文案为两级命令格式：

```
可用指令：

计划：
  /plan new <需求描述>     - 创建计划
  /plan status <planId>   - 查询计划状态
  /plan cancel <id>       - 取消运行

对话：
  /agent chat <agentId> <消息> - 指定 Agent 对话

会话：
  /session reset           - 重置当前会话上下文

会议：
  /meeting list            - 查看进行中的会议
  /meeting create <标题>    - 创建临时会议
  /meeting join <meetingId> - 加入会议（进入会议模式）
  /meeting leave           - 离开当前会议
  /meeting end             - 结束当前会议

其他：
  /bind token:<token>      - 绑定账号
  /help                    - 显示此帮助
```

若用户当前处于会议中，在帮助信息末尾追加提示：

```
你当前在会议「{title}」中，直接输入文字即为发言。
```

## 4. 关键影响点汇总

| 范围 | 具体变更 |
|---|---|
| `command-parser.service.ts` | **重构**为两级解析架构，所有命令 type 更新 |
| `command-parser.service.spec.ts` | 同步更新测试用例适配新 type |
| `channel-inbound.service.ts` | `routeCommand()` 所有 case 分支更新为新 type + 新增会议指令路由 + 纯文本会议发言 + `unknown_command` 处理 |
| `channel-session.schema.ts` | 新增可选字段 `activeMeetingId` |
| `channel-session.service.ts` | 新增 `setActiveMeeting` / `clearActiveMeeting` / `getActiveMeetingId` 方法 |
| 新增 `channel-meeting-relay.service.ts` | 会议消息 Redis 订阅 → 飞书转发、合并窗口、自动清理、重启恢复 |
| `inbound.module.ts` | 注册 `ChannelMeetingRelayService` |
| Help 文案 | 更新为两级命令分组格式 |
| Meeting API | **不改动**，完全复用现有 REST API |
| 前端 | **不涉及** |
| 数据库 | `channel_sessions` 新增可选字段，无 breaking change |

## 5. 风险与应对

| 风险 | 应对策略 |
|---|---|
| 命令重构影响现有功能 | Step 1-2 先完成并通过测试，再开发会议功能 |
| 会议消息高频导致飞书消息轰炸 | 1.5 秒合并窗口（上限 10 条 / 3 秒强刷）+ 用户可 `/meeting leave` 随时退出 |
| Redis 订阅生命周期管理 | 会议结束自动清理；channel 重启时从 session 恢复 |
| 纯文本直接发言可能误触 | join 时明确提示「进入会议模式」；`/` 指令不受影响 |
| 多个飞书会话同时参与不同会议 | `activeMeetingId` 按 `chatId + userId` 维度隔离 |
| 飞书文本体验不如前端页面 | join 时推送最近消息摘要 + 参与者列表；复杂操作引导回前端 |
| 会议中 Agent 响应延迟感知差 | 可选：收到 `agent_state_changed` → `thinking` 时推送「Agent 思考中...」提示（后续迭代） |
| channel 服务重启导致 relay 断开 | `OnModuleInit` 从 DB 恢复活跃 session 的 relay 订阅 |

## 6. MVP 边界（不做的事）

| 不做 | 原因 |
|---|---|
| 飞书卡片形式的会议消息 | 先用纯文本，卡片需要设计复杂模板，后续可升级 |
| `@` 提及特定 Agent | 飞书 `@` 语法与系统内不同，暂不适配 |
| 会议创建时邀请参与者 | 先创建空会议，后续可扩展 `/meeting invite <agentId>` |
| 暂停/恢复会议 | 低频操作，留在前端 |
| 会议内撤回消息 | 飞书侧无法 recall 已发送的消息，体验不完整 |
| Agent 思考状态提示 | 有实现价值但非必要，放到后续迭代 |
| `/meeting say` 显式发言指令 | 会议模式下纯文本直接发言已覆盖此场景，无需额外指令 |
| 旧命令向后兼容 | 命令系统尚未上线使用，无需兼容过渡 |

## 7. 后续迭代方向

- `/meeting invite <agentId>` — 邀请 Agent 加入会议
- 会议消息卡片化 — 使用飞书卡片展示发言者头像、角色、消息类型
- Agent thinking 状态提示 — 推送「Agent 思考中...」动态状态
- 会议摘要主动推送 — 会议结束后自动推送纪要到参会飞书用户
- 飞书群与会议绑定 — 在飞书群中自动关联系统会议，群消息即会议发言
- 分领域帮助 — `/help meeting`、`/help plan` 等子帮助
