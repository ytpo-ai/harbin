# SchedulerService 重构技术设计

> **状态**: 开发中  
> **创建时间**: 2026-03-26  
> **关联计划文档**: `docs/plan/SCHEDULER_SERVICE_REFACTOR_PLAN.md`

## 一、现状架构

### 1.1 当前模块结构

```
backend/src/modules/orchestration/scheduler/
  ├── dto/
  │   └── index.ts                  # CreateScheduleDto, UpdateScheduleDto, ScheduleHistoryQueryDto
  ├── scheduler.module.ts           # OrchestrationSchedulerModule
  ├── scheduler.controller.ts       # @Controller('orchestration/schedules')
  └── scheduler.service.ts          # 1043 行，核心服务
```

**模块注册**：`AppModule` 直接 import `OrchestrationSchedulerModule`（与 `OrchestrationModule` 平级）。

**当前依赖关系**：

```
OrchestrationSchedulerModule
  imports:
    - ScheduleModule.forRoot()      # @nestjs/schedule
    - AuthModule
    - AgentClientModule
    - OrchestrationModule           # ← 核心耦合点
    - MongooseModule.forFeature([
        OrchestrationSchedule,
        OrchestrationTask,          # ← 需移除
        OrchestrationRun,           # ← 需移除
        Agent,
      ])
```

### 1.2 当前执行链路（4 条分支）

`executeSingleAttempt()` 入口（scheduler.service.ts:597-688）：

```
if (schedule.planId) {
  // 分支 1：编排计划执行
  orchestrationService.executePlanRun(planId, 'schedule', { scheduleId, continueOnFailure })
} else {
  // 创建 OrchestrationTask 文档，然后进入 executeScheduleTaskByInput()
  executeScheduleTaskByInput(taskId, schedule, effectiveInput)
    → if memoCommand                    // 分支 2：Memo 聚合命令
        agentClientService.enqueueMemoAggregationCommand(...)
    → else if toolId                    // 分支 3：工具直接执行
        agentClientService.executeTool(toolId, agentId, params, taskId)
    → else                              // 分支 4：独立任务
        orchestrationService.executeStandaloneTask(taskId)
}
```

### 1.3 当前 Schema 定义

**文件**: `backend/src/shared/schemas/orchestration-schedule.schema.ts`  
**集合名**: `orchestration_schedules`

```typescript
{
  name: string;                     // 必填
  description?: string;
  planId?: string;                  // ← 重构后废弃
  schedule: {
    type: 'cron' | 'interval';
    expression?: string;            // cron 表达式
    intervalMs?: number;            // 毫秒，最小 60000
    timezone?: string;              // 默认 Asia/Shanghai
  };
  target: {
    executorType: 'agent';          // 固定 agent
    executorId: string;             // Agent ID
    executorName?: string;
  };
  input: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };
  enabled: boolean;
  status: 'idle' | 'running' | 'paused' | 'error';
  nextRunAt?: Date;
  lastRun?: { startedAt, completedAt, success, result, error, taskId, sessionId, attempts };
  deadLetters: [{ failedAt, taskId, triggerType, reason, attempts }];
  stats: { totalRuns, successRuns, failedRuns, skippedRuns };
  createdBy?: string;
}
```

### 1.4 已有 inner-message 基础设施

**agents app 侧**：

| 组件 | 文件 | 职责 |
|------|------|------|
| `InnerMessageService` | `apps/agents/src/modules/inner-message/inner-message.service.ts` | 消息 CRUD、Redis 队列推送、订阅匹配 |
| `InnerMessageDispatcherService` | `inner-message-dispatcher.service.ts` | Redis 消费者：出队 → 投递到 Agent inbox |
| `InnerMessageAgentRuntimeBridgeService` | `inner-message-agent-runtime-bridge.service.ts` | 收到消息 → 构建 prompt → `agentService.executeTaskDetailed()` |
| `InnerMessageController` | `inner-message.controller.ts` | REST API：`POST /inner-messages/direct`、`POST /inner-messages/publish` 等 |

