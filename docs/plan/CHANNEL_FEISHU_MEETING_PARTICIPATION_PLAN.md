# 飞书作为会议客户端 — 双向同步 Plan

## 1. 背景

当前飞书 Bot（`apps/channel` Phase 3）已实现双向交互：入站指令和出站推送。但存在两个核心问题：

1. **会议能力缺失**：会议相关能力仅限于出站通知（会议结束、纪要卡片推送），人类员工无法通过飞书参与会议
2. **1:1 聊天不留痕**：飞书私聊中与 agent 的对话走 `inner-messages/direct` 链路，消息存在 inner-message 体系，无法在系统前端查看历史

### 目标

**将飞书定位为会议系统的客户端**，与前端平等：

- 飞书中与 agent 的 1:1 聊天，自动关联到系统会议中持久化
- 飞书中可以加入多 agent 会议
- 会议消息在飞书与前端之间**双向同步**——无论从哪端发言，另一端实时可见
- 系统前端可查看所有会议历史（包括通过飞书发起的 1:1 对话）

### 前置依赖

本 Plan 依赖 **MEETING_REMOVE_EMPLOYEE_PROXY_PLAN**（会议系统移除 Employee 代理发言机制）先行完成。完成后，employee 直接以自身身份在会议中发言（`senderType = 'employee'`），消息链路不再经过专属助理 Agent 代理改写。

## 2. 核心设计

### 2.1 统一消息载体：会议

所有 agent 对话（无论从飞书还是前端发起）都以**会议**为消息载体：

| 场景 | 会议形态 |
|---|---|
| 飞书私聊中与某个 agent 聊天 | 自动创建/复用 1:1 会议（employee + 该 agent） |
| 飞书中 `/agent chat <agentId> <msg>` | 同上，切换到对应 agent 的 1:1 会议 |
| 飞书中 `/meeting join <id>` | 加入已有的多人会议 |
| 飞书中 `/meeting create <标题>` | 创建新的多人会议 |
| 前端会议页面发言 | 直接写入会议（现有逻辑不变） |

### 2.2 双向消息同步

消息统一走 `POST /meetings/:id/messages` → 落库 → Redis publish `meeting:{meetingId}`。飞书和前端都订阅同一频道：

```
飞书端 employee 发言
  → POST /meetings/:id/messages (metadata.source = 'feishu')
  → 落库
  → Redis publish meeting:{meetingId}
      ├→ 前端 WebSocket 实时显示                    ✓
      └→ Channel Relay 收到，source=feishu 跳过      ✓（不回显）

前端 employee 发言
  → POST /meetings/:id/messages (metadata.source = 'web')
  → 落库
  → Redis publish meeting:{meetingId}
      ├→ 前端 WebSocket 实时显示                    ✓
      └→ Channel Relay 收到，source=web 转发飞书     ✓

Agent 响应（triggerAgentResponses）
  → sendMessage (metadata.source = 'system')
  → 落库
  → Redis publish meeting:{meetingId}
      ├→ 前端 WebSocket 实时显示                    ✓
      └→ Channel Relay 收到，source=system 转发飞书  ✓
```

**Relay 过滤规则**：只跳过 `metadata.source === 'feishu' && senderType === 'employee' && senderId === 当前飞书用户的 employeeId` 的消息（避免自己飞书发的消息回显到飞书）。其余消息（前端发言、agent 响应、其他参与者发言）全部转发到飞书。

### 2.3 1:1 会议自动管理

用户在飞书中与 agent 聊天时，系统自动管理会议生命周期：

```
飞书用户发送纯文本 / /agent chat <agentId> <msg>
  │
  ▼
resolveOrCreateOneOnOneMeeting(employeeId, agentId)
  ├─ 查找：该 employee + 该 agent 的活跃 1:1 会议
  │   （status = active, type = 'one_on_one', 参与者匹配）
  ├─ 有 → 复用，返回 meetingId
  └─ 无 → 自动创建：
         POST /api/meetings
         {
           title: '与 {agentName} 的对话',
           type: 'one_on_one',
           hostId: employeeId,
           hostType: 'employee',
           participants: [{ id: agentId, type: 'agent' }]
         }
         → 启动 relay
         → session 写入 activeMeetingId
         → 返回 meetingId
  │
  ▼
POST /meetings/:meetingId/messages
  → agent 在会议中响应
  → relay 推回飞书
```

