# Meeting Service 拆分计划

> 状态：开发完成（待业务回归）
> 创建时间：2026-03-24

## 背景

`backend/src/modules/meetings/meeting.service.ts` 当前 **2313 行（77KB）**，包含 **78 个方法**，承担了会议 CRUD、参与者管理、消息收发、Agent 响应编排、Agent 状态管理、意图检测、@提及解析、会议总结、SSE 事件流等 **14 个功能域**，严重违反单一职责原则。

核心问题：
- 单文件过大，阅读和定位困难
- 功能域耦合严重，修改 Agent 编排逻辑时容易误触消息或参与者逻辑
- 无法针对单个功能域编写独立测试
- `sendMessage` ↔ `triggerAgentResponses` ↔ `generateAgentResponse` ↔ `sendMessage` 存在隐式循环调用

## 拆分目标

- 每个子 service 职责单一、边界清晰
- 拆分后不改变任何外部行为（Controller 层调用方式不变）
- `meeting.service.ts` **保留为 Facade 层**，注入所有子 service，将 Controller 的调用委派到对应子 service
- Controller 继续只注入 `MeetingService`，零改动
- 解决 `sendMessage ↔ Agent 编排` 的循环依赖问题
- DTO / Interface 类型定义独立到 `meeting.types.ts`

## 拆分方案

### 目标目录结构

```
backend/src/modules/meetings/
├── services/
│   ├── meeting-event.service.ts             # [底层共享] SSE 事件发布与订阅
│   ├── meeting-agent-state.service.ts       # Agent thinking/idle 状态管理 (Redis)
│   ├── meeting-lifecycle.service.ts         # 会议 CRUD + 状态转换 + 查询/统计
│   ├── meeting-participant.service.ts       # 参与者管理 + 上下文构建 + 显示名解析
│   ├── meeting-message.service.ts           # 消息发送 + 系统消息 + 消息控制(暂停/撤回)
│   ├── meeting-orchestration.service.ts     # Agent 响应编排 + 去重 + @提及 + 意图检测 + 意图响应
│   └── meeting-summary.service.ts           # 会议总结生成 + meeting-ended 事件
├── meeting.types.ts                         # DTO / Interface 类型定义（从 service 抽出）
├── meeting.service.ts                       # Facade 层（委派到子 service）
├── meeting.controller.ts                    # 不变
├── meeting.module.ts                        # 更新 providers 注册
└── meeting-inner-message.constants.ts       # 不变
```

### 子 Service 划分（7 个）

| # | 文件名 | 职责 | 大致行数 | 核心公开方法 |
|---|--------|------|---------|-------------|
| 1 | `meeting-event.service.ts` | SSE 事件发布与订阅（Redis pub + 内存 listener） | ~50 | `subscribeToEvents`, `unsubscribeFromEvents`, `emitEvent` |
| 2 | `meeting-agent-state.service.ts` | Agent thinking/idle 状态（Redis 读写） | ~100 | `setAgentState`, `clearAgentThinking`, `clearAllMeetingAgentThinking`, `getMeetingAgentStates` |
| 3 | `meeting-lifecycle.service.ts` | 会议 CRUD、状态转换、查询、统计 | ~400 | `createMeeting`, `startMeeting`, `endMeeting`, `pauseMeeting`, `resumeMeeting`, `archiveMeeting`, `deleteMeeting`, `updateMeetingTitle`, `updateSpeakingMode`, `getMeeting`, `getMeetingDetail`, `getAllMeetings`, `getMeetingsByParticipant`, `getMeetingStats` |
| 4 | `meeting-participant.service.ts` | 参与者 join/leave/invite/add/remove + 上下文构建 + 显示名 | ~450 | `joinMeeting`, `leaveMeeting`, `inviteParticipant`, `addParticipant`, `removeParticipant`, `buildParticipantContextProfiles`, `resolveParticipantDisplayName` |
| 5 | `meeting-message.service.ts` | 消息发送 + 系统消息 + 消息控制（暂停/撤回） | ~300 | `sendMessage`, `addSystemMessage`, `pauseMessageResponse`, `revokePausedMessage` |
| 6 | `meeting-orchestration.service.ts` | Agent 响应编排 + 去重 + @提及 + 意图检测 + 专项意图响应 | ~650 | `triggerAgentResponses`, `generateAgentResponse`, `catchUpAgent` |
| 7 | `meeting-summary.service.ts` | 会议总结保存 + meeting-ended 内部事件 | ~100 | `generateMeetingSummary`, `publishMeetingEndedSummaryEvent` |

### 开发步骤