**legacy app 侧**：

| 组件 | 方法 | 用途 |
|------|------|------|
| `AgentClientService` | `publishInnerMessage()` | HTTP POST → `/api/inner-messages/publish`（广播模式） |
| `AgentClientService` | `publishTaskLifecycleEvent()` | 编排任务生命周期事件发布 |

**消息生命周期**：`sent → delivered → processing → processed/failed`

**RuntimeBridge 执行入口**（inner-message-agent-runtime-bridge.service.ts:39）：

```typescript
await this.agentService.executeTaskDetailed(
  receiverAgentId,
  {
    id: `inner-message:${messageId}`,
    title: `处理内部消息 ${message?.eventType || 'inner.direct'}`,
    description: prompt,
    type: 'internal_message',
    // ...
  },
  {
    sessionContext: {
      runtimeTaskType: 'internal_message',
      runtimeChannelHint: 'native',
      innerMessage: { messageId, eventType, mode, senderAgentId, receiverAgentId, payload },
    },
  },
);
```

---

## 二、目标架构

### 2.1 目标模块结构

```
backend/src/modules/scheduler/
  ├── dto/
  │   └── index.ts                  # CreateScheduleDto, UpdateScheduleDto, ScheduleHistoryQueryDto
  ├── scheduler.module.ts           # SchedulerModule（独立一级模块）
  ├── scheduler.controller.ts       # @Controller('schedules')
  └── scheduler.service.ts          # 精简后约 400-500 行
```

**目标依赖关系**：

```
SchedulerModule
  imports:
    - ScheduleModule.forRoot()
    - AuthModule
    - AgentClientModule              # ← 唯一外部服务依赖
    - MongooseModule.forFeature([
        Schedule,                    # ← 仅自身 schema
      ])
```

### 2.2 目标执行链路（单一路径）

```
Cron/Interval 触发  或  手动 POST /schedules/:id/trigger
  → SchedulerService.dispatchSchedule(schedule, triggerType, inputOverride?)
    → 获取 run lock（防并发）
    → mergeInput(schedule.input, inputOverride)
    → dispatchToAgent(schedule, effectiveInput, triggerType)
        → agentClientService.sendDirectInnerMessage({
            senderAgentId: 'scheduler-system',
            receiverAgentId: schedule.target.executorId,
            eventType: schedule.message?.eventType || 'schedule.trigger',
            title: ...,
            content: ...,
            payload: { scheduleId, scheduleName, triggerType, prompt, ...payload },
            source: 'scheduler',
            dedupKey: `schedule:${scheduleId}:${timestamp}`,
          })
    → 更新 lastRun / stats / nextRunAt
    → 释放 lock

  ─── 异步 ───

  InnerMessage Redis Queue
    → InnerMessageDispatcherService 出队
      → InnerMessageAgentRuntimeBridgeService.processMessage()
        → AgentService.executeTaskDetailed()
          → Agent 自主执行（调工具、跑计划、处理 memo 等）
```

---

## 三、Schema 变更详细设计

### 3.1 文件迁移

```
# 旧
backend/src/shared/schemas/orchestration-schedule.schema.ts
  类名: OrchestrationSchedule
  集合名: orchestration_schedules

# 新
backend/src/shared/schemas/schedule.schema.ts
  类名: Schedule
  集合名: orchestration_schedules    ← 保持不变，@Schema({ collection: 'orchestration_schedules' })
```

### 3.2 字段变更