**会议生命周期**：

| 事件 | 行为 |
|---|---|
| 用户发送纯文本 / `/agent chat` | 自动创建或复用 1:1 会议 |
| `/session reset` | 结束当前 1:1 会议（`POST /meetings/:id/end`），清除 session |
| Session 超时（30 分钟无消息） | 下次消息时自动创建新会议 |
| `/agent chat <另一个agentId>` | 如果切换了 agent，结束当前会议，创建新的 1:1 会议 |
| `/meeting join <id>` | 切换到多人会议模式，1:1 会议暂不结束（leave 后可恢复） |

### 2.4 消息来源标记

所有写入会议的消息在 `metadata` 中携带 `source` 字段：

| source 值 | 含义 |
|---|---|
| `'feishu'` | 从飞书端发送 |
| `'web'` | 从前端页面发送 |
| `'system'` | 系统/Agent 自动生成 |

该字段由调用方在 `POST /meetings/:id/messages` 时传入。前端现有的发送逻辑需补充 `metadata.source = 'web'`。

### 2.5 飞书端消息格式

Relay 将会议消息推到飞书时的格式：

```
[Agent-小明] 我认为可以从技术架构入手...     ← agent 发言
[你·网页] 我补充一下测试方面的考虑           ← 自己从前端发的
[张三] 同意这个方案                          ← 其他 employee 发言（多人会议场景）
```

- Agent 发言：`[{agentName}] {content}`
- 自己从前端发的：`[你·网页] {content}`（让飞书端知道这是自己在另一端说的）
- 其他 employee 发言：`[{employeeName}] {content}`

## 3. 命令体系（两级命令）

本次开发同时将命令解析器从扁平一级结构**重构为两级命令体系**。原有一级命令（`/plan`、`/status`、`/cancel` 等）语义不够明确（如 `/cancel` 没有表达操作对象），且扩展性差。两级命令以 `/领域 子命令 [参数]` 的格式组织，语义清晰、按领域分组、便于扩展。

### 全局命令（保持一级）

| 命令 | type | 说明 |
|---|---|---|
| `/help` | `help` | 显示帮助信息 |
| `/bind token:<token>` | `bind` | 绑定账号 |
| 纯文本 | `chat` | Agent 对话（自动关联 1:1 会议） / 多人会议发言（会议模式下） |

### 两级命令

| 命令 | type | 说明 |
|---|---|---|
| `/plan new <需求>` | `plan_new` | 创建计划 |
| `/plan status <planId>` | `plan_status` | 查询计划状态 |
| `/plan cancel <id>` | `plan_cancel` | 取消运行 |
| `/agent chat <agentId> <消息>` | `agent_chat` | 指定 Agent 对话（自动关联 1:1 会议） |
| `/session reset` | `session_reset` | 重置会话（结束当前 1:1 会议） |
| `/meeting list` | `meeting_list` | 查看进行中的会议 |
| `/meeting create <标题>` | `meeting_create` | 创建多人会议 |
| `/meeting join <meetingId>` | `meeting_join` | 加入会议（进入会议模式） |
| `/meeting leave` | `meeting_leave` | 离开当前会议 |
| `/meeting end` | `meeting_end` | 结束当前会议 |

## 4. 可执行步骤

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
  | 'meeting_end'
  // 错误
  | 'unknown_command';
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

同步更新 `command-parser.service.spec.ts` 测试用例。

### Step 2：同步更新路由层的 type 引用

**影响点**：`apps/channel/src/modules/inbound/channel-inbound.service.ts`

`routeCommand()` 中所有 case 分支更新为新 type：

