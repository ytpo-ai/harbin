# Meeting Chat（会议聊天）

## 1. 功能设计

### 1.1 目标

- 支持员工和 Agent 同时参与会议，实现实时语音/文字协作
- 人类员工直接以 employee 身份发言，消息链路不再经过专属助理代理改写
- Agent 能够自主理解会议上下文并参与讨论，提供智能辅助
- 支持会议全生命周期管理（创建、加入、发言、离开、结束、归档）

### 1.2 数据结构

```typescript
// Schema 定义: backend/src/shared/schemas/meeting.schema.ts
enum MeetingType {
  WEEKLY = 'weekly',           // 周会
  BOARD = 'board',             // 董事会
  DAILY = 'daily',             // 日常讨论
  DEPARTMENT = 'department',   // 部门会议
  AD_HOC = 'ad_hoc',           // 临时会议
  PROJECT = 'project',         // 项目会议
  EMERGENCY = 'emergency',     // 紧急会议
}

enum MeetingStatus {
  PENDING = 'pending',         // 待开始
  ACTIVE = 'active',           // 进行中
  PAUSED = 'paused',           // 已暂停
  ENDED = 'ended',             // 已结束
  ARCHIVED = 'archived',       // 已归档
}

enum ParticipantRole {
  HOST = 'host',               // 主持人
  PARTICIPANT = 'participant', // 参与者
  OBSERVER = 'observer',       // 观察者
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 会议唯一标识 (UUID) |
| `title` | string | 会议标题 |
| `description` | string | 会议描述 |
| `type` | MeetingType | 会议类型 |
| `status` | MeetingStatus | 会议状态 |
| `hostId` | string | 主持人ID（employeeId 或 agentId） |
| `hostType` | 'employee' \| 'agent' | 主持人类型 |
| `participants` | MeetingParticipant[] | 参会人员列表 |
| `messages` | MeetingMessage[] | 会议消息列表 |
| `agenda` | string | 会议议程 |
| `scheduledStartTime` | Date | 计划开始时间 |
| `startedAt` | Date | 实际开始时间 |
| `endedAt` | Date | 结束时间 |
| `settings` | Object | 会议设置（最大人数、发言模式等） |
| `summary` | Object | 会议总结（AI生成） |
| `messageCount` | number | 消息数量 |

#### MeetingParticipant

| 字段 | 类型 | 说明 |
|------|------|------|
| `participantId` | string | 参与者ID |
| `participantType` | 'employee' \| 'agent' | 参与者类型 |
| `role` | ParticipantRole | 角色 |
| `isPresent` | boolean | 是否在场 |
| `hasSpoken` | boolean | 是否发过言 |
| `messageCount` | number | 发言次数 |
| `joinedAt` | Date | 加入时间 |
| `leftAt` | Date | 离开时间 |
| `isExclusiveAssistant` | boolean | 历史兼容字段（新数据不再写入） |
| `assistantForEmployeeId` | string | 历史兼容字段（新数据不再写入） |

#### MeetingMessage

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 消息ID |
| `senderId` | string | 发送者ID |
| `senderType` | 'employee' \| 'agent' \| 'system' | 发送者类型 |
| `content` | string | 消息内容 |
| `type` | string | 消息类型（opinion/question/agreement/disagreement/suggestion/conclusion/introduction/action_item） |
| `timestamp` | Date | 时间戳 |
| `metadata` | Object | 扩展字段（@提及、回复、情感分析等；代理相关字段仅保留历史兼容） |

### 1.3 核心逻辑

#### 1.3.1 会议生命周期

| 状态 | 可执行操作 |
|------|-----------|
| PENDING | 开始(Start)、删除(Delete)、邀请(Invite) |
| ACTIVE | 发言(SendMessage)、暂停(Pause)、结束(End)、加入(Join)、离开(Leave) |
| PAUSED | 恢复(Resume)、结束(End) |
| ENDED | 归档(Archive)、删除(Delete) |
| ARCHIVED | 删除(Delete) |

#### 1.3.2 员工直接发言机制

- 员工创建/加入/发言均使用 employee 身份，不再依赖专属助理绑定状态
- 新消息存储为 `senderType = 'employee'`、`senderId = employeeId`
- 历史代理消息（`metadata.isAIProxy/proxyForEmployeeId`）仅用于前端兼容识别

#### 1.3.3 Agent 响应机制

- 人类发言后，在场 Agent 自动响应
- 通过 Redis 维护 Agent 状态（thinking/idle），避免重复响应
- 响应去重：15秒内相同触发消息不重复生成响应
- 支持 @ 提及特定 Agent
- 所有在场 Agent 统一走响应编排，不再区分专属助理特殊规则

#### 1.3.4 意图路由

- **模型查询意图**：检测到"最新模型"/"模型列表"时，路由至模型管理 Agent
- **操作日志意图**：检测到"操作日志"相关查询时，由命中的在场 Agent 执行日志检索
- **Agent 列表意图**：检测到"有哪些 Agent/Agent 列表"时，优先走 `agents_mcp_list` 轻量查询通道（chat query），避免创建任务执行生命周期
- **冲突裁剪规则**：当消息命中“记录/追加备忘录”类显式动作时，屏蔽模型查询意图提示，优先执行当前用户动作
- **识别策略收敛**：意图识别改为“方括号显式短语命中优先”（`[短语]` / `【短语】`），删除弱信号宽匹配分支，降低误触发
- **@ 提及匹配收敛**：`resolveMentionedAgentIds` 删除短前缀模糊匹配，仅保留精确别名命中

#### 1.3.5 会议上下文

- Agent 入场时自动 catch-up：获取最近5条消息并生成入场发言
- 会议结束时由 Meeting Service 发布 `meeting.ended` inner message，并由统一 Agent Runtime 消息桥接触发 `meeting-assistant` 执行；是否生成总结由 Agent 自主决策并可调用 `meeting.generate-summary` 工具。
- 会议结束时同时发布消息中心事件 `meeting.session.ended` 到 Redis Streams，由 Message Center 消费并生成系统通知。
- 会议执行链路由 ContextAssembler 统一注入 system context；Meeting Service 仅传递会话历史（user/assistant）与触发用户消息，不再在 `task.messages` 注入 system prompt
- 会议上下文采用分层注入与 fingerprint 抑制：静态/半静态 blocks（身份基线、领域、协作、工具规格、任务信息）仅在首次或变更时注入，变更时优先增量
- runtime 持久化分层：初始 system 快照写入 `run.metadata.initialSystemMessages` 供审计。
- 历史描述“`agent_messages` 不落盘 system 消息”（已弃用）：当前实现在部分 tool-calling 分支会落库中间 system 消息。
- 会议分配执行遵循闭环规则：优先由 `meeting-sensitive-planner` 技能约束“一次确认后自动执行”，回执优先输出“已分配 + 已通知 + 下一检查点”三段式结构
- 会议异常兜底：优先由 `meeting-resilience` 技能处理空回复/生成异常；未命中技能时自动重试一次，仍为空则返回“操作进行中，1 分钟内补充回执。”
- 系统上下文注入顺序改为由 builder 链统一编排（identity -> toolset -> domain -> collaboration -> task -> memory），避免多源 system prompt 冲突
- Runtime 会话落盘顺序优化：首轮运行仅落盘触发 user 消息，system 上下文通过 run metadata 审计
- 工具可用清单展示精简为 `name | description`，减少大 JSON 参数块对会话上下文的噪音

#### 1.3.6 消息发送交互保护

- 输入框在 IME 组合输入期间（如拼音）按 Enter 不触发发送，避免误发送。
- 人类消息（employee 直接发送）在未收到 Agent 回复前支持“暂停回复”。
- 处于“已暂停回复”的消息支持撤回；撤回后消息会从会议消息流移除。
- 若消息已产生回复（`metadata.relatedMessageId` 命中），则不可再暂停或撤回。

#### 1.3.7 前端页面分层架构（Meetings Page Split）

- `frontend/src/pages/Meetings.tsx` 保留为路由兼容层，仅做 `re-export`。
- 会议页主实现迁移至 `frontend/src/pages/meetings/index.tsx`，作为页面编排入口。
- 查询/写操作/实时订阅/输入辅助拆分为 hooks：
  - `useMeetingQueries`、`useMeetingMutations`、`useMeetingSelection`、`useMeetingRealtime`
  - `useMentionAutocomplete`、`usePhraseAutocomplete`、`useMessageHistory`
- UI 按边界拆分为组件：会议列表、头部、状态菜单、参与者行、消息列表、输入框、摘要面板、操作侧栏、创建弹窗。
- 状态菜单改为配置驱动渲染（按 `MeetingStatus` 映射动作），避免多分支重复 JSX。

### 1.4 API（backend/src/modules/meetings/）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/meetings` | 创建会议 |
| GET | `/meetings` | 获取所有会议 |
| GET | `/meetings/stats` | 获取会议统计 |
| GET | `/meetings/by-participant/:participantId` | 获取参与者参与的会议 |
| GET | `/meetings/:id` | 获取会议详情 |
| GET | `/meetings/:id/detail` | 获取会议详情（含消息明细） |
| GET | `/meetings/:id/agent-states` | 获取 Agent 状态 |
| POST | `/meetings/:id/start` | 开始会议 |
| POST | `/meetings/:id/end` | 结束会议 |
| POST | `/meetings/:id/generate-summary` | 触发会议总结生成 |
| POST | `/meetings/:id/pause` | 暂停会议 |
| POST | `/meetings/:id/resume` | 恢复会议 |
| PUT | `/meetings/:id/speaking-mode` | 更新发言模式 |
| PUT | `/meetings/:id/title` | 更新会议标题 |
| POST | `/meetings/:id/join` | 加入会议 |
| POST | `/meetings/:id/leave` | 离开会议 |
| POST | `/meetings/:id/messages` | 发送消息 |
| POST | `/meetings/:id/messages/:messageId/pause` | 暂停指定消息的待回复流程 |
| POST | `/meetings/:id/messages/:messageId/revoke` | 撤回已暂停且未被回复的消息 |
| POST | `/meetings/:id/archive` | 归档会议 |
| DELETE | `/meetings/:id` | 删除会议 |
| POST | `/meetings/:id/invite` | 邀请参与者 |
| POST | `/meetings/:id/participants` | 添加参与者 |
| DELETE | `/meetings/:id/participants/:participantType/:participantId` | 移除参与者 |

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `MEETING_CHAT_UPGRADE_PLAN.md` | 会议聊天升级计划 |
| `MEETING_CAPABILITY_MASTER_PLAN.md` | 会议能力完善计划 |
| `MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md` | 参会人上下文同步计划 |
| `MEETING_RESPONSE_CONTEXT_AND_PROMPT_DEDUP_PLAN.md` | 响应上下文与提示词去重计划 |
| `MEETING_AGENT_SESSION_CONTEXT_SYNC_AND_DEDUP_PLAN.md` | Agent会话上下文同步与去重计划 |
| `MEETING_ORCHESTRATION_PENDING_INTENT_PLAN.md` | 会议编排待处理意图计划 |
| `MEETING_ORCHESTRATION_FORCED_TOOLCALL_PLAN.md` | 会议编排强制工具调用计划 |
| `MEETING_ORCHESTRATION_MCP_PLAN.md` | 会议编排MCP计划 |
| `MEETING_MODEL_MANAGEMENT_TRIGGER_PLAN.md` | 模型管理触发计划 |
| `HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md` | 人类专属助理会议计划 |
| `AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md` | 聊天工具查询路由与日志语义收敛计划 |
| `MEETING_ASSISTANT_AGENT_PLAN.md` | 会议助理与会议监控计划 |
| `MEETING_ASSISTANT_LOG_SESSION_FIX_PLAN.md` | Scheduler 编排统一化与日志/会话链路修复计划 |
| `SEED_MANUAL_TRIGGER_UNIFICATION_PLAN.md` | Seed 统一改为手动触发计划 |
| `MEETING_CONTEXT_OPTIMIZE_PLAN.md` | 会议上下文去噪与 Prompt Registry 能力建设计划 |
| `MEETING_ASSISTANT_SUMMARY_EVENT_PLAN.md` | 会议总结改为会议助手事件驱动生成计划 |
| `MEETINGS_PAGE_SPLIT_REFACTOR_PLAN.md` | Meetings 页面拆分重构计划 |
| `MEETING_REMOVE_EMPLOYEE_PROXY_PLAN.md` | 会议移除 Employee 代理发言机制计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_CHAT_UPGRADE_PLAN.md` | 会议聊天升级开发总结 |
| `MEETING_CAPABILITY_MASTER_PLAN.md` | 会议能力完善开发总结 |
| `MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md` | 参会人上下文同步开发总结 |
| `MEETING_RESPONSE_CONTEXT_AND_PROMPT_DEDUP_PLAN.md` | 响应上下文与提示词去重开发总结 |
| `HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md` | 人类专属助理会议开发总结 |
| `AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md` | 聊天工具查询路由与日志前端优化开发总结 |
| `MEETING_ASSISTANT_AGENT_PLAN.md` | 会议助理与会议监控开发总结 |
| `MEETING_ASSISTANT_LOG_SESSION_FIX_PLAN.md` | Scheduler 编排统一化与日志/会话链路修复开发总结 |
| `SEED_MANUAL_TRIGGER_UNIFICATION_PLAN.md` | Seed 统一改为手动触发开发总结 |
| `AGENT_UNIFIED_INNER_MESSAGE_RUNTIME_PLAN.md` | 内部消息统一 Agent Runtime 处理链路与会议总结工具化总结 |

### 技术文档 (docs/technical/)

| `agent-action-logs-api.md` | Agent 行为日志查询/内部写入 API |
| `MEETING_EXPLICIT_PHRASE_COMMANDS.md` | 会议显式短语命令语法与清单 |
| `MEETINGS_PAGE_SPLIT_REFACTOR_ARCHITECTURE.MD` | Meetings 前端页面拆分后的模块职责与目录结构（guide） |

### API文档 (docs/api/)

（暂无）

---

## 3. 相关代码文件

### 后端 (backend/src/)

#### Schema 定义

| 文件 | 功能 |
|------|------|
| `shared/schemas/meeting.schema.ts` | Meeting、MeetingParticipant、MeetingMessage 数据模型定义 |

#### 核心服务

| 文件 | 功能 |
|------|------|
| `modules/meetings/meeting.module.ts` | Meeting 模块依赖注入配置 |
| `modules/meetings/meeting.controller.ts` | REST API 控制器，处理所有会议相关请求 |
| `modules/meetings/meeting.service.ts` | 核心业务逻辑（会议生命周期、消息处理、Agent响应等） |
| `modules/meetings/meeting-inner-message.constants.ts` | 会议 inner message 事件常量（agentId/eventType） |

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Meetings.tsx` | 会议页面路由兼容层（re-export） |
| `pages/meetings/index.tsx` | 会议页面编排层（状态组装与布局） |
| `pages/meetings/hooks/useMeetingQueries.ts` | 会议查询与派生数据聚合 |
| `pages/meetings/hooks/useMeetingMutations.ts` | 会议写操作与组合行为 |
| `pages/meetings/hooks/useMeetingRealtime.ts` | WebSocket 实时事件订阅与分发 |
| `pages/meetings/components/ChatInput.tsx` | 输入区（@mention / [phrase] / 历史导航） |
| `pages/meetings/components/MeetingStatusActions.tsx` | 状态菜单（配置驱动） |
| `services/meetingService.ts` | Meeting API 调用服务，包含类型定义 |