```typescript
@Schema({ collection: 'orchestration_schedules', timestamps: true })
export class Schedule {
  // ─── 保留字段 ───
  name: string;
  description?: string;
  schedule: {
    type: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;              // 默认 Asia/Shanghai
  };
  target: {
    executorType: 'agent';          // 固定
    executorId: string;             // 接收消息的 Agent ID
    executorName?: string;
  };
  input: {
    prompt?: string;                // 发给 Agent 的文本指令
    payload?: Record<string, unknown>;  // 发给 Agent 的结构化数据
  };
  enabled: boolean;
  status: 'idle' | 'running' | 'paused' | 'error';
  nextRunAt?: Date;
  lastRun?: { ... };                // 结构不变
  deadLetters: [...];               // 结构不变
  stats: { ... };                   // 结构不变
  createdBy?: string;

  // ─── 新增字段 ───
  message: {
    eventType: string;              // inner-message eventType，默认 'schedule.trigger'
    title?: string;                 // 消息标题，默认取 schedule.name
  };

  // ─── 废弃字段（保留但不再使用） ───
  /** @deprecated 重构后不再使用，后续版本移除 */
  planId?: string;
}
```

### 3.3 索引变更

```typescript
// 保留
{ enabled: 1, updatedAt: -1 }
{ nextRunAt: 1 }
{ 'target.executorId': 1, enabled: 1 }

// 移除（planId 不再是查询维度）
// { planId: 1, updatedAt: -1 }   ← 移除
```

---

## 四、AgentClientService 新增方法

### 4.1 sendDirectInnerMessage

**文件**: `backend/src/modules/agents-client/agent-client.service.ts`

```typescript
interface SendDirectInnerMessageInput {
  senderAgentId: string;
  receiverAgentId: string;
  eventType: string;
  title: string;
  content: string;
  payload?: Record<string, any>;
  source?: string;
  dedupKey?: string;
  maxAttempts?: number;
}

interface SendDirectInnerMessageResult {
  messageId: string;
  accepted: boolean;
}

async sendDirectInnerMessage(
  input: SendDirectInnerMessageInput,
): Promise<SendDirectInnerMessageResult> {
  const response = await axios.post(
    `${this.baseUrl}/api/inner-messages/direct`,
    input,
    {
      headers: this.buildSignedHeaders({ 'content-type': 'application/json' }),
      timeout: this.timeout,
    },
  );
  return response.data;
}
```

**说明**：

- 与现有 `publishInnerMessage()` 的区别：`publish` 是广播模式（匹配订阅者），`sendDirect` 是点对点模式（直接发给指定 Agent）
- agents app 的 `POST /inner-messages/direct` 端点已存在，无需新建

---

## 五、SchedulerService 核心方法重写

### 5.1 dispatchToAgent（新方法）

```typescript
private async dispatchToAgent(
  schedule: ScheduleDocument,
  effectiveInput: { prompt?: string; payload?: Record<string, unknown> },
  triggerType: TriggerType,
): Promise<{ messageId: string; accepted: boolean }> {
  const scheduleId = this.getEntityId(schedule);
  const eventType = schedule.message?.eventType || 'schedule.trigger';
  const title = schedule.message?.title || `定时任务: ${schedule.name}`;

  return this.agentClientService.sendDirectInnerMessage({
    senderAgentId: 'scheduler-system',
    receiverAgentId: schedule.target.executorId,
    eventType,
    title,
    content: this.buildMessageContent(schedule, effectiveInput, triggerType),
    payload: {
      scheduleId,
      scheduleName: schedule.name,
      triggerType,
      prompt: effectiveInput.prompt,
      ...(effectiveInput.payload || {}),
    },
    source: 'scheduler',
    dedupKey: `schedule:${scheduleId}:${Date.now()}`,
    maxAttempts: 3,
  });
}
```

### 5.2 buildMessageContent（新方法）