#### Step 1：抽出类型定义 → `meeting.types.ts`
- [ ] 将 `MeetingEvent`, `MeetingAgentStatePayload`, `MeetingSpeakingMode`, `ParticipantIdentity`, `ParticipantContextProfile`, `MeetingParticipantRecord`, `CreateMeetingDto`, `MeetingMessageDto`, `ControlMeetingMessageDto`, `SaveMeetingSummaryDto` 等类型移至 `meeting.types.ts`
- [ ] 原 `meeting.service.ts` 和 `meeting.controller.ts` 改为从 `meeting.types.ts` 导入
- [ ] 影响点：Controller 的 import 路径变化

#### Step 2：抽出 `MeetingEventService`（底层共享）
- [ ] 迁移方法：`subscribeToEvents`, `unsubscribeFromEvents`, `emitEvent`
- [ ] 迁移属性：`eventListeners` Map
- [ ] 依赖：`RedisService`
- [ ] 验证：所有 SSE 事件推送正常

#### Step 3：抽出 `MeetingAgentStateService`
- [ ] 迁移方法：`buildMeetingAgentStateKey`, `buildMeetingAgentStatePattern`, `setAgentState`, `clearAgentThinking`, `clearAllMeetingAgentThinking`, `getMeetingAgentStates`
- [ ] 迁移属性：`meetingAgentStateKeyPrefix`, `meetingAgentStateTtlSeconds`
- [ ] 依赖：`RedisService`, `MeetingEventService`
- [ ] 验证：Agent 思考状态正常切换

#### Step 4：抽出 `MeetingLifecycleService`
- [ ] 迁移方法：`createMeeting`, `startMeeting`, `endMeeting`, `pauseMeeting`, `resumeMeeting`, `archiveMeeting`, `deleteMeeting`, `updateMeetingTitle`, `updateSpeakingMode`, `getMeeting`, `getMeetingDetail`, `getAllMeetings`, `getMeetingsByParticipant`, `getMeetingStats`, `ensureMeetingCompatibility`, `normalizeSpeakingMode`
- [ ] 依赖：`MeetingModel`, `MeetingEventService`, `MeetingAgentStateService`, `MeetingParticipantService`（需 Step 5 先完成接口定义）, `MeetingMessageService`（addSystemMessage）, `MeetingSummaryService`（publishMeetingEndedSummaryEvent）, `EmployeeService`, `AgentClientService`
- [ ] 注意：`ensureMeetingCompatibility` 是高频工具方法，被多个子 service 使用。**放在 LifecycleService 中并通过注入供其他 service 调用**
- [ ] 验证：会议全生命周期 CRUD 正常

#### Step 5：抽出 `MeetingParticipantService`
- [ ] 迁移方法：`joinMeeting`, `leaveMeeting`, `inviteParticipant`, `addParticipant`, `removeParticipant`, `getEmployeeOrThrow`, `getRequiredExclusiveAssistantAgentId`, `upsertExclusiveAssistantParticipant`, `maybeRenameExpandedOneToOneMeeting`, `getExpandedMeetingTitle`, `isHiddenAgentForMeeting`, `buildParticipantContextProfiles`, `formatParticipantContextSummary`, `buildParticipantDisplayNameMap`, `resolveMessageSenderDisplayName`, `resolveParticipantDisplayName`, `appendParticipantContextSystemMessage`
- [ ] 依赖：`MeetingModel`, `EmployeeService`, `AgentClientService`, `MeetingEventService`, `MeetingMessageService`（addSystemMessage）, `MeetingLifecycleService`（ensureMeetingCompatibility）, `MeetingOrchestrationService`（catchUpAgent）
- [ ] 注意：依赖 OrchestrationService 的 `catchUpAgent`，需用 `forwardRef` 解决
- [ ] 验证：参与者增删、加入退出正常

#### Step 6：抽出 `MeetingMessageService`
- [ ] 迁移方法：`sendMessage`, `addSystemMessage`, `pauseMessageResponse`, `revokePausedMessage`, `hasAgentRepliedToMessage`, `getMessageById`, `assertMessageController`, `analyzeMessageType`
- [ ] 依赖：`MeetingModel`, `MessagesService`, `MeetingEventService`, `MeetingAgentStateService`, `MeetingLifecycleService`（ensureMeetingCompatibility）, `MeetingParticipantService`（getRequiredExclusiveAssistantAgentId）
- [ ] 注意：`sendMessage` 末尾调用 `triggerAgentResponses`（属于 Orchestration），采用回调 / 事件通知方式解耦
- [ ] 验证：消息发送、暂停、撤回正常

