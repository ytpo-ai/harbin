# Meeting Service 拆分架构设计

> 创建时间：2026-03-24
> 关联 Plan：`docs/plan/MEETING_SERVICE_SPLIT_PLAN.md`

## 1. 现状分析

### 1.1 文件概况

| 指标 | 值 |
|------|-----|
| 文件 | `backend/src/modules/meetings/meeting.service.ts` |
| 总行数 | 2313 |
| 文件大小 | 77KB |
| 方法总数 | 78（13 public + 65 private） |
| 功能域数 | 14 |
| 外部依赖 | 5 个注入（MeetingModel, AgentClientService, EmployeeService, RedisService, MessagesService） |
| 外部消费者 | 仅 `MeetingController`（Controller 直接注入 MeetingService） |
| 模块导出 | `MeetingModule` 仅被 `AppModule` 导入，无其他模块依赖 |

### 1.2 当前 14 个功能域及方法清单

#### Domain 1: 会议生命周期（CRUD + 状态转换）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `createMeeting` | public | 857-956 | 创建会议，解析 host 的专属助理、去重参与者 |
| `startMeeting` | public | 958-1017 | PENDING → ACTIVE，标记参与者在线，发系统消息 |
| `endMeeting` | public | 1019-1060 | → ENDED，清理状态，发布 meeting-ended 内部事件 |
| `pauseMeeting` | public | 1062-1086 | ACTIVE → PAUSED |
| `resumeMeeting` | public | 1088-1111 | PAUSED → ACTIVE |
| `archiveMeeting` | public | 1172-1193 | ENDED → ARCHIVED |
| `deleteMeeting` | public | 1195-1216 | 删除会议（仅 PENDING/ENDED/ARCHIVED） |
| `updateMeetingTitle` | public | 1141-1170 | 更新标题 |
| `updateSpeakingMode` | public | 1113-1139 | 更新发言模式 |
| `ensureMeetingCompatibility` | private | 837-855 | 向后兼容：回填缺失字段 |
| `normalizeSpeakingMode` | private | 111-116 | 规范化发言模式字符串 |

#### Domain 2: 参与者管理

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `joinMeeting` | public | 1218-1283 | 参与者加入会议 |
| `leaveMeeting` | public | 1285-1317 | 参与者离开会议 |
| `inviteParticipant` | public | 1426-1489 | 邀请参与者 |
| `addParticipant` | public | 1491-1548 | 添加参与者 |
| `removeParticipant` | public | 1550-1602 | 移除参与者 |
| `getEmployeeOrThrow` | private | 242-249 | 获取员工或抛异常 |
| `getRequiredExclusiveAssistantAgentId` | private | 250-263 | 获取员工的专属助理 Agent ID |
| `upsertExclusiveAssistantParticipant` | private | 265-297 | 插入/更新专属助理参与者记录 |
| `maybeRenameExpandedOneToOneMeeting` | private | 777-820 | 1对1 扩展时自动重命名 |
| `getExpandedMeetingTitle` | private | 768-776 | 标题转换工具 |
| `isHiddenAgentForMeeting` | private | 755-766 | 判断是否隐藏 Agent |

#### Domain 3: 参与者上下文与显示名

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `buildParticipantContextProfiles` | private | 343-429 | 批量构建参与者 profile |
| `formatParticipantContextSummary` | private | 431-443 | 格式化上下文摘要文本 |
| `buildParticipantDisplayNameMap` | private | 445-452 | 构建 displayName Map |
| `resolveMessageSenderDisplayName` | private | 453-463 | 解析消息发送者显示名 |
| `resolveParticipantDisplayName` | private | 465-497 | 解析单个参与者显示名 |
| `appendParticipantContextSystemMessage` | private | 499-514 | 追加参与者上下文系统消息 |

#### Domain 4: 消息发送

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `sendMessage` | public | 1319-1424 | 核心消息发送，代理转发，触发 Agent 响应 |
| `addSystemMessage` | private | 2022-2062 | 添加系统消息 |
| `analyzeMessageType` | private | 2149-2165 | 消息类型启发式分析 |

#### Domain 5: 消息控制（暂停/撤回）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `pauseMessageResponse` | public | 2189-2223 | 暂停 Agent 对消息的响应 |
| `revokePausedMessage` | public | 2225-2280 | 撤回已暂停消息 |
| `hasAgentRepliedToMessage` | private | 2167-2175 | 检查是否已有 Agent 回复 |
| `getMessageById` | private | 2177-2180 | 按 ID 查找消息 |
| `assertMessageController` | private | 2182-2187 | 校验操作权限 |