| 旧 type | 新 type | 逻辑变更 |
|---|---|---|
| `plan` | `plan_new` | 无，仅 type 名变更 |
| `status` | `plan_status` | 无 |
| `cancel` | `plan_cancel` | 无 |
| `agent` | `agent_chat` | **重大变更**：改为走会议消息链路（见 Step 5） |
| `new` | `session_reset` | 新增结束当前 1:1 会议逻辑 |
| `help` | `help` | 不变 |
| `bind` | `bind` | 不变 |
| `chat` | `chat` | **重大变更**：改为走会议消息链路（见 Step 5） |

新增 `unknown_command` 分支：回复「未知指令，输入 /help 查看可用命令」。

### Step 3：扩展 Channel Session 模型

**影响点**：`apps/channel/src/modules/inbound/schemas/channel-session.schema.ts` + `channel-session.service.ts`

`channel_sessions` 新增可选字段：

```typescript
@Prop()
activeMeetingId?: string;       // 当前关联的会议 ID

@Prop()
activeMeetingType?: string;     // 'one_on_one' | 'ad_hoc' 等，用于区分自动创建的 1:1 和手动加入的多人会议
```

`ChannelSessionService` 新增方法：

```typescript
async setActiveMeeting(filter: SessionFilter, meetingId: string, meetingType: string): Promise<void>
async clearActiveMeeting(filter: SessionFilter): Promise<void>
async getActiveMeeting(filter: SessionFilter): Promise<{ meetingId: string; meetingType: string } | undefined>
```

`SessionFilter` 复用现有的 `{ providerType, externalChatId, externalUserId }` 维度。

### Step 4：实现 1:1 会议自动管理服务

**影响点**：新增 `apps/channel/src/modules/inbound/channel-meeting-auto.service.ts`

封装 1:1 会议的自动创建/复用/切换逻辑：

```typescript
@Injectable()
export class ChannelMeetingAutoService {

  /**
   * 为 employee 与 agent 的 1:1 对话获取或创建会议
   * - 查找活跃的 one_on_one 会议（匹配 employee + agent）
   * - 找到 → 返回 meetingId
   * - 没找到 → 创建新会议，返回 meetingId
   */
  async resolveOrCreateOneOnOneMeeting(input: {
    employeeId: string;
    agentId: string;
    sessionFilter: SessionFilter;
    chatId: string;          // 飞书 chatId，用于启动 relay
  }): Promise<string>       // 返回 meetingId

  /**
   * 切换 agent 时，结束旧 1:1 会议，创建新的
   */
  async switchAgent(input: {
    employeeId: string;
    newAgentId: string;
    currentMeetingId: string;
    sessionFilter: SessionFilter;
    chatId: string;
  }): Promise<string>       // 返回新 meetingId

  /**
   * 结束当前 1:1 会议（session reset 时调用）
   */
  async endOneOnOneMeeting(input: {
    meetingId: string;
    employeeId: string;
    sessionFilter: SessionFilter;
  }): Promise<void>
}
```

内部调用 `callApiAsUser` 访问 Meeting REST API，不直接依赖 meeting module。

### Step 5：改造 `chat` 和 `agent_chat` 路由为会议消息链路

**影响点**：`apps/channel/src/modules/inbound/channel-inbound.service.ts`

这是最核心的变更——将 1:1 agent 聊天从 inner-message 链路切换到会议消息链路。

#### chat（纯文本）路由

```typescript
case 'chat': {
  const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);

  if (activeMeeting) {
    // 已有活跃会议（1:1 或多人），消息写入会议
    await this.callApiAsUser(employeeId, {
      method: 'post',
      url: `/api/meetings/${activeMeeting.meetingId}/messages`,
      data: {
        senderId: employeeId,
        senderType: 'employee',
        content: parsed.args.prompt,
        type: 'opinion',
        metadata: { source: 'feishu' },
      },
    });
    return; // 不回复，relay 会转发 agent 响应
  }

  // 无活跃会议 → 自动创建 1:1 会议（使用默认 agent）
  const agentId = resolved.exclusiveAssistantAgentId;
  if (!agentId) {
    await this.reply(chatId, '未绑定默认 Agent，请使用 /agent chat <agentId> 指定');
    return;
  }

  const meetingId = await this.meetingAutoService.resolveOrCreateOneOnOneMeeting({
    employeeId, agentId, sessionFilter, chatId: event.externalChatId,
  });

  await this.callApiAsUser(employeeId, {
    method: 'post',
    url: `/api/meetings/${meetingId}/messages`,
    data: {
      senderId: employeeId,
      senderType: 'employee',
      content: parsed.args.prompt,
      type: 'opinion',
      metadata: { source: 'feishu' },
    },
  });
  return;
}
```