### Agent MCP 工具 (backend/apps/agents/src/)

| 文件 | 功能 |
|------|------|
| `modules/tools/tool.service.ts` | MCP 工具定义与实现，包含 meeting.list、meeting.getDetail、meeting.sendMessage、meeting.updateStatus、meeting.saveSummary |

---

## 4. MCP 工具

### 4.1 会议管理工具

| 工具 ID | 名称 | 功能 | 所需权限 |
|---------|------|------|----------|
| `builtin.sys-mg.mcp.meeting.list-meetings` | Meeting MCP List | 查询当前会议列表 | meeting_read |
| `builtin.sys-mg.mcp.meeting.get-detail` | Meeting MCP Get Detail | 查询会议详情与消息 | meeting_read |
| `builtin.sys-mg.mcp.meeting.send-message` | Meeting MCP Send Message | 向会议发送消息 | meeting_write |
| `builtin.sys-mg.mcp.meeting.update-status` | Meeting MCP Update Status | 修改会议状态 (start/end/pause/resume) | meeting_write |
| `builtin.sys-mg.mcp.meeting.save-summary` | Meeting MCP Save Summary | 写入会议总结 | meeting_write |

> 说明：会议 MCP 工具按当前系统单租户模式运行，不依赖 organization/tenant/workspace 上下文。