#### Domain 6: Agent 响应编排

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `triggerAgentResponses` | private | 1685-1835 | 核心编排入口：决定哪些 Agent 响应 |
| `generateAgentResponse` | private | 1837-1913 | 生成单个 Agent 响应 |
| `buildMeetingResponseContext` | private | 1915-1955 | 构建 Agent 响应的聊天上下文 |
| `catchUpAgent` | private | 1957-2020 | Agent 加入后的追赶摘要 |
| `buildMeetingTeamContext` | private | 224-240 | 构建团队协作上下文 |
| `buildMeetingResponseTaskDescription` | private | 213-222 | 构建任务描述 |
| `pickModelManagementResponder` | private | 821-835 | 选取模型管理 Agent |

#### Domain 7: Agent 状态管理（Redis）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `buildMeetingAgentStateKey` | private | 118-120 | 构建 Redis key |
| `buildMeetingAgentStatePattern` | private | 122-124 | 构建 Redis 扫描 pattern |
| `setAgentState` | private | 126-154 | 设置 Agent 状态 |
| `clearAgentThinking` | private | 156-177 | 清除单个 Agent thinking 状态 |
| `clearAllMeetingAgentThinking` | private | 179-182 | 清除会议所有 Agent thinking |
| `getMeetingAgentStates` | public | 1612-1643 | 获取会议所有 Agent 状态 |

#### Domain 8: 响应去重

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `buildResponseDedupKey` | private | 184-194 | 构建去重 key |
| `shouldProcessResponse` | private | 196-211 | 15s 窗口去重检查 |

#### Domain 9: @提及解析

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `extractMentionTokens` | private | 299-320 | 正则提取 @name |
| `buildMentionAliases` | private | 322-341 | 构建 Agent 别名集合 |
| `resolveMentionedAgentIds` | private | 516-557 | 解析 @提及到 Agent ID |

#### Domain 10: 意图检测（方括号命令）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `isLatestModelSearchIntent` | private | 559-561 | 检测模型搜索命令 |
| `isModelListIntent` | private | 563-565 | 检测模型列表命令 |
| `isMemoRecordIntent` | private | 567-569 | 检测备忘录命令 |
| `isModelManagementIntent` | private | 571-573 | 组合：模型相关意图 |
| `isOperationLogIntent` | private | 575-577 | 检测操作日志命令 |
| `isAgentListIntent` | private | 579-581 | 检测 Agent 列表命令 |
| `hasBracketPhraseIntent` | private | 583-591 | 通用方括号命令匹配 |
| `extractBracketCommands` | private | 593-609 | 提取所有方括号命令 |
| `normalizeIntentPhrase` | private | 611-616 | 意图短语规范化 |

#### Domain 11: 专项意图响应器（MCP 工具调用）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `respondWithOperationLogSummary` | private | 663-707 | 执行操作日志 MCP 工具 |
| `respondWithAgentListSummary` | private | 709-753 | 执行 Agent 列表 MCP 工具 |
| `formatOperationLogResponse` | private | 618-635 | 格式化操作日志响应 |
| `formatAgentListResponse` | private | 637-661 | 格式化 Agent 列表响应 |

#### Domain 12: 查询（只读）

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `getMeeting` | public | 1604-1606 | 获取单个会议 |
| `getMeetingDetail` | public | 1608-1610 | 获取会议详情 |
| `getAllMeetings` | public | 1645-1653 | 获取全部会议（可筛选） |
| `getMeetingsByParticipant` | public | 1655-1666 | 按参与者查询会议 |
| `getMeetingStats` | public | 1668-1683 | 聚合统计 |

#### Domain 13: 会议总结

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `generateMeetingSummary` | public | 2096-2135 | 保存会议总结 |
| `normalizeSummaryItems` | private | 2137-2147 | 清洗总结条目 |
| `publishMeetingEndedSummaryEvent` | private | 2064-2094 | 发布 meeting-ended 内部消息 |

#### Domain 14: SSE/事件系统

| 方法 | 可见性 | 行号 | 描述 |
|------|--------|------|------|
| `subscribeToEvents` | public | 2282-2287 | 注册事件回调 |
| `unsubscribeFromEvents` | public | 2289-2295 | 注销事件回调 |
| `emitEvent` | private | 2297-2313 | 发布事件（Redis + 内存） |

---

## 2. 拆分后架构

### 2.1 服务层级依赖关系图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         MeetingController                                │
│                    （零改动，只注入 MeetingService）                        │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     MeetingService (Facade)                               │
│           注入所有 7 个子 service，每个方法一行委派调用                       │
│                         ~120-150 行                                       │
└──────┬─────────┬──────────┬──────────┬──────────┬───────────┬────────────┘
       │         │          │          │          │           │
       ▼         ▼          ▼          ▼          ▼           ▼
  Lifecycle  Participant  Message  Orchestration  Summary  AgentState
  Service    Service      Service    Service      Service   Service
                                                              │
       └─────────┴──────────┴──────────┴──────────┴───────────┘
                               │
                               ▼
                      MeetingEventService
                      （最底层，无 service 依赖）
