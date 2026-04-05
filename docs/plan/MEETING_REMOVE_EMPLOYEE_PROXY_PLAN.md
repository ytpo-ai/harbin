# 会议系统移除 Employee 代理发言机制 Plan

## 1. 背景

当前会议系统中，人类员工（employee）不直接在会议中发言，而是由其**专属助理 Agent 代理发言**。具体流程：

1. `MeetingMessageService.sendMessage()` 检测 `senderType === 'employee'`
2. 通过 `getRequiredExclusiveAssistantAgentId()` 查找专属助理 Agent
3. 将 `senderId` 改写为 agent ID，`senderType` 改写为 `'agent'`
4. 在 `metadata` 中标记 `isAIProxy: true` + `proxyForEmployeeId: 原始employeeId`

这套设计的初衷是让会议中只有 agent 身份发言、统一消息模型。但实际带来了大量额外复杂度：

- **加入会议时**：employee join → 自动查找并 join 专属 assistant agent，两个参与者联动管理
- **创建会议时**：host 为 employee 时，hostId 被改写为 agent ID
- **发消息时**：senderId 从 employee 改写为 agent，再用 metadata 反向记录原始 employee
- **前端显示**：通过 `metadata.proxyForEmployeeId` 反向识别"我的消息"；ChatInput 需检查 assistant 是否在会议中才允许发言
- **消息控制**：pause/revoke 通过 metadata 校验操作者身份
- **Agent 响应编排**：依赖 `isHumanProxyMessage` 标记区分是否触发其他 Agent 回应，专属助理 Agent 需要特殊过滤逻辑

随着飞书 Bot 会议参与能力的引入（channel 侧 relay 消息过滤也需处理 proxy metadata），复杂度进一步叠加。

**目标**：移除代理发言机制，让 employee 直接以自身身份在会议中发言，简化整条消息链路。

## 2. 核心变更

| 维度 | 当前（代理模式） | 改后（直接发言） |
|---|---|---|
| 消息发送 | employee → 查 assistant → 改写为 agent 发言 | employee 直接发言，`senderType = 'employee'` |
| 消息存储 | `senderId = agentId`，metadata 记录 proxy 信息 | `senderId = employeeId`，无 proxy metadata |
| 加入会议 | employee join → 自动 join assistant agent | 只加 employee，不联动 agent |
| 创建会议 | host 为 employee 时改写为 agent | host 保持 employee |
| 参与者统计 | 消息计数在 agent 参与者上 | 消息计数在 employee 参与者上 |
| 触发 Agent 响应 | 通过 `isHumanProxyMessage` 判断 | 通过 `senderType === 'employee'` 判断 |
| 消息控制 | pause/revoke 通过 `metadata.proxyForEmployeeId` 鉴权 | 通过 `senderId === employeeId && senderType === 'employee'` 鉴权 |
| 前端显示 | 反向匹配 assistantAgentId 判断"我的消息" | `senderId === currentUser.id && senderType === 'employee'` |
| 前端发言门槛 | 需绑定专属助理 + 助理在会议中 | employee 自身在会议中即可 |

## 3. 可执行步骤

### Step 1：简化 MeetingMessageService.sendMessage()

**文件**：`backend/src/modules/meetings/services/meeting-message.service.ts`

#### 变更内容

1. **移除代理改写逻辑**（约 L47-55）：
   - 删除 `isHumanProxyMessage` 判断
   - 删除 `getRequiredExclusiveAssistantAgentId()` 调用
   - `effectiveSenderId` 和 `effectiveSenderType` 直接使用 dto 原值

2. **移除 proxy metadata 注入**（约 L90-95）：
   - 消息构建时不再注入 `isAIProxy`、`proxyForEmployeeId`、`pendingResponsePaused`

3. **更新触发 Agent 响应的条件**（约 L132）：
   - 原：`if (isHumanProxyMessage) { triggerAgentResponses() }`
   - 改：`if (dto.senderType === 'employee') { triggerAgentResponses() }`

4. **更新参与者统计**：
   - 消息计数更新到 employee 参与者上（`effectiveSenderId` 已经是 employeeId）

#### 代码示意