```typescript
private buildMessageContent(
  schedule: Schedule,
  effectiveInput: { prompt?: string; payload?: Record<string, unknown> },
  triggerType: TriggerType,
): string {
  const parts: string[] = [
    `你收到一条来自定时调度器的任务消息。`,
    `调度名称: ${schedule.name}`,
    `触发方式: ${triggerType === 'auto' ? '自动触发（定时）' : '手动触发'}`,
  ];

  if (schedule.description) {
    parts.push(`任务描述: ${schedule.description}`);
  }

  if (effectiveInput.prompt) {
    parts.push('', '任务指令:', effectiveInput.prompt);
  }

  const payload = effectiveInput.payload;
  if (payload && Object.keys(payload).length > 0) {
    parts.push('', '结构化参数:', JSON.stringify(payload, null, 2));
  }

  parts.push(
    '',
    '要求:',
    '1) 根据上述信息，使用你的已授权工具自主完成任务。',
    '2) 如果信息不足，做最小可行响应并说明缺失信息。',
    '3) 完成后请简要总结执行结果。',
  );

  return parts.join('\n');
}
```

### 5.3 dispatchSchedule 重写

```typescript
private async dispatchSchedule(
  schedule: ScheduleDocument,
  triggerType: TriggerType,
  options?: { inputOverride?: { prompt?: string; payload?: Record<string, unknown> } },
): Promise<void> {
  const scheduleId = this.getEntityId(schedule);

  // 1. 并发锁
  if (this.runLocks.has(scheduleId)) {
    this.logger.warn(`Schedule ${scheduleId} skipped: already running`);
    await this.scheduleModel.updateOne(
      { _id: scheduleId },
      { $inc: { 'stats.skippedRuns': 1 } },
    ).exec();
    return;
  }
  this.runLocks.add(scheduleId);

  const startedAt = new Date();
  try {
    // 2. 合并 input
    const effectiveInput = this.mergeInput(schedule.input, options?.inputOverride);

    // 3. 更新状态为 running
    await this.scheduleModel.updateOne(
      { _id: scheduleId },
      { $set: { status: 'running', 'lastRun.startedAt': startedAt } },
    ).exec();

    // 4. 发送 inner-message（唯一执行路径）
    const result = await this.dispatchToAgent(schedule, effectiveInput, triggerType);

    // 5. 更新 lastRun（消息已发送，但 Agent 尚未执行完毕）
    await this.scheduleModel.updateOne(
      { _id: scheduleId },
      {
        $set: {
          status: 'idle',
          'lastRun.completedAt': new Date(),
          'lastRun.success': result.accepted,
          'lastRun.result': `inner-message dispatched: ${result.messageId}`,
          'lastRun.attempts': 1,
          nextRunAt: this.computeNextRunAt(schedule),
        },
        $inc: {
          'stats.totalRuns': 1,
          ...(result.accepted ? { 'stats.successRuns': 1 } : { 'stats.failedRuns': 1 }),
        },
      },
    ).exec();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Dispatch failed';
    this.logger.error(`Schedule ${scheduleId} dispatch failed: ${reason}`);

    await this.scheduleModel.updateOne(
      { _id: scheduleId },
      {
        $set: {
          status: 'error',
          'lastRun.completedAt': new Date(),
          'lastRun.success': false,
          'lastRun.error': reason,
        },
        $inc: { 'stats.totalRuns': 1, 'stats.failedRuns': 1 },
        $push: {
          deadLetters: {
            $each: [{ failedAt: new Date(), triggerType, reason, attempts: 1 }],
            $slice: -50,
          },
        },
      },
    ).exec();

    await this.notifyScheduleFailure(scheduleId, schedule.name, reason);
  } finally {
    this.runLocks.delete(scheduleId);
  }
}
```

### 5.4 移除的方法

| 方法 | 行数 | 移除原因 |
|------|------|---------|
| `executeSingleAttempt()` | 597-688 | 4 分支逻辑全部被 `dispatchToAgent()` 替代 |
| `executeWithRetry()` | 555-595 | 重试语义变更：发送 inner-message 是幂等操作，失败由 inner-message 机制处理 |
| `executeScheduleTaskByInput()` | 854-1006 | memoCommand / toolId / standaloneTask 三子分支全部移除 |
| `buildTaskDescription()` | 841-852 | 不再创建 OrchestrationTask，改用 `buildMessageContent()` |