```

### 2.2 详细依赖关系图（含调用方向）

```
                              ┌─────────────────┐
                              │  External Deps   │
                              │                  │
                              │ • MeetingModel   │
                              │ • AgentClient    │
                              │ • EmployeeService│
                              │ • RedisService   │
                              │ • MessagesService│
                              └────────┬─────────┘
                                       │ (injected by NestJS)
     ┌─────────────────────────────────┼──────────────────────────────────┐
     │                                 │                                  │
     │    ┌────────────────────────────┼────────────────────────────┐     │
     │    │         Layer 0: Foundation (无 meeting service 依赖)    │     │
     │    │                                                         │     │
     │    │  ┌─────────────────────┐                                │     │
     │    │  │ MeetingEventService │  Redis pub + in-memory          │     │
     │    │  │                     │  listeners                      │     │
     │    │  │ • subscribeToEvents │                                 │     │
     │    │  │ • unsubscribeFrom.. │  Deps: RedisService             │     │
     │    │  │ • emitEvent         │                                 │     │
     │    │  └──────────┬──────────┘                                │     │
     │    └─────────────┼───────────────────────────────────────────┘     │
     │                  │                                                 │
     │    ┌─────────────┼───────────────────────────────────────────┐     │
     │    │  Layer 1: Infrastructure (依赖 Layer 0)                  │     │
     │    │                                                         │     │
     │    │  ┌──────────────────────────┐                           │     │
     │    │  │ MeetingAgentStateService  │  Redis-backed state       │     │
     │    │  │                           │                           │     │
     │    │  │ • setAgentState           │  Deps: RedisService,      │     │
     │    │  │ • clearAgentThinking      │        EventService       │     │
     │    │  │ • clearAllMeeting...      │                           │     │
     │    │  │ • getMeetingAgentStates   │                           │     │
     │    │  └──────────────────────────┘                           │     │
     │    └─────────────────────────────────────────────────────────┘     │
     │                  │                                                 │
     │    ┌─────────────┼───────────────────────────────────────────┐     │
     │    │  Layer 2: Core Domain Services (依赖 Layer 0 + 1)       │     │
     │    │                                                         │     │
     │    │  ┌───────────────────────┐  ┌────────────────────────┐  │     │
     │    │  │ MeetingLifecycleServ. │  │ MeetingParticipantServ.│  │     │
     │    │  │                       │  │                        │  │     │
     │    │  │ • createMeeting       │  │ • joinMeeting          │  │     │
     │    │  │ • startMeeting        │  │ • leaveMeeting         │  │     │
     │    │  │ • endMeeting          │  │ • inviteParticipant    │  │     │
     │    │  │ • pauseMeeting        │  │ • addParticipant       │  │     │
     │    │  │ • resumeMeeting       │  │ • removeParticipant    │  │     │
     │    │  │ • archiveMeeting      │  │ • buildParticipant...  │  │     │
     │    │  │ • deleteMeeting       │  │ • resolveParticipant.. │  │     │
     │    │  │ • updateTitle         │  │ • getRequired...       │  │     │
     │    │  │ • updateSpeakingMode  │  │ • upsertExclusive...   │  │     │
     │    │  │ • getMeeting          │  └───────────┬────────────┘  │     │
     │    │  │ • getAllMeetings       │              │               │     │
     │    │  │ • getMeetingsByPart..  │              │               │     │
     │    │  │ • getMeetingStats      │              │               │     │
     │    │  │ • ensureMeetingCompat  │              │               │     │
     │    │  └───────────┬───────────┘              │               │     │
     │    │              │                          │               │     │
     │    │  Deps:       │    Deps:                 │               │     │
     │    │  MeetingModel│    MeetingModel           │               │     │
     │    │  EventService│    EmployeeService        │               │     │
     │    │  AgentState  │    AgentClientService     │               │     │
     │    │  Employee    │    EventService           │               │     │
     │    │  AgentClient │    MessageService(*)      │               │     │
     │    │  MessageSvc  │    LifecycleService       │               │     │
     │    │  Participant │    OrchestrationSvc(**)   │               │     │
     │    │  SummarySvc  │                           │               │     │
     │    └──────────────┼───────────────────────────┘───────────────┘     │
     │                   │                                                 │
     │    ┌──────────────┼───────────────────────────────────────────┐     │
     │    │  Layer 3: Business Logic (依赖 Layer 0 + 1 + 2)          │     │
     │    │                                                          │     │
     │    │  ┌──────────────────────────┐  ┌──────────────────────┐  │     │
     │    │  │ MeetingMessageService    │  │ MeetingSummaryService│  │     │
     │    │  │                          │  │                      │  │     │
     │    │  │ • sendMessage            │  │ • generateMeeting... │  │     │
     │    │  │ • addSystemMessage       │  │ • publishMeeting...  │  │     │
     │    │  │ • pauseMessageResponse   │  │ • normalizeSummary.. │  │     │
     │    │  │ • revokePausedMessage    │  │                      │  │     │
     │    │  │ • analyzeMessageType     │  │ Deps:                │  │     │
     │    │  │                          │  │ MeetingModel         │  │     │
     │    │  │ Deps:                    │  │ AgentClientService   │  │     │
     │    │  │ MeetingModel             │  │ EventService         │  │     │
     │    │  │ MessagesService          │  │ LifecycleService     │  │     │
     │    │  │ EventService             │  └──────────────────────┘  │     │
     │    │  │ AgentStateService        │                            │     │
     │    │  │ LifecycleService         │                            │     │
     │    │  │ ParticipantService       │                            │     │
     │    │  └────────────┬─────────────┘                            │     │
     │    └───────────────┼──────────────────────────────────────────┘     │
     │                    │                                                │
     │    ┌───────────────┼──────────────────────────────────────────┐     │
     │    │  Layer 4: Orchestration (依赖 Layer 0 + 1 + 2 + 3)      │     │
     │    │                                                          │     │
     │    │  ┌────────────────────────────────────┐                  │     │
     │    │  │ MeetingOrchestrationService        │                  │     │
     │    │  │                                    │                  │     │
     │    │  │ • triggerAgentResponses             │                  │     │
     │    │  │ • generateAgentResponse             │                  │     │
     │    │  │ • buildMeetingResponseContext       │                  │     │
     │    │  │ • catchUpAgent                      │                  │     │
     │    │  │ • extractMentionTokens              │                  │     │
     │    │  │ • resolveMentionedAgentIds          │                  │     │
     │    │  │ • is*Intent (意图检测)               │                  │     │
     │    │  │ • respondWith*Summary (MCP调用)     │                  │     │
     │    │  │                                    │                  │     │
     │    │  │ Deps:                              │                  │     │
     │    │  │ MeetingModel, AgentClientService,  │                  │     │
     │    │  │ EventService, AgentStateService,   │                  │     │
     │    │  │ MessageService, ParticipantService,│                  │     │
     │    │  │ LifecycleService                   │                  │     │
     │    │  └────────────────────────────────────┘                  │     │
     │    └──────────────────────────────────────────────────────────┘     │
     │                                                                     │
     └─────────────────────────────────────────────────────────────────────┘