#### 4.1.1 meeting.list 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 筛选状态 (pending/active/paused/ended) |
| limit | number | 否 | 返回数量限制 |

#### 4.1.2 meeting.sendMessage 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |
| content | string | 是 | 消息内容 |
| type | string | 否 | 消息类型 (默认: opinion) |

#### 4.1.3 meeting.updateStatus 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |
| action | string | 是 | 操作 (start/end/pause/resume) |

#### 4.1.4 meeting.getDetail 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |

#### 4.1.5 meeting.saveSummary 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| meetingId | string | 是 | 会议 ID |
| summary | string | 是 | 总结正文 |
| actionItems | string[] | 否 | 行动项列表 |
| decisions | string[] | 否 | 决策列表 |
| overwrite | boolean | 否 | 已有总结时是否覆盖（默认 false） |

### 4.2 会议监控 (Meeting Monitor)

系统通过复用现有的 Scheduler 定时计划机制触发编排任务来管理会议空闲状态。

#### 实现方式

- Meeting Monitor 改为手动 seed：通过运维 seed 脚本 `seed:manual --only=system-schedules` 按需创建/修正内置定时计划 `system-meeting-monitor`
- 手动 seed 时会幂等创建系统内置 plan（`metadata.systemKey=system-meeting-monitor`），并与该 schedule 绑定，保证计划编排页可见
- 定时计划类型为 `interval`，默认每 5 分钟执行一次
- 执行时统一走 `OrchestrationService.executeStandaloneTask`，由 meeting-assistant 通过 MCP 工具完成巡检与处置

#### 功能特性

| 特性 | 说明 |
|------|------|
| 定时检查 | 每隔 5 分钟检查所有进行中的会议 |
| 超时提醒 | 会议 1 小时未有消息时，发送提醒消息 |
| 自动结束 | 会议 2 小时未有消息，自动结束会议 |

> 监控消息由 `system` 发送者写入会议消息流，不依赖会议参与者在场状态。

#### 配置项

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| MEETING_ASSISTANT_INTERVAL_MS | 300000 | 检查间隔 (5分钟) |
| MEETING_INACTIVE_WARNING_MS | 3600000 | 提醒超时 (1小时) |
| MEETING_INACTIVE_END_MS | 7200000 | 结束超时 (2小时) |
| MAX_TOOL_ROUNDS | 30 | Agent 单任务工具调用轮次上限（会议监控批量处理依赖此项） |
| BACKEND_API_URL | http://localhost:3001/api | backend API 地址 |