```typescript
async sendMessage(meetingId: string, dto: MeetingMessageDto) {
  // 不再改写 sender
  const effectiveSenderId = dto.senderId;
  const effectiveSenderType = dto.senderType;

  const message: MeetingMessage = {
    id: uuidv4(),
    senderId: effectiveSenderId,
    senderType: effectiveSenderType,
    content: dto.content,
    type: dto.type || 'opinion',
    timestamp: new Date(),
    metadata: dto.metadata || {},  // 不再注入 proxy 字段
  };

  // ... 持久化、统计更新 ...

  // employee 发言触发 Agent 响应
  if (dto.senderType === 'employee') {
    this.triggerAgentResponses(meetingId, message);
  }
}
```

### Step 2：简化 pause/revoke 鉴权

**文件**：`backend/src/modules/meetings/services/meeting-message.service.ts`

#### 变更内容

`assertMessageController()`（约 L218-223）：
- 原：通过 `metadata.proxyForEmployeeId` 校验
- 改：通过 `message.senderId === employeeId && message.senderType === 'employee'` 校验

```typescript
private assertMessageController(message: MeetingMessage, employeeId: string): void {
  if (message.senderType !== 'employee' || message.senderId !== employeeId) {
    throw new ConflictException('Only the original sender can control this message');
  }
}
```

`pauseMessageResponse()` 和 `revokePausedMessage()` 中，不再依赖 `pendingResponsePaused` metadata 字段做状态管理。需要评估是否保留 pause/revoke 功能本身——如果 employee 直接发言后仍需支持"暂停 Agent 对该消息的响应"，可改用消息级别的独立字段而非 metadata。暂时保留功能，将状态字段从 metadata 移到消息顶层或通过消息 ID 关联管理。

### Step 3：简化会议参与者管理

**文件**：`backend/src/modules/meetings/services/meeting-participant.service.ts`

#### 变更内容

1. **`joinMeeting()`**（约 L310-372）：
   - 移除 employee join 时查找并 upsert assistant agent 的逻辑
   - 只添加 employee 自身为参与者

2. **`addParticipant()`**（约 L498-520）：
   - 同上，移除 assistant agent 联动

3. **`inviteParticipant()`**：
   - 同上

4. **`removeParticipant()`**：
   - 移除"移除 employee 时同步移除关联 assistant agent"的逻辑

5. **参与者上下文构建**（`buildParticipantContextProfiles` 约 L130-215）：
   - 移除 `isExclusiveAssistant` / `assistantForEmployeeId` 相关的特殊显示名逻辑
   - employee 参与者直接使用自身名称

### Step 4：简化会议创建

**文件**：`backend/src/modules/meetings/services/meeting-lifecycle.service.ts`

#### 变更内容

1. **`createMeeting()`**（约 L94-186）：
   - 移除 host 为 employee 时改写为 agent 的逻辑（约 L94-103）
   - 移除"验证所有 employee 参与者有专属助理"的校验
   - 移除为每个 employee 参与者 upsert assistant agent 的逻辑

2. **`startMeeting()`**：
   - 移除验证 host assistant 存在的逻辑

```typescript
// createMeeting 简化
async createMeeting(dto: CreateMeetingDto): Promise<Meeting> {
  // host 保持原值，不再改写
  const meeting = new this.meetingModel({
    hostId: dto.hostId,
    hostType: dto.hostType,  // 'employee' 就是 'employee'
    // ...
  });
  // 添加参与者，不再联动 assistant agent
}
```

### Step 5：简化 Agent 响应编排

**文件**：`backend/src/modules/meetings/services/meeting-orchestration.service.ts`

#### 变更内容

1. **`triggerAgentResponses()`**（约 L440-550）：
   - 移除将参与者分为 `exclusiveAssistantParticipants` 和 `regularAgentParticipants` 的逻辑
   - 所有 agent 参与者统一处理（`isExclusiveAssistant` 的 agent 不再自动加入会议，也不再需要特殊过滤）
   - 移除"专属助理只在被 owner @提及 时才响应"的特殊规则

2. **`proxyForEmployeeId` 引用**（约 L488-493）：
   - 原：从 `triggerMessage.metadata.proxyForEmployeeId` 获取发言的 employee
   - 改：直接从 `triggerMessage.senderId`（当 `senderType === 'employee'` 时）

3. **`pendingResponsePaused` 检查**（约 L585）：
   - 配合 Step 2 的 pause 机制调整

### Step 6：清理 MeetingParticipantHelperService

**文件**：`backend/src/modules/meetings/services/meeting-participant-helper.service.ts`

#### 变更内容

此文件提供两个方法，都将被废弃：