```

### 2.3 循环依赖分析与解决方案

拆分后存在 **2 处潜在循环依赖**，需要特殊处理：

#### 循环 1：MessageService ↔ OrchestrationService

```
sendMessage (MessageService)
  └── triggerAgentResponses (OrchestrationService)
        └── generateAgentResponse
              └── sendMessage (MessageService)  ← 循环！
```

**解决方案：回调注入模式**

```typescript
// meeting-message.service.ts
@Injectable()
export class MeetingMessageService {
  // 可选的后处理钩子，由外部（Facade）注入
  private onHumanMessageSentHook?: (meetingId: string, message: any, meeting: MeetingDocument) => Promise<void>;

  setOnHumanMessageSentHook(hook: (meetingId: string, message: any, meeting: MeetingDocument) => Promise<void>) {
    this.onHumanMessageSentHook = hook;
  }

  async sendMessage(meetingId: string, dto: MeetingMessageDto) {
    // ... 原有逻辑 ...
    
    // 末尾：触发 Agent 响应（通过钩子，不直接依赖 OrchestrationService）
    if (this.onHumanMessageSentHook && isHumanProxyMessage) {
      this.onHumanMessageSentHook(meetingId, message, updatedMeeting).catch(err => {
        this.logger.error('Agent response trigger failed', err);
      });
    }
  }
}

// meeting.service.ts (Facade) — 在 onModuleInit 中组装
@Injectable()
export class MeetingService implements OnModuleInit {
  onModuleInit() {
    // 把 orchestrationService.triggerAgentResponses 绑定到 messageService 的钩子
    this.messageService.setOnHumanMessageSentHook(
      (meetingId, message, meeting) =>
        this.orchestrationService.triggerAgentResponses(meetingId, message, meeting),
    );
  }
}
```

**优点**：MessageService 不感知 OrchestrationService 的存在，依赖方向单向  
**备选**：使用 `forwardRef`，但会增加隐式耦合

#### 循环 2：ParticipantService → OrchestrationService (catchUpAgent)

```
joinMeeting / inviteParticipant (ParticipantService)
  └── catchUpAgent (OrchestrationService)
```

**解决方案：同样使用回调注入模式**

```typescript
// meeting-participant.service.ts
@Injectable()
export class MeetingParticipantService {
  private onAgentJoinedActiveHook?: (meetingId: string, agentId: string, meeting: MeetingDocument) => Promise<void>;

  setOnAgentJoinedActiveHook(hook: ...) {
    this.onAgentJoinedActiveHook = hook;
  }

  async joinMeeting(...) {
    // ... 原有逻辑 ...
    if (needsCatchUp && this.onAgentJoinedActiveHook) {
      this.onAgentJoinedActiveHook(meetingId, agentId, meeting).catch(err => {
        this.logger.error('Agent catch-up failed', err);
      });
    }
  }
}

