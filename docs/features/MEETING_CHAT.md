# Meeting Chat（会议聊天）

## 1. 功能设计

### 1.1 目标

- 支持员工和 Agent 同时参与会议，实现实时语音/文字协作
- 人类员工可由专属助理（Agent）代理发言，实现 AI 辅助会议参与
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
| `isExclusiveAssistant` | boolean | 是否为专属助理 |
| `assistantForEmployeeId` | string | 所属员工ID |

#### MeetingMessage

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 消息ID |
| `senderId` | string | 发送者ID |
| `senderType` | 'employee' \| 'agent' \| 'system' | 发送者类型 |
| `content` | string | 消息内容 |
| `type` | string | 消息类型（opinion/question/agreement/disagreement/suggestion/conclusion/introduction/action_item） |
| `timestamp` | Date | 时间戳 |
| `metadata` | Object | 扩展字段（@提及、回复、情感分析、AI代理标识等） |

### 1.3 核心逻辑

#### 1.3.1 会议生命周期

| 状态 | 可执行操作 |
|------|-----------|
| PENDING | 开始(Start)、删除(Delete)、邀请(Invite) |
| ACTIVE | 发言(SendMessage)、暂停(Pause)、结束(End)、加入(Join)、离开(Leave) |
| PAUSED | 恢复(Resume)、结束(End) |
| ENDED | 归档(Archive)、删除(Delete) |
| ARCHIVED | 删除(Delete) |

#### 1.3.2 专属助理机制

- 人类员工必须绑定专属助理（exclusiveAssistantAgentId 或 aiProxyAgentId）才能创建/加入会议
- 员工发言时，由专属助理代理发送消息（`isAIProxy: true`）
- 专属助理仅在员工明确 @ 时响应

#### 1.3.3 Agent 响应机制

- 人类发言后，在场 Agent 自动响应
- 通过 Redis 维护 Agent 状态（thinking/idle），避免重复响应
- 响应去重：15秒内相同触发消息不重复生成响应
- 支持 @ 提及特定 Agent
- 专属助理仅响应其主人的 @ 提及

#### 1.3.4 意图路由

- **模型查询意图**：检测到"最新模型"/"模型列表"时，路由至模型管理 Agent
- **操作日志意图**：检测到"操作日志"相关查询时，专属助理执行日志检索
- **Agent 列表意图**：检测到"有哪些 Agent/Agent 列表"时，优先走 `agents_mcp_list` 轻量查询通道（chat query），避免创建任务执行生命周期

#### 1.3.5 会议上下文

- Agent 入场时自动 catch-up：获取最近5条消息并生成入场发言
- 会议结束时生成 AI 总结（含摘要、行动项、决策）

### 1.4 API（backend/src/modules/meetings/）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/meetings` | 创建会议 |
| GET | `/meetings` | 获取所有会议 |
| GET | `/meetings/stats` | 获取会议统计 |
| GET | `/meetings/by-participant/:participantId` | 获取参与者参与的会议 |
| GET | `/meetings/:id` | 获取会议详情 |
| GET | `/meetings/:id/agent-states` | 获取 Agent 状态 |
| POST | `/meetings/:id/start` | 开始会议 |
| POST | `/meetings/:id/end` | 结束会议 |
| POST | `/meetings/:id/pause` | 暂停会议 |
| POST | `/meetings/:id/resume` | 恢复会议 |
| PUT | `/meetings/:id/speaking-mode` | 更新发言模式 |
| PUT | `/meetings/:id/title` | 更新会议标题 |
| POST | `/meetings/:id/join` | 加入会议 |
| POST | `/meetings/:id/leave` | 离开会议 |
| POST | `/meetings/:id/messages` | 发送消息 |
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

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_CHAT_UPGRADE_PLAN.md` | 会议聊天升级开发总结 |
| `MEETING_CAPABILITY_MASTER_PLAN.md` | 会议能力完善开发总结 |
| `MEETING_PARTICIPANTS_CONTEXT_SYNC_PLAN.md` | 参会人上下文同步开发总结 |
| `MEETING_RESPONSE_CONTEXT_AND_PROMPT_DEDUP_PLAN.md` | 响应上下文与提示词去重开发总结 |
| `HUMAN_EXCLUSIVE_ASSISTANT_MEETING_PLAN.md` | 人类专属助理会议开发总结 |
| `AGENT_CHAT_TOOL_QUERY_ROUTING_PLAN.md` | 聊天工具查询路由与日志前端优化开发总结 |

### 技术文档 (docs/technical/)

| `agent-action-logs-api.md` | Agent 行为日志查询/内部写入 API |

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

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Meetings.tsx` | 会议管理页面 |
| `services/meetingService.ts` | Meeting API 调用服务，包含类型定义 |

### Agent MCP 工具 (backend/apps/agents/src/)

| 文件 | 功能 |
|------|------|
| `modules/tools/tool.service.ts` | MCP 工具定义与实现，包含 meeting.list、meeting.sendMessage、meeting.updateStatus |

---

## 4. MCP 工具

### 4.1 会议管理工具

| 工具 ID | 名称 | 功能 | 所需权限 |
|---------|------|------|----------|
| `builtin.mcp.meeting.list` | Meeting MCP List | 查询当前会议列表 | meeting_read |
| `builtin.mcp.meeting.sendMessage` | Meeting MCP Send Message | 向会议发送消息 | meeting_write |
| `builtin.mcp.meeting.updateStatus` | Meeting MCP Update Status | 修改会议状态 (start/end/pause/resume) | meeting_write |

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