1. **`getRequiredExclusiveAssistantAgentId()`**：会议上下文中不再需要。删除方法或标记 `@deprecated`。
   - 调用方全部在 Step 1/3/4 中已移除

2. **`upsertExclusiveAssistantParticipant()`**：不再自动为 employee 添加 assistant 参与者。删除方法。
   - 调用方全部在 Step 3/4 中已移除

如果 helper service 内所有方法都被移除，可直接删除整个文件并从 module 注册中移除。

### Step 7：更新 Schema（标记废弃字段）

**文件**：`backend/src/shared/schemas/meeting.schema.ts`

#### 变更内容

以下字段在新消息中不再写入，但需**保留字段定义**以兼容历史数据：

**MeetingParticipant**：
- `isExclusiveAssistant`（L58）— 新参与者不再写入此字段
- `assistantForEmployeeId`（L61）— 新参与者不再写入此字段

**MeetingMessage.metadata**：
- `isAIProxy`（L93）— 新消息不再写入
- `proxyForEmployeeId`（L94）— 新消息不再写入
- `pendingResponsePaused`（L95）— 视 Step 2 调整方案决定
- `pendingResponsePausedAt`（L96）— 同上

在字段定义上方添加 `@deprecated` JSDoc 注释，说明仅用于历史数据兼容。

### Step 8：前端适配

#### 8.1 ChatInput.tsx

**文件**：`frontend/src/pages/meetings/components/ChatInput.tsx`

- 移除 `hasExclusiveAssistant` / `isAssistantInMeeting` 的检查逻辑
- 发言条件简化为：employee 自身是会议参与者且 `isPresent === true`
- 移除"未绑定专属助理，无法发言"等提示文案
- 发送消息的 payload 不变（仍然 `senderType: 'employee'`）

#### 8.2 MessageList.tsx

**文件**：`frontend/src/pages/meetings/components/MessageList.tsx`

- **识别"我的消息"**：
  - 原：`message.senderType === 'agent' && senderId === currentEmployee.exclusiveAssistantAgentId`
  - 改：`message.senderType === 'employee' && message.senderId === currentUser.id`
  - **兼容历史**：`|| (message.metadata?.isAIProxy && message.metadata?.proxyForEmployeeId === currentUser.id)`

- **pause/revoke 控制按钮**：
  - 原：依赖 `metadata.proxyForEmployeeId`
  - 改：依赖 `message.senderType === 'employee' && message.senderId === currentUser.id`
  - 兼容历史：同上

#### 8.3 useMeetingQueries.ts

**文件**：`frontend/src/pages/meetings/hooks/useMeetingQueries.ts`

- 移除 `hasExclusiveAssistant` 和 `currentExclusiveAssistantName` 的计算逻辑
- 这些值不再被 ChatInput 等组件消费

#### 8.4 useMessageHistory.ts

**文件**：`frontend/src/pages/meetings/hooks/useMessageHistory.ts`

- **筛选"我发送的消息"**：
  - 原：`message.metadata?.proxyForEmployeeId === currentUserId`
  - 改：`message.senderType === 'employee' && message.senderId === currentUserId`
  - 兼容历史：`|| (message.metadata?.proxyForEmployeeId === currentUserId)`

#### 8.5 useMeetingMutations.ts

**文件**：`frontend/src/pages/meetings/hooks/useMeetingMutations.ts`

- `sendMessageMutation` 无需改动（已经发送 `senderType: 'employee'`）
- `pauseMessageResponseMutation` / `revokePausedMessageMutation` 保持不变（API 层面兼容）

#### 8.6 其他前端文件

- `meetings/index.tsx`（L90, 94, 96, 406）— 移除 `isExclusiveAssistant` / `assistantForEmployeeId` 相关过滤逻辑
- `meetings/utils.ts`（L123, 129, 131, 132）— 移除 assistant 相关工具函数
- `meetings/types.ts`（L222）— 移除 `exclusiveAssistantAgentId` 相关类型定义（如果仅会议使用）
- `CreateMeetingModal.tsx`（L11, 131）— 移除创建会议时检查参与者是否有专属助理的校验

### Step 9：更新 Channel 会议 Plan 中的相关描述

**文件**：`docs/plan/CHANNEL_FEISHU_MEETING_PARTICIPATION_PLAN.md`

- 移除"核心机制约束"小节中关于代理发言的描述
- Relay 消息过滤规则从 `metadata.proxyForEmployeeId` 更新为 `senderType === 'employee' && senderId === employeeId`