// meeting.service.ts (Facade) — onModuleInit 中组装
this.participantService.setOnAgentJoinedActiveHook(
  (meetingId, agentId, meeting) =>
    this.orchestrationService.catchUpAgent(meetingId, agentId, meeting),
);
```

### 2.4 共享方法归属策略

| 共享方法 | 归属 Service | 被调用方 | 访问方式 |
|----------|-------------|---------|---------|
| `ensureMeetingCompatibility` | **LifecycleService** | Participant, Message, Orchestration, Summary | 注入 LifecycleService 调用 |
| `emitEvent` | **EventService** | 全部 service | 注入 EventService 调用 |
| `addSystemMessage` | **MessageService** | Lifecycle, Participant, Orchestration | 注入 MessageService 调用 |
| `getRequiredExclusiveAssistantAgentId` | **ParticipantService** | Lifecycle, Message | 注入 ParticipantService 调用 |
| `upsertExclusiveAssistantParticipant` | **ParticipantService** | Lifecycle | 注入 ParticipantService 调用 |
| `buildParticipantContextProfiles` | **ParticipantService** | Orchestration | 注入 ParticipantService 调用 |
| `buildParticipantDisplayNameMap` | **ParticipantService** | Orchestration | 注入 ParticipantService 调用 |
| `resolveMessageSenderDisplayName` | **ParticipantService** | Orchestration | 注入 ParticipantService 调用 |
| `getMessageById` | **MessageService** | Orchestration | 注入 MessageService 调用 |

---

## 3. 各子 Service 详细设计

### 3.1 MeetingEventService（Layer 0）

**职责**：SSE 事件发布与订阅的统一入口

```typescript
@Injectable()
export class MeetingEventService {
  private readonly logger = new Logger(MeetingEventService.name);
  private eventListeners = new Map<string, ((event: MeetingEvent) => void)[]>();

  constructor(private readonly redisService: RedisService) {}

  subscribeToEvents(meetingId: string, callback: (event: MeetingEvent) => void): void;
  unsubscribeFromEvents(meetingId: string, callback: (event: MeetingEvent) => void): void;
  async emitEvent(event: MeetingEvent): Promise<void>;
}
```

**外部依赖**：`RedisService`  
**内部依赖**：无

---

### 3.2 MeetingAgentStateService（Layer 1）

**职责**：Agent 在会议中的 thinking/idle 状态管理（Redis 读写 + 事件通知）

```typescript
@Injectable()
export class MeetingAgentStateService {
  private readonly meetingAgentStateKeyPrefix = 'meeting:agent-state';
  private readonly meetingAgentStateTtlSeconds = 90;

  constructor(
    private readonly redisService: RedisService,
    private readonly eventService: MeetingEventService,
  ) {}

  async setAgentState(meetingId: string, payload: MeetingAgentStatePayload): Promise<void>;
  async clearAgentThinking(meetingId: string, agentId: string, guardToken?: string): Promise<void>;
  async clearAllMeetingAgentThinking(meetingId: string): Promise<void>;
  async getMeetingAgentStates(meetingId: string): Promise<MeetingAgentStatePayload[]>;
  