### 5.5 保留的方法（语义不变）

| 方法 | 说明 |
|------|------|
| `onModuleInit()` | 加载 enabled schedules、注册 cron/interval、检查缺失系统 schedule |
| `onModuleDestroy()` | 清理所有 cron/interval |
| `createSchedule()` | CRUD —— 去掉 planId 相关校验，增加 message 字段处理 |
| `updateSchedule()` | CRUD |
| `enableSchedule()` / `disableSchedule()` | 启停 |
| `deleteSchedule()` | 删除 |
| `triggerSchedule()` | 手动触发 → 调用 `dispatchSchedule(schedule, 'manual')` |
| `triggerSystemEngineeringStatistics()` | 保留，改为组装 inputOverride 后走 `dispatchSchedule` |
| `triggerSystemDocsHeat()` | 保留，改为组装 inputOverride 后走 `dispatchSchedule` |
| `registerSchedule()` | 注册 cron/interval timer |
| `recordDeadLetter()` | 死信记录 |
| `notifyScheduleFailure()` | webhook 告警 |

---

## 六、Agent 侧适配

### 6.1 RuntimeBridge 增强

**文件**: `backend/apps/agents/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts`

在 `buildPrompt()` 中增加对 `schedule.trigger` 类 eventType 的识别：

```typescript
private buildPrompt(message: InnerMessage, payload: Record<string, unknown>): string {
  const eventType = String(message?.eventType || '').trim() || 'inner.direct';

  // 定时调度消息：直接使用 content 作为 prompt（SchedulerService 已构建好完整指令）
  if (eventType.startsWith('schedule.')) {
    return String(message?.content || '').trim() || this.buildDefaultSchedulePrompt(message, payload);
  }

  // ... 现有逻辑不变
}

private buildDefaultSchedulePrompt(message: InnerMessage, payload: Record<string, unknown>): string {
  const scheduleName = String(payload.scheduleName || '').trim();
  const prompt = String(payload.prompt || '').trim();
  return [
    `你收到一条定时任务消息${scheduleName ? `（${scheduleName}）` : ''}。`,
    prompt || '请根据你的身份和能力自主完成此任务。',
    '',
    Object.keys(payload).length > 0 ? `参数: ${JSON.stringify(payload, null, 2)}` : '',
  ].filter(Boolean).join('\n');
}
```

### 6.2 sessionContext 标识

RuntimeBridge 为 schedule 消息注入特殊 sessionContext，便于 Agent 区分消息来源：

```typescript
// processMessage() 中
const sessionContext = {
  runtimeTaskType: eventType.startsWith('schedule.') ? 'scheduled_task' : 'internal_message',
  runtimeChannelHint: 'native',
  innerMessage: { messageId, eventType, mode, senderAgentId, receiverAgentId, payload },
  ...(eventType.startsWith('schedule.') ? {
    scheduleContext: {
      scheduleId: payload.scheduleId,
      scheduleName: payload.scheduleName,
      triggerType: payload.triggerType,
    },
  } : {}),
};
```

---

## 七、Seed 数据适配

### 7.1 现有 6 个系统 Schedule 的变更

**文件**: `backend/scripts/seed/system-schedule.ts`