#### Step 7：抽出 `MeetingOrchestrationService`
- [ ] 迁移方法：`triggerAgentResponses`, `generateAgentResponse`, `buildMeetingResponseContext`, `catchUpAgent`, `buildMeetingTeamContext`, `buildMeetingResponseTaskDescription`, `pickModelManagementResponder`, `buildResponseDedupKey`, `shouldProcessResponse`, `extractMentionTokens`, `buildMentionAliases`, `resolveMentionedAgentIds`, `isLatestModelSearchIntent`, `isModelListIntent`, `isMemoRecordIntent`, `isModelManagementIntent`, `isOperationLogIntent`, `isAgentListIntent`, `hasBracketPhraseIntent`, `extractBracketCommands`, `normalizeIntentPhrase`, `respondWithOperationLogSummary`, `respondWithAgentListSummary`, `formatOperationLogResponse`, `formatAgentListResponse`
- [ ] 迁移属性：所有 intent phrases 常量、`responseDedupWindowMs`, `recentResponseKeys`, `modelManagementAgentName`
- [ ] 依赖：`MeetingModel`, `AgentClientService`, `MeetingEventService`, `MeetingAgentStateService`, `MeetingMessageService`（sendMessage, addSystemMessage）, `MeetingParticipantService`（buildParticipantContextProfiles, buildParticipantDisplayNameMap, resolveMessageSenderDisplayName）, `MeetingLifecycleService`（ensureMeetingCompatibility）
- [ ] 验证：Agent 自动回复、@提及路由、意图命令响应正常

#### Step 8：抽出 `MeetingSummaryService`
- [ ] 迁移方法：`generateMeetingSummary`, `normalizeSummaryItems`, `publishMeetingEndedSummaryEvent`
- [ ] 依赖：`MeetingModel`, `AgentClientService`, `MeetingEventService`, `MeetingLifecycleService`（ensureMeetingCompatibility）
- [ ] 验证：总结保存、meeting-ended 事件发布正常

#### Step 9：改造 `meeting.service.ts` 为 Facade
- [ ] 删除所有已迁移的方法实现
- [ ] 注入所有 7 个子 service
- [ ] 每个公开方法仅做一行委派调用
- [ ] 保留所有原 public 方法签名（Controller 零改动）
- [ ] 预计 Facade 层约 120-150 行

#### Step 10：更新 `meeting.module.ts`
- [ ] 在 providers 中注册所有 7 个子 service
- [ ] exports 保持 `MeetingService`（Facade）不变
- [ ] 确认 `forwardRef` 注入配置

#### Step 11：验证与回归
- [x] TypeScript 编译无报错（`npm run build`）
- [x] Lint 检查通过
- [ ] 手动验证核心流程：创建会议 → 加入 → 发消息 → Agent 回复 → 结束 → 总结
- [ ] 确认 SSE 事件推送正常

## 关键风险与应对

### 1. 循环依赖：sendMessage ↔ triggerAgentResponses
- **现状**：`sendMessage`（Message 域）末尾调用 `triggerAgentResponses`（Orchestration 域），而 `generateAgentResponse` 又调用 `sendMessage`
- **方案**：`MeetingMessageService.sendMessage()` 接收一个可选回调 `onHumanMessageSent`，由 Facade 层在组装时将 `orchestrationService.triggerAgentResponses` 作为回调注入；或 MessageService 通过 `forwardRef` 注入 OrchestrationService

### 2. 循环依赖：ParticipantService → OrchestrationService (catchUpAgent)
- **现状**：`joinMeeting` / `inviteParticipant` 调用 `catchUpAgent`
- **方案**：使用 Nest.js `forwardRef()` + `@Inject(forwardRef(() => MeetingOrchestrationService))`

### 3. `ensureMeetingCompatibility` 跨 service 调用
- **现状**：几乎每个 public 方法都调用此方法做数据兼容
- **方案**：放在 `MeetingLifecycleService` 中，其他 service 注入 LifecycleService 调用。LifecycleService 作为数据层基础服务，不依赖上层 service

### 4. `addSystemMessage` 跨 service 调用
- **现状**：Lifecycle、Participant、Orchestration 都需要发系统消息
- **方案**：放在 `MeetingMessageService` 中，其他 service 注入调用

## 验收标准

- [ ] `meeting.service.ts` 瘦身至 150 行以内（Facade）
- [ ] 7 个子 service 各不超过 500 行
- [ ] Controller 层零改动
- [ ] TypeScript 编译 + Lint 通过
- [ ] 所有会议功能回归正常