  // private
  private buildMeetingAgentStateKey(meetingId: string, agentId: string): string;
  private buildMeetingAgentStatePattern(meetingId: string): string;
}
```

**外部依赖**：`RedisService`  
**内部依赖**：`MeetingEventService`

---

### 3.3 MeetingLifecycleService（Layer 2）

**职责**：会议 CRUD、状态转换、查询统计、数据兼容性保障

```typescript
@Injectable()
export class MeetingLifecycleService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly employeeService: EmployeeService,
    private readonly agentClientService: AgentClientService,
    // 以下通过 Lazy 注入或 Facade 组装
    private readonly messagesService: MessagesService,
  ) {}

  // === 公开方法 ===
  async createMeeting(dto: CreateMeetingDto): Promise<MeetingDocument>;
  async startMeeting(id: string, startedBy: ParticipantIdentity): Promise<MeetingDocument>;
  async endMeeting(id: string): Promise<MeetingDocument>;
  async pauseMeeting(id: string): Promise<MeetingDocument>;
  async resumeMeeting(id: string): Promise<MeetingDocument>;
  async archiveMeeting(id: string): Promise<MeetingDocument>;
  async deleteMeeting(id: string): Promise<void>;
  async updateMeetingTitle(id: string, title: string): Promise<MeetingDocument>;
  async updateSpeakingMode(id: string, mode: MeetingSpeakingMode): Promise<MeetingDocument>;
  async getMeeting(id: string): Promise<MeetingDocument | null>;
  async getMeetingDetail(id: string): Promise<MeetingDocument | null>;
  async getAllMeetings(filters?: { type?: MeetingType; status?: MeetingStatus }): Promise<MeetingDocument[]>;
  async getMeetingsByParticipant(participantId: string, type: 'employee' | 'agent'): Promise<MeetingDocument[]>;
  async getMeetingStats(): Promise<any>;

  // === 共享工具方法（供其他 service 注入调用）===
  async ensureMeetingCompatibility(meeting: MeetingDocument): Promise<MeetingDocument>;
  normalizeSpeakingMode(mode?: string): MeetingSpeakingMode;
}
```

**外部依赖**：`MeetingModel`, `EmployeeService`, `AgentClientService`, `MessagesService`  
**内部依赖**：`MeetingEventService`, `MeetingAgentStateService`  
**跨层回调**（由 Facade 组装）：
- `startMeeting` 需要调用 ParticipantService 的 `appendParticipantContextSystemMessage` → 通过回调钩子
- `endMeeting` 需要调用 SummaryService 的 `publishMeetingEndedSummaryEvent` → 通过回调钩子
- `createMeeting` 需要调用 ParticipantService 的 `getRequiredExclusiveAssistantAgentId`, `upsertExclusiveAssistantParticipant` → 直接注入 ParticipantService（无循环）

---

### 3.4 MeetingParticipantService（Layer 2）

**职责**：参与者全生命周期管理 + 上下文构建 + 显示名解析

```typescript
@Injectable()
export class MeetingParticipantService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly employeeService: EmployeeService,
    private readonly agentClientService: AgentClientService,
    private readonly eventService: MeetingEventService,
    private readonly lifecycleService: MeetingLifecycleService,
  ) {}

  // === 参与者管理 ===
  async joinMeeting(id: string, participant: ParticipantIdentity): Promise<MeetingDocument>;
  async leaveMeeting(id: string, participant: ParticipantIdentity): Promise<MeetingDocument>;
  async inviteParticipant(id: string, participant: ParticipantIdentity, invitedBy: ParticipantIdentity): Promise<MeetingDocument>;
  async addParticipant(id: string, participant: ParticipantIdentity): Promise<MeetingDocument>;
  async removeParticipant(id: string, participantId: string, participantType: string): Promise<MeetingDocument>;

  // === 专属助理管理 ===
  async getEmployeeOrThrow(employeeId: string): Promise<any>;
  async getRequiredExclusiveAssistantAgentId(employeeId: string): Promise<string>;
  upsertExclusiveAssistantParticipant(participants: any[], agentId: string, employeeId: string, role: ParticipantRole): void;

  // === 上下文与显示名（供 Orchestration 等调用）===
  async buildParticipantContextProfiles(meeting: MeetingDocument): Promise<ParticipantContextProfile[]>;
  formatParticipantContextSummary(profiles: ParticipantContextProfile[]): string;
  buildParticipantDisplayNameMap(profiles: ParticipantContextProfile[]): Map<string, string>;
  resolveMessageSenderDisplayName(msg: any, nameMap: Map<string, string>): string;
  async resolveParticipantDisplayName(participant: any): Promise<string>;
  async appendParticipantContextSystemMessage(meeting: MeetingDocument, type: 'initialized' | 'updated'): Promise<void>;

  // === 内部工具 ===
  isHiddenAgentForMeeting(agent: any): boolean;
  async resolveMentionedAgentIds(content: string, meeting: MeetingDocument): Promise<string[]>;

  // === 回调钩子 ===
  setOnAgentJoinedActiveHook(hook: Function): void;
}
```

**外部依赖**：`MeetingModel`, `EmployeeService`, `AgentClientService`  
**内部依赖**：`MeetingEventService`, `MeetingLifecycleService`（ensureMeetingCompatibility）  
**回调钩子**：`onAgentJoinedActive` → OrchestrationService.catchUpAgent

---

### 3.5 MeetingMessageService（Layer 3）

**职责**：消息发送（含代理转发）、系统消息、消息控制

```typescript
@Injectable()
export class MeetingMessageService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly messagesService: MessagesService,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly participantService: MeetingParticipantService,
  ) {}

  // === 消息发送 ===
  async sendMessage(meetingId: string, dto: MeetingMessageDto): Promise<any>;
  async addSystemMessage(meeting: MeetingDocument, content: string, metadata?: any): Promise<any>;

  // === 消息控制 ===
  async pauseMessageResponse(meetingId: string, messageId: string, employeeId: string): Promise<any>;
  async revokePausedMessage(meetingId: string, messageId: string, employeeId: string): Promise<MeetingDocument>;

  // === 工具方法 ===
  analyzeMessageType(content: string): string;
  getMessageById(meeting: MeetingDocument, messageId: string): any;

  // === 回调钩子 ===
  setOnHumanMessageSentHook(hook: Function): void;

  // private
  private hasAgentRepliedToMessage(meeting: MeetingDocument, messageId: string): boolean;
  private assertMessageController(message: any, employeeId: string): void;
}
```

**外部依赖**：`MeetingModel`, `MessagesService`  
**内部依赖**：`MeetingEventService`, `MeetingAgentStateService`, `MeetingLifecycleService`, `MeetingParticipantService`  
**回调钩子**：`onHumanMessageSent` → OrchestrationService.triggerAgentResponses

---

### 3.6 MeetingOrchestrationService（Layer 4）

**职责**：Agent 响应编排 + 去重 + @提及 + 意图检测 + MCP 工具调用

```typescript
@Injectable()
export class MeetingOrchestrationService {
  private readonly modelManagementAgentName = 'model management agent';
  private readonly responseDedupWindowMs = 15000;
  private readonly recentResponseKeys = new Map<string, number>();
  // ... 所有 intent phrases 常量

  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly eventService: MeetingEventService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly participantService: MeetingParticipantService,
    private readonly messageService: MeetingMessageService,
  ) {}

  // === 核心编排 ===
  async triggerAgentResponses(meetingId: string, triggerMessage: any, meeting: MeetingDocument): Promise<void>;
  async generateAgentResponse(meetingId: string, agentId: string, triggerMessage: any, ...): Promise<void>;
  async catchUpAgent(meetingId: string, agentId: string, meeting: MeetingDocument): Promise<void>;

  // === 上下文构建 ===
  async buildMeetingResponseContext(meeting: MeetingDocument, triggerMessage: any, ...): Promise<ChatMessage[]>;
  buildMeetingTeamContext(meeting: MeetingDocument): any;
  buildMeetingResponseTaskDescription(content: string): string;

  // === @提及解析 ===
  extractMentionTokens(content: string): string[];
  buildMentionAliases(agent: any): Set<string>;
  async resolveMentionedAgentIds(content: string, meeting: MeetingDocument): Promise<string[]>;

  // === 意图检测 ===
  isLatestModelSearchIntent(content: string): boolean;
  isModelListIntent(content: string): boolean;
  isMemoRecordIntent(content: string): boolean;
  isModelManagementIntent(content: string): boolean;
  isOperationLogIntent(content: string): boolean;
  isAgentListIntent(content: string): boolean;
  hasBracketPhraseIntent(content: string, phrases: string[]): boolean;
  extractBracketCommands(content: string): string[];
  normalizeIntentPhrase(phrase: string): string;

  // === 专项意图响应 ===
  async respondWithOperationLogSummary(meetingId: string, agentId: string, ...): Promise<boolean>;
  async respondWithAgentListSummary(meetingId: string, agentId: string, ...): Promise<boolean>;

  // === 响应去重 ===
  private buildResponseDedupKey(...): string;
  private shouldProcessResponse(...): boolean;

  // === 工具 ===
  private pickModelManagementResponder(meeting: MeetingDocument): Promise<any>;
  private formatOperationLogResponse(data: any): string;
  private formatAgentListResponse(data: any): string;
}
```

**外部依赖**：`MeetingModel`, `AgentClientService`  
**内部依赖**：`MeetingEventService`, `MeetingAgentStateService`, `MeetingLifecycleService`, `MeetingParticipantService`, `MeetingMessageService`

---

### 3.7 MeetingSummaryService（Layer 3）

**职责**：会议总结保存 + meeting-ended 内部事件触发

```typescript
@Injectable()
export class MeetingSummaryService {
  constructor(
    @InjectModel(Meeting.name) private meetingModel: Model<MeetingDocument>,
    private readonly agentClientService: AgentClientService,
    private readonly eventService: MeetingEventService,
    private readonly lifecycleService: MeetingLifecycleService,
  ) {}

