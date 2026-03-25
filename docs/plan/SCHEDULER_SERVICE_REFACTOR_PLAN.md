# SchedulerService 重构计划

> **状态**: 开发中  
> **创建时间**: 2026-03-26  
> **关联技术文档**: `docs/technical/SCHEDULER_SERVICE_REFACTOR_TECHNICAL_DESIGN.md`

## 一、重构目标

1. **Scheduler 从编排模块迁出** → 成为 legacy app 下的独立一级模块 `backend/src/modules/scheduler/`
2. **统一触发方式** → Scheduler 只做一件事：按时向指定 Agent 发送 inner-message，Agent 自己决定如何执行
3. **解除对 OrchestrationService 的直接依赖**

## 二、任务项

### Phase 1：模块目录迁移 + 重命名（预估 0.5 天）

- [x] 将 `backend/src/modules/orchestration/scheduler/` 整体迁移到 `backend/src/modules/scheduler/`
- [x] 模块类名 `OrchestrationSchedulerModule` → `SchedulerModule`
- [x] Controller 路由 `orchestration/schedules` → `schedules`
- [x] `AppModule` 中替换 import
- [x] Schema 文件迁移：`shared/schemas/orchestration-schedule.schema.ts` → `shared/schemas/schedule.schema.ts`
- [x] Schema 类名 `OrchestrationSchedule` → `Schedule`（集合名保持 `orchestration_schedules` 不变，避免数据迁移）
- [x] 全局搜索替换 `OrchestrationSchedule` / `OrchestrationSchedulerModule` 引用

### Phase 2：AgentClientService 新增 direct 消息方法（预估 0.5 天）

- [x] `AgentClientService` 新增 `sendDirectInnerMessage()` 方法（HTTP POST → agents app `/api/inner-messages/direct`）
- [x] Agent 侧 `InnerMessageAgentRuntimeBridgeService.buildPrompt()` 增加对 `schedule.trigger` eventType 的识别和专用 prompt 构建
- [ ] 验证 inner-message direct 模式端到端联通（Scheduler → Redis Queue → Dispatcher → RuntimeBridge → Agent executeTask）

### Phase 3：重写核心执行逻辑（预估 1 天）

- [x] 删除 `executeSingleAttempt()` 中的 4 条分支逻辑
- [x] 新建 `dispatchToAgent()` 方法：统一发送 inner-message 给 target Agent
- [x] 重写 `dispatchSchedule()`：仅负责锁 + 调用 `dispatchToAgent()` + 更新 lastRun/stats
- [x] 移除对 `OrchestrationService`（executePlanRun / executeStandaloneTask）的直接调用
- [x] 移除对 `agentClientService.executeTool()` 的直接调用
- [x] 移除对 `agentClientService.enqueueMemoAggregationCommand()` 的直接调用
- [x] 移除 `OrchestrationTask` 和 `OrchestrationRun` schema 依赖
- [x] 重试机制决策：评估保留 Scheduler 层重试（发送失败重发）还是完全依赖 inner-message 的 maxAttempts

### Phase 4：Schema 字段变更 + Seed 适配（预估 0.5 天）

- [x] Schema 新增 `message` 子结构：`{ eventType: string, title?: string }`
- [x] Schema `planId` 字段标记 deprecated（保留但不再使用，后续版本移除）
- [x] 更新 6 个系统 schedule 的 seed 数据：
  - `system-meeting-monitor` → 发给会议监控 Agent
  - `system-engineering-statistics` → 发给研发智能 Agent，payload 携带参数
  - `system-docs-heat` → 发给研发智能 Agent，payload 携带参数
  - `system-cto-daily-requirement-triage` → 发给 CTO Agent
  - `system-memo-event-flush` → 发给 memo Agent
  - `system-memo-full-aggregation` → 发给 memo Agent
- [x] 手动触发方法 `triggerSystemEngineeringStatistics()` / `triggerSystemDocsHeat()` 改为组装 inputOverride 后走统一 `dispatchToAgent` 路径

### Phase 5：前端适配（预估 0.5 天）

- [x] `frontend/src/services/schedulerService.ts`：API 路径从 `/orchestration/schedules` → `/schedules`
- [x] `frontend/src/pages/Scheduler.tsx`：
  - 去掉 planId 绑定相关 UI
  - 新增 Agent 选择器（选择消息接收 Agent）
  - 新增 message eventType 配置项
  - 保留 prompt / payload 编辑区域

### Phase 6：执行状态回写机制（预估 1 天）

- [x] 设计 Scheduler 异步感知 Agent 执行结果的方案（方案选型见技术文档）
- [x] 实现 lastRun 状态更新（基于 inner-message status 生命周期或回调）
- [x] 验证 dead-letter / 失败告警链路在新架构下正常工作

### Phase 7：清理旧依赖 + 文档更新（预估 0.5 天）

#### 7a. 标记 11 篇历史文档为 `[已弃用]`