#### agent_chat 路由

```typescript
case 'agent_chat': {
  const { agentId, prompt } = parsed.args;
  const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);

  // 检查是否需要切换 agent
  if (activeMeeting && activeMeeting.meetingType === 'one_on_one') {
    // 如果当前 1:1 会议的 agent 不同，先切换
    const currentAgentId = await this.getCurrentMeetingAgentId(activeMeeting.meetingId);
    if (currentAgentId !== agentId) {
      const newMeetingId = await this.meetingAutoService.switchAgent({
        employeeId, newAgentId: agentId,
        currentMeetingId: activeMeeting.meetingId,
        sessionFilter, chatId: event.externalChatId,
      });
      activeMeeting.meetingId = newMeetingId;
    }
  } else if (!activeMeeting) {
    // 无活跃会议 → 创建 1:1
    const meetingId = await this.meetingAutoService.resolveOrCreateOneOnOneMeeting({
      employeeId, agentId, sessionFilter, chatId: event.externalChatId,
    });
    // session 已在 resolveOrCreate 中写入
  }

  const meeting = await this.sessionService.getActiveMeeting(sessionFilter);
  await this.callApiAsUser(employeeId, {
    method: 'post',
    url: `/api/meetings/${meeting.meetingId}/messages`,
    data: {
      senderId: employeeId,
      senderType: 'employee',
      content: prompt,
      type: 'opinion',
      metadata: { source: 'feishu' },
    },
  });
  return;
}
```

#### session_reset 路由

```typescript
case 'session_reset': {
  const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
  if (activeMeeting && activeMeeting.meetingType === 'one_on_one') {
    // 结束 1:1 会议
    await this.meetingAutoService.endOneOnOneMeeting({
      meetingId: activeMeeting.meetingId,
      employeeId,
      sessionFilter,
    });
  }
  await this.sessionService.reset(sessionFilter);
  await this.reply(chatId, '会话已重置。');
  return;
}
```

### Step 6：实现会议指令路由（多人会议）

**影响点**：`apps/channel/src/modules/inbound/channel-inbound.service.ts`

多人会议的显式指令路由，与 1:1 自动会议共存：

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
// 1. 如果当前有 1:1 会议，暂不结束（leave 多人会议后可恢复）
const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
if (activeMeeting && activeMeeting.meetingType === 'one_on_one') {
  // 停止 1:1 的 relay（但不结束会议）
  await this.meetingRelayService.stopRelay(activeMeeting.meetingId, employeeId);
}

// 2. 加入多人会议
await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${meetingId}/join`,
  data: { id: employeeId, type: 'employee' },
});

// 3. session 切换到多人会议
await this.sessionService.setActiveMeeting(sessionFilter, meetingId, 'ad_hoc');

// 4. 启动 relay
await this.meetingRelayService.startRelay({
  meetingId,
  chatId: event.externalChatId,
  employeeId,
});

// 5. 推送上下文摘要 + 回复提示
// 「已加入会议「{title}」，当前进入会议模式——直接输入文字即为发言，/meeting leave 退出会议。」
```

#### meeting_leave

```typescript
const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
if (!activeMeeting) {
  await this.reply(chatId, '你当前不在任何会议中');
  return;
}

await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${activeMeeting.meetingId}/leave`,
  data: { id: employeeId, type: 'employee' },
});

await this.meetingRelayService.stopRelay(activeMeeting.meetingId, employeeId);
await this.sessionService.clearActiveMeeting(sessionFilter);