| 系统 Schedule | 现 planId | 现 input.payload | 重构后 target.executorId | 重构后 message.eventType | 重构后 input |
|---|---|---|---|---|---|
| `system-meeting-monitor` | `有` | `{}` | 会议监控 Agent ID | `schedule.meeting-monitor` | `prompt: '检查当前是否有空闲会议需要处理...'` |
| `system-engineering-statistics` | `有` | `{ toolId, toolParameters }` | 研发智能 Agent ID | `schedule.engineering-statistics` | `payload: { scope, tokenMode, projectIds }` |
| `system-docs-heat` | `有` | `{ toolId, toolParameters }` | 研发智能 Agent ID | `schedule.docs-heat` | `payload: { topN }` |
| `system-cto-daily-requirement-triage` | `有` | `{}` | CTO Agent ID | `schedule.cto-daily-triage` | `prompt: '执行每日需求分诊...'` |
| `system-memo-event-flush` | `有` | `{ memoCommand: 'flush_events' }` | Memo Agent ID | `schedule.memo-flush` | `payload: { memoCommand: 'flush_events' }` |
| `system-memo-full-aggregation` | `有` | `{ memoCommand: 'full_aggregation' }` | Memo Agent ID | `schedule.memo-aggregation` | `payload: { memoCommand: 'full_aggregation' }` |

### 7.2 Seed 脚本兼容性

- seed 脚本使用 `upsert`（by `name`），重新运行即可更新已有记录
- `planId` 字段在新 seed 中不再设置，旧数据中的 `planId` 自然保留但不再被读取
- 新增 `message` 字段写入

---

## 八、执行状态回写方案

### 8.1 问题描述

重构前 Scheduler 同步等待执行完成再更新 lastRun。重构后 Scheduler 仅发送消息，Agent 异步执行，需要一种机制感知执行结果。

### 8.2 方案选型

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 轮询 message 状态** | Scheduler 定期查询 inner-message 的 status | 实现简单、无侵入 | 延迟高、查询开销 |
| **B. Redis 订阅回调** | Agent 执行完毕后 RuntimeBridge 发布 Redis 事件，Scheduler 订阅 | 实时性好 | 需要跨 app Redis 订阅通道 |
| **C. Webhook 回调** | Agent 执行完毕后 HTTP 回调 Scheduler 端点 | 解耦彻底 | 需要新增回调端点、网络可靠性 |
| **D. 仅记录消息发送状态** | lastRun 仅记录"消息已发送"，执行状态通过 inner-message history 查看 | 最简单、职责清晰 | Scheduler 层看不到执行详情 |

**落地方案 A（已实现）**，理由：

- 无需新增跨服务回调通道，改造成本最低
- 利用现有 message-center 查询接口，可按 `scheduleId + messageId` 做短周期轮询
- 可以将 `lastRun.success` 回写为消息终态（`processed/failed`），提升调度可观测性
- 失败时可直接复用 dead-letter 与 webhook 告警链路

### 8.3 History 查询适配

当前 `getScheduleHistory()` 查询 `OrchestrationRun` by `scheduleId`。重构后：

- 短期：改为查询 `inner_messages` 集合，筛选 `payload.scheduleId` + `source='scheduler'`
- 需要 `AgentClientService` 新增一个查询方法，或前端直接调 agents app API

### 8.4 重试策略定稿

- Scheduler 不再实现执行层重试循环。
- 发送阶段仅调用一次 `sendDirectInnerMessage`，并通过 `maxAttempts` 交给 inner-message dispatcher 处理重试。
- 监控阶段若消息终态为 `failed` 或超过轮询上限，Scheduler 记录 dead-letter 并触发告警。

---

## 九、DTO 变更

### 9.1 CreateScheduleDto

```typescript
export class CreateScheduleDto {
  name: string;
  description?: string;
  // planId 移除（不再接受）

  schedule: {
    type: 'cron' | 'interval';
    expression?: string;
    intervalMs?: number;
    timezone?: string;
  };

  target: {
    executorId: string;             // 必填：接收消息的 Agent ID
    executorName?: string;
  };

  input?: {
    prompt?: string;
    payload?: Record<string, unknown>;
  };

  // 新增
  message?: {
    eventType?: string;             // 默认 'schedule.trigger'
    title?: string;
  };
}
```

### 9.2 UpdateScheduleDto

与 CreateScheduleDto 字段对齐，所有字段可选。

---

## 十、API 路由变更