## 4. 不涉及的范围

| 项目 | 说明 |
|---|---|
| `employee.exclusiveAssistantAgentId` 字段本身 | 该字段在会议之外可能仍有用途（如 channel 模块的 agent 对话路由、协作上下文等）。本次仅移除会议中对该字段的依赖，不清理字段本身 |
| `employee.aiProxyAgentId` 字段 | 同上，是 `exclusiveAssistantAgentId` 的 legacy 回退，非本次清理范围 |
| Agent 独立参会能力 | agent 仍可以作为独立参与者加入会议（`participantType: 'agent'`），只是不再作为 employee 的代理自动加入 |
| `MeetingMessageCenterEventService` 中的 `assistantForEmployeeId` 引用 | 该服务用于消息中心事件推送，需评估是否受影响。如果它通过 participant 的 `assistantForEmployeeId` 关联推送通知给 employee，改为直接查 participant 中的 employee 即可 |

## 5. 历史数据兼容策略

已有的会议数据中存在以下历史格式：

- 消息 `senderId` = agentId，`metadata.isAIProxy = true`，`metadata.proxyForEmployeeId = employeeId`
- 参与者中有 `isExclusiveAssistant: true` 的 agent 记录
- 会议 `hostId` 可能是 agent ID（employee 创建的会议被改写过）

**策略**：
1. **Schema 字段保留**：不删除废弃字段的 Schema 定义，仅添加 `@deprecated` 注释
2. **前端双模式兼容**：判断"我的消息"时同时检查新格式（`senderType === 'employee'`）和旧格式（`metadata.proxyForEmployeeId`）
3. **不做数据迁移**：历史消息保持原样，不批量改写。新消息按新格式存储
4. **后续清理**：待系统稳定运行一段时间后，可考虑通过脚本迁移历史数据并最终移除废弃字段

## 6. 关键影响点汇总

| 范围 | 具体变更 |
|---|---|
| `meeting-message.service.ts` | 移除 sender 改写、proxy metadata 注入、更新触发条件和鉴权逻辑 |
| `meeting-participant.service.ts` | 移除 join/add/invite/remove 中的 assistant agent 联动 |
| `meeting-participant-helper.service.ts` | 两个方法废弃，可能整个文件删除 |
| `meeting-lifecycle.service.ts` | 移除 host 改写、assistant 校验、assistant upsert |
| `meeting-orchestration.service.ts` | 移除 exclusive assistant 特殊过滤、更新 proxyForEmployeeId 引用 |
| `meeting.schema.ts` | 字段保留但标记 `@deprecated` |
| `ChatInput.tsx` | 简化发言门槛检查 |
| `MessageList.tsx` | 更新"我的消息"识别 + 历史兼容 |
| `useMeetingQueries.ts` | 移除 assistant 相关计算 |
| `useMessageHistory.ts` | 更新发送历史筛选 + 历史兼容 |
| `meetings/index.tsx` | 移除 assistant 过滤逻辑 |
| `meetings/utils.ts` | 移除 assistant 工具函数 |
| `CreateMeetingModal.tsx` | 移除 assistant 校验 |
| `meeting-message-center-event.service.ts` | 评估 `assistantForEmployeeId` 引用是否需调整 |
| Channel Meeting Plan | 更新代理机制描述和 relay 过滤规则 |

## 7. 风险与应对

| 风险 | 应对策略 |
|---|---|
| 历史消息前端显示异常 | 前端双模式兼容：同时检查新旧格式判断"我的消息" |
| 历史会议 hostId 为 agent | 前端展示 host 信息时需兼容 hostType 可能为 'agent' 的旧数据 |
| Agent 响应编排行为变化 | 充分测试：employee 发言触发 agent 响应、agent 发言不触发、@提及场景 |
| pause/revoke 功能回归 | 更新鉴权逻辑后验证前端 pause/revoke 按钮的显示和操作 |
| `exclusiveAssistantAgentId` 在会议外的引用 | 本次不改动该字段，仅切断会议内的依赖链 |

## 8. 执行优先级

本 Plan 为 **Channel 飞书会议参与能力 Plan** 的前置依赖。建议执行顺序：

1. **先执行本 Plan**（移除代理机制）
2. **再执行 Channel 会议参与 Plan**（relay 过滤逻辑更简单，无需处理 proxy metadata）