  async generateMeetingSummary(meetingId: string, dto: SaveMeetingSummaryDto): Promise<any>;
  async publishMeetingEndedSummaryEvent(meeting: MeetingDocument): Promise<void>;
  
  private normalizeSummaryItems(items?: string[]): string[];
}
```

**外部依赖**：`MeetingModel`, `AgentClientService`  
**内部依赖**：`MeetingEventService`, `MeetingLifecycleService`

---

## 4. Facade 层设计

### 4.1 MeetingService (Facade)

```typescript
@Injectable()
export class MeetingService implements OnModuleInit {
  constructor(
    private readonly lifecycleService: MeetingLifecycleService,
    private readonly participantService: MeetingParticipantService,
    private readonly messageService: MeetingMessageService,
    private readonly orchestrationService: MeetingOrchestrationService,
    private readonly summaryService: MeetingSummaryService,
    private readonly agentStateService: MeetingAgentStateService,
    private readonly eventService: MeetingEventService,
  ) {}

  onModuleInit() {
    // 组装循环依赖的回调钩子
    this.messageService.setOnHumanMessageSentHook(
      (meetingId, message, meeting) =>
        this.orchestrationService.triggerAgentResponses(meetingId, message, meeting),
    );
    this.participantService.setOnAgentJoinedActiveHook(
      (meetingId, agentId, meeting) =>
        this.orchestrationService.catchUpAgent(meetingId, agentId, meeting),
    );
  }