// 回复「已离开会议，恢复正常对话模式。」
```

#### meeting_end

```typescript
const activeMeeting = await this.sessionService.getActiveMeeting(sessionFilter);
if (!activeMeeting) {
  await this.reply(chatId, '你当前不在任何会议中');
  return;
}

await this.callApiAsUser(employeeId, {
  method: 'post',
  url: `/api/meetings/${activeMeeting.meetingId}/end`,
});

// relay 和 session 由 relay 服务监听到 status_changed → ended 后自动清理
// 回复「会议已结束。」
```

### Step 7：会议消息实时转发（Relay 服务）

**影响点**：新增 `apps/channel/src/modules/inbound/channel-meeting-relay.service.ts`

#### 核心设计

```typescript
@Injectable()
export class ChannelMeetingRelayService implements OnModuleDestroy, OnModuleInit {
  // 活跃的 relay 映射：key = `${meetingId}:${employeeId}`
  private activeRelays = new Map<string, RelayContext>();

  async startRelay(input: { meetingId: string; chatId: string; employeeId: string }): Promise<void>
  async stopRelay(meetingId: string, employeeId: string): Promise<void>
  onModuleInit(): Promise<void>   // 从 DB 恢复活跃 relay
  onModuleDestroy(): void          // 清理所有订阅
}
```

#### 消息过滤规则（双向同步核心）

收到 Redis `meeting:{meetingId}` 频道的 `message` 事件后：

| 消息特征 | 行为 | 说明 |
|---|---|---|
| `metadata.source === 'feishu'` && `senderId === employeeId` | **跳过** | 自己从飞书发的，不回显 |
| `metadata.source === 'web'` && `senderId === employeeId` | **转发** | 自己从前端发的，同步到飞书，格式 `[你·网页] 内容` |
| `senderType === 'agent'` | **转发** | Agent 响应，格式 `[{agentName}] 内容` |
| `senderType === 'employee'` && `senderId !== employeeId` | **转发** | 其他参与者发言，格式 `[{employeeName}] 内容` |
| `senderType === 'system'` | **按需过滤** | 系统消息简化或跳过 |

#### 防刷合并

- 每条消息不立即推送，先放入 1.5 秒缓冲窗口
- 窗口内的多条消息合并为一条推送
- 设置 buffer 上限（10 条）或最大等待时间（3 秒），防止 buffer 无限增长

#### 会议结束自动清理

监听 `status_changed` 事件，当 `status === 'ended'` 时：

1. 停止该会议的所有 relay
2. 向对应的飞书会话推送「会议已结束」
3. 清除相关 session 的 `activeMeetingId`

#### 服务重启恢复

`OnModuleInit` 中从 `channel_sessions` 查询所有 `activeMeetingId` 不为空的 session，重新建立 relay 订阅。

### Step 8：前端消息来源标记

**影响点**：前端发送会议消息的位置

前端 `useMeetingMutations.ts` 中 `sendMessageMutation` 需要在 metadata 中追加 `source: 'web'`：

```typescript
meetingService.sendMessage(id, {
  senderId: currentUser?.id,
  senderType: 'employee',
  content,
  type: 'opinion',
  metadata: { source: 'web' },  // 新增
});
```

这是双向同步的前提——relay 需要通过 `source` 区分消息来源。

### Step 9：更新 `/help` 指令

**影响点**：`channel-inbound.service.ts` help 回复文本

```
可用指令：

计划：
  /plan new <需求描述>     - 创建计划
  /plan status <planId>   - 查询计划状态
  /plan cancel <id>       - 取消运行

对话：
  /agent chat <agentId> <消息> - 指定 Agent 对话
  直接输入文字               - 与默认 Agent 对话

会话：
  /session reset           - 重置会话（结束当前对话）

会议：
  /meeting list            - 查看进行中的会议
  /meeting create <标题>    - 创建多人会议
  /meeting join <meetingId> - 加入会议
  /meeting leave           - 离开当前会议
  /meeting end             - 结束当前会议

其他：
  /bind token:<token>      - 绑定账号
  /help                    - 显示此帮助