| 文件 | 理由 |
|------|------|
| `docs/plan/ORCHESTRATION_SCHEDULER_PLAN_BINDING_OPTIMIZATION_PLAN.md` | 核心主张"CreateSchedule 必须绑 planId"与重构方向相反 |
| `docs/plan/MEMO_SCHEDULE_PLAN_UNIFICATION_AND_ASYNC_TRIGGER_PLAN.md` | memo 聚合走 Scheduler → Redis queue 路径已废弃 |
| `docs/plan/MEMO_AGGREGATION_SCHEDULER_MIGRATION_PLAN.md` | memo 定时器迁入 orchestration scheduler 的方案已废弃 |
| `docs/plan/CTO_DAILY_REQUIREMENT_TRIAGE_SCHEDULE_SEED_PLAN.md` | seed 数据结构变更（去 planId 加 message） |
| `docs/plan/MEETING_ASSISTANT_LOG_SESSION_FIX_PLAN.md` | scheduler → executeStandaloneTask 链路已废弃 |
| `docs/plan/MEETING_ASSISTANT_AGENT_PLAN.md` | scheduler interval → 直接执行已改走 inner-message |
| `docs/development/MEMO_SCHEDULE_PLAN_UNIFICATION_AND_ASYNC_TRIGGER_PLAN.md` | 对应 plan 的开发总结同步废弃 |
| `docs/development/MEETING_ASSISTANT_LOG_SESSION_FIX_PLAN.md` | 对应 plan 的开发总结同步废弃 |
| `docs/development/MEETING_ASSISTANT_AGENT_PLAN.md` | 对应 plan 的开发总结同步废弃 |
| `docs/development/SEED_MANUAL_TRIGGER_UNIFICATION_PLAN.md` | seed 管理方式随重构变更 |
| `docs/development/CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | 引用 create-schedule/update-schedule MCP 旧语义 |

#### 7b. 重写/更新 17 篇有效文档

| 文件 | 需更新内容 |
|------|-----------|
| `docs/feature/ORCHETRATION_SCHEDULER.md` | **主文档全面重写**：模块路径、Schema、API 路由、执行链路、系统 schedule |
| `docs/feature/ORCHETRATION_TASK.md` | 移除 `mode=schedule` 描述、更新计划删除保护逻辑 |
| `docs/feature/ENGINEERING_INTELLIGENCE.md` | 更新触发方式（→ Agent inner-message） |
| `docs/feature/MEETING_CHAT.md` | 更新会议监控触发方式 |
| `docs/feature/AGENT_TOOL.md` | 更新 MCP schedule 工具描述 |
| `docs/feature/AGENT_MEMO.md` | 更新 memo 聚合触发链路 |
| `docs/feature/INDEX.md` | 更新 scheduler 条目名称和路径 |
| `docs/api/agents-api.md` | 更新 Scheduler REST API 路由和 MCP 参数契约 |
| `docs/api/engineering-intelligence-api.md` | 更新系统 schedule 端点路由 |
| `docs/api/legacy-api.md` | 更新/废弃 by-plan 查询端点 |
| `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` | 移除 SchedulerService 作为 OrchestrationService 调用者的描述 |
| `docs/guide/ORCHESTRATION_PLAN.MD` | 移除 scheduler 相关文件列表 |
| `docs/guide/SCRIPTS_TOOLING_SEED_MAINTENANCE.MD` | 更新 seed 数据结构说明 |
| `docs/guide/SKILL_LOAD.md` | 更新 MCP 工具名称/参数 |
| `docs/guide/AA.MD` | 更新项目结构中 scheduler 位置 |
| `docs/guide/AGENT&ROLE.MD` | 更新 agent capability 中 schedule 描述 |
| `docs/issue/AGENTS_ORCHESTRATION_CODE_REVIEW.md` | 标注 scheduler 拆分建议已在本次重构落地 |

#### 7c. 其他

- [x] 当天 dailylog 记录重构内容和影响范围
- [x] 清理旧代码中 deprecated 引用

## 三、依赖变更

```
重构前 SchedulerModule 依赖:
  ├── OrchestrationModule (executePlanRun, executeStandaloneTask)
  ├── AgentClientModule  (executeTool, enqueueMemoAggregationCommand)
  ├── OrchestrationSchedule schema
  ├── OrchestrationTask schema
  └── OrchestrationRun schema

重构后 SchedulerModule 依赖:
  ├── AgentClientModule  (sendDirectInnerMessage)  ← 唯一外部服务依赖
  └── Schedule schema                               ← 仅自身 schema
```

## 四、风险与兜底

| 风险 | 应对 |
|------|------|
| Agent 执行失败 Scheduler 无法感知 | inner-message 有 status 生命周期，Scheduler 异步查询 message 状态更新 lastRun |
| 执行结果回写 | RuntimeBridge 调用 markMessageProcessed()，Scheduler 通过轮询或 Redis 订阅获取结果 |
| 现有 seed 数据兼容 | 集合名不变，新增 message 字段通过 seed 脚本补全，planId 保留标记 deprecated |
| 重试机制 | inner-message 自带 maxAttempts + dead-letter；Scheduler 层可保留发送失败重试 |
| 前端路由变更 | gateway 层可配双路由兼容过渡期 |

## 五、执行顺序与预估

| 阶段 | 预估 |
|------|------|
| Phase 1 - 模块迁移 | 0.5 天 |
| Phase 2 - direct 消息方法 | 0.5 天 |
| Phase 3 - 核心逻辑重写 | 1 天 |
| Phase 4 - Schema + Seed | 0.5 天 |
| Phase 5 - 前端适配 | 0.5 天 |
| Phase 6 - 状态回写 | 1 天 |
| Phase 7 - 文档清理 | 0.5 天 |
| **合计** | **4.5 天** |