| 现有路由 | 新路由 | 说明 |
|---------|--------|------|
| `POST /orchestration/schedules` | `POST /schedules` | 创建 |
| `GET /orchestration/schedules` | `GET /schedules` | 列表 |
| `GET /orchestration/schedules/:id` | `GET /schedules/:id` | 详情 |
| `PUT /orchestration/schedules/:id` | `PUT /schedules/:id` | 更新 |
| `DELETE /orchestration/schedules/:id` | `DELETE /schedules/:id` | 删除 |
| `POST /orchestration/schedules/:id/enable` | `POST /schedules/:id/enable` | 启用 |
| `POST /orchestration/schedules/:id/disable` | `POST /schedules/:id/disable` | 禁用 |
| `POST /orchestration/schedules/:id/trigger` | `POST /schedules/:id/trigger` | 手动触发 |
| `GET /orchestration/schedules/:id/history` | `GET /schedules/:id/history` | 执行历史 |
| `POST /orchestration/schedules/system/engineering-statistics/trigger` | `POST /schedules/system/engineering-statistics/trigger` | EI 手动触发 |
| `GET /orchestration/schedules/system/engineering-statistics` | `GET /schedules/system/engineering-statistics` | EI schedule 详情 |
| `POST /orchestration/schedules/system/docs-heat/trigger` | `POST /schedules/system/docs-heat/trigger` | 文档热度手动触发 |
| `GET /orchestration/schedules/system/docs-heat` | `GET /schedules/system/docs-heat` | 文档热度 schedule 详情 |
| `GET /orchestration/schedules/by-plan/:planId` | **废弃** | planId 不再是查询维度 |

**Gateway 过渡**：过渡期内 gateway 可配置 `/orchestration/schedules/*` → `/schedules/*` 的路由重写规则，待前端全部迁移后移除。

---

## 十一、注意事项

### 11.1 MCP 工具适配

现有 MCP 工具 `orchestration_create_schedule` / `orchestration_update_schedule` 需同步更新：
- 参数中移除 `planId`
- 新增 `message.eventType` 参数
- 工具名称考虑是否重命名（如 `schedule_create` / `schedule_update`）

### 11.2 前端 Gateway 路由

确认 gateway 层的路由代理规则：
- 现有：`/api/orchestration/schedules/*` → legacy app
- 新增：`/api/schedules/*` → legacy app
- 过渡期两者共存

### 11.3 plan 删除保护

现有逻辑：删除 Plan 时检查是否有 Schedule 绑定（`findSchedulesByPlanId`）。重构后 Schedule 不再绑定 planId，此保护逻辑需移除或改为检查 Agent 关联。

### 11.4 lastRun 语义变更

重构后 `lastRun.success` 表示"消息处理终态是否成功（processed）"，不再表示 Orchestration run 成功。前端展示需标注为"最近一次消息投递/处理状态"。

### 11.5 Memo 聚合的特殊性

现有 memo 聚合（`flush_events` / `full_aggregation`）不走 Agent 执行，而是直接入 Redis queue。重构后改为发消息给 Memo Agent，Agent 需具备调用 memo 聚合工具的能力。需确认：
- Memo Agent 是否已注册并配置了 memo 聚合相关工具
- 如果 Memo Agent 尚未就绪，Phase 4 中需同步创建/配置

### 11.6 Engineering Statistics / Docs Heat 的特殊性

现有手动触发支持参数覆盖（如 `scope`、`topN`）。重构后这些参数通过 `inputOverride.payload` 传入消息 payload，Agent 从 payload 中解析。需确认 Agent 的 prompt 能正确引导 Agent 使用这些参数调用对应工具。

### 11.7 执行超时感知

重构前 Scheduler 通过 `executeWithRetry()` 同步等待，可感知超时。重构后消息发送是快速操作（毫秒级），Agent 执行超时由 Agent Runtime 自身的超时机制处理（`AGENT_TASK_TIMEOUT_MS` 环境变量）。Scheduler 不再需要感知执行超时。