  // === 委派方法（每个仅一行）===
  createMeeting(dto) { return this.lifecycleService.createMeeting(dto); }
  startMeeting(id, startedBy) { return this.lifecycleService.startMeeting(id, startedBy); }
  endMeeting(id) { return this.lifecycleService.endMeeting(id); }
  // ... 所有其他公开方法一一委派
}
```

### 4.2 模块注册

```typescript
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Meeting.name, schema: MeetingSchema }]),
    AgentClientModule,
    EmployeeModule,
    MessagesModule,
  ],
  controllers: [MeetingController],
  providers: [
    MeetingEventService,
    MeetingAgentStateService,
    MeetingLifecycleService,
    MeetingParticipantService,
    MeetingMessageService,
    MeetingOrchestrationService,
    MeetingSummaryService,
    MeetingService,  // Facade
  ],
  exports: [MeetingService],
})
export class MeetingModule {}
```

---

## 5. 类型定义文件设计

### 5.1 meeting.types.ts

从 `meeting.service.ts` 头部提取的所有 interface / type / DTO：

```typescript
// meeting.types.ts

export interface MeetingEvent {
  type: 'message' | 'participant_joined' | 'participant_left' | 'status_changed' | 'typing' | 'summary_generated' | 'settings_changed' | 'agent_state_changed';
  meetingId: string;
  data: any;
  timestamp: Date;
}

export type MeetingAgentState = 'thinking' | 'idle';

export interface MeetingAgentStatePayload {
  agentId: string;
  state: MeetingAgentState;
  updatedAt: string;
  reason?: string;
  token?: string;
}

export type MeetingSpeakingMode = 'free' | 'ordered';

export interface ParticipantIdentity {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  isHuman: boolean;
  employeeId?: string;
  agentId?: string;
}

export interface ParticipantContextProfile {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  role: ParticipantRole;
  isPresent: boolean;
  isExclusiveAssistant?: boolean;
  assistantForEmployeeId?: string;
}

export interface CreateMeetingDto {
  title: string;
  description?: string;
  type: MeetingType;
  hostId: string;
  hostType: 'employee' | 'agent';
  participantIds?: Array<{ id: string; type: 'employee' | 'agent' }>;
  agenda?: string;
  scheduledStartTime?: Date;
  settings?: Meeting['settings'];
}

export interface MeetingMessageDto {
  senderId: string;
  senderType: 'employee' | 'agent' | 'system';
  content: string;
  type?: MeetingMessage['type'];
  metadata?: MeetingMessage['metadata'];
}

export interface ControlMeetingMessageDto {
  employeeId: string;
}

export interface SaveMeetingSummaryDto {
  summary: string;
  actionItems?: string[];
  decisions?: string[];
  overwrite?: boolean;
  generatedByAgentId?: string;
}

export type MeetingParticipantRecord = MeetingDocument['participants'][number];
```

---

## 6. NestJS 依赖注入矩阵

各子 service 注入依赖一览（`✓` = 直接注入，`⟳` = 需要 forwardRef 或回调钩子）：

| 被注入 → | EventSvc | AgentStateSvc | LifecycleSvc | ParticipantSvc | MessageSvc | OrchestrationSvc | SummarySvc |
|----------|----------|---------------|-------------|----------------|------------|-------------------|-----------|
| **EventSvc** | — | | | | | | |
| **AgentStateSvc** | ✓ | — | | | | | |
| **LifecycleSvc** | ✓ | ✓ | — | | | | |
| **ParticipantSvc** | ✓ | | ✓ | — | | ⟳ (hook) | |
| **MessageSvc** | ✓ | ✓ | ✓ | ✓ | — | ⟳ (hook) | |
| **OrchestrationSvc** | ✓ | ✓ | ✓ | ✓ | ✓ | — | |
| **SummarySvc** | ✓ | | ✓ | | | | — |

**注**：`⟳` 标记的依赖不直接注入，而是由 Facade 在 `onModuleInit` 中通过回调钩子绑定。

---

## 7. 迁移策略

采用**逐层拆出、逐步验证**的策略：

```
Step 1: meeting.types.ts (类型)         → 编译验证
Step 2: MeetingEventService (Layer 0)    → 编译验证
Step 3: MeetingAgentStateService (L1)    → 编译验证
Step 4: MeetingLifecycleService (L2)     → 编译验证
Step 5: MeetingParticipantService (L2)   → 编译验证
Step 6: MeetingMessageService (L3)       → 编译验证
Step 7: MeetingOrchestrationService (L4) → 编译验证
Step 8: MeetingSummaryService (L3)       → 编译验证
Step 9: Facade 改造 + Module 更新        → 全量回归
```

每步完成后：
1. `npm run build` 确认 TypeScript 编译通过
2. 确认原 `meeting.service.ts` 中已迁移的代码被删除或委派
3. 最后一步做完整功能回归测试