所有对话自动保存，可在系统前端查看历史。
```

## 5. 关键影响点汇总

| 范围 | 具体变更 |
|---|---|
| `command-parser.service.ts` | **重构**为两级解析架构 |
| `command-parser.service.spec.ts` | 同步更新测试用例 |
| `channel-inbound.service.ts` | `chat`/`agent_chat` 改为走会议消息链路；`session_reset` 结束 1:1 会议；新增多人会议指令路由 |
| `channel-session.schema.ts` | 新增 `activeMeetingId` + `activeMeetingType` |
| `channel-session.service.ts` | 新增会议相关方法 |
| 新增 `channel-meeting-auto.service.ts` | 1:1 会议自动创建/复用/切换/结束 |
| 新增 `channel-meeting-relay.service.ts` | 双向消息转发、来源过滤、合并窗口、自动清理、重启恢复 |
| `inbound.module.ts` | 注册新服务 |
| Help 文案 | 更新为两级命令 + 对话自动保存提示 |
| 前端 `useMeetingMutations.ts` | 发送消息时追加 `metadata.source = 'web'` |
| Meeting API | 可能需要新增 `type: 'one_on_one'` 的查询支持 |
| 数据库 | `channel_sessions` 新增可选字段，无 breaking change |

## 6. 风险与应对

| 风险 | 应对策略 |
|---|---|
| 命令重构影响现有功能 | Step 1-2 先完成并通过测试，再开发后续功能 |
| 1:1 会议频繁创建导致会议数量膨胀 | `one_on_one` 类型会议在列表中默认不显示或折叠；前端可按类型过滤 |
| 聊天链路从 inner-message 切到会议后行为差异 | 充分测试 agent 响应的完整流程（触发、执行、回复） |
| 双向同步时消息重复 | relay 严格按 `metadata.source` 过滤，避免回显 |
| 前端未传 `metadata.source` 导致 relay 过滤失败 | `source` 缺失时默认不过滤（安全方向：宁可多推也不漏推） |
| 会议消息高频导致飞书消息轰炸 | 1.5 秒合并窗口（上限 10 条 / 3 秒强刷）+ `/meeting leave` 退出 |
| Redis 订阅生命周期管理 | 会议结束自动清理；channel 重启时从 session 恢复 |
| 多端同时发言时序问题 | 消息以服务端 timestamp 为准，前端和飞书都以此排序 |
| channel 服务重启导致 relay 断开 | `OnModuleInit` 从 DB 恢复活跃 session 的 relay 订阅 |

## 7. MVP 边界（不做的事）

| 不做 | 原因 |
|---|---|
| 飞书卡片形式的会议消息 | 先用纯文本，后续可升级 |
| `@` 提及特定 Agent | 飞书 `@` 语法与系统内不同，暂不适配 |
| `/meeting create` 时邀请参与者 | 先创建空会议，后续可扩展 |
| 暂停/恢复会议 | 低频操作，留在前端 |
| 会议内撤回消息 | 飞书侧无法 recall，体验不完整 |
| Agent 思考状态提示 | 后续迭代 |
| 旧命令向后兼容 | 命令系统尚未上线使用 |
| 飞书群聊绑定会议 | 本次仅覆盖 P2P 私聊场景，群聊后续迭代 |
| 前端→飞书的主动通知（非会议消息） | 如任务完成通知等，仍走原有 event stream 通道 |

## 8. 后续迭代方向

- `/meeting start <标题> @agent-A @agent-B` — 一条命令创建+加入+邀请 agent
- `/meeting invite <agentId>` — 邀请 Agent 加入当前会议
- 会议消息卡片化 — 使用飞书卡片展示发言者头像、角色、消息类型
- Agent thinking 状态提示 — 推送「Agent 思考中...」动态状态
- 会议摘要主动推送 — 会议结束后自动推送纪要到参会飞书用户
- 飞书群与会议绑定 — 群消息即会议发言，多人实时讨论
- 分领域帮助 — `/help meeting`、`/help plan` 等子帮助
- 1:1 会议自动归档 — 超时会议自动结束并生成摘要
