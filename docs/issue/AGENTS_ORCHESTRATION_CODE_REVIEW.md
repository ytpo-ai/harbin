# Apps/Agents 与 Orchestration 模块代码 Review

本文档分三个章节，逐步沉淀 review 结论。

---

## 第一章：Apps/Agents 大文件拆分建议

### 1. 问题概述

`backend/apps/agents` 共 64 个 .ts 文件，合计 **19,941 行**。其中 **20 个文件超过 200 行**，前 3 个文件占全部代码的 48%：

| 排名 | 文件 | 行数 | 占比 |
|------|------|------|------|
| 1 | `modules/tools/tool.service.ts` | 4,286 | 21.5% |
| 2 | `modules/agents/agent.service.ts` | 3,567 | 17.9% |
| 3 | `modules/memos/memo.service.ts` | 1,712 | 8.6% |
| 4 | `modules/runtime/runtime-orchestrator.service.ts` | 938 | 4.7% |
| 5 | `modules/skills/skill.service.ts` | 933 | 4.7% |
| 6 | `modules/runtime/runtime-persistence.service.ts` | 890 | 4.5% |

---

### 2. tool.service.ts (4,286行) — 拆分建议

#### 2.1 现状分析

该文件是全项目最大的单文件，承担了 **7 种职责**：
- 工具注册表（CRUD + toolkit）
- 工具执行引擎（治理、重试、熔断）
- 工具实现分发器（38 分支的 switch-case）
- HTTP API 代理（orchestration/EI/meeting/agents 四个内部服务）
- 文件系统操作（repo-read/docs-write）
- 种子数据管理（builtin 工具初始化，870 行静态数据）
- 指标聚合（执行统计）

**构造函数注入 14 个依赖**（9 个 Mongoose Model + 5 个 Service），严重违反单一职责。

#### 2.2 拆分方案

| 优先级 | 提取目标 | 预计行数 | 复杂度 | 说明 |
|--------|---------|---------|--------|------|
| **P0** | `builtin-tool-definitions.ts`（静态数据文件） | ~750 | 低 | 将 `initializeBuiltinTools` 中 `builtinTools` 数组提取为独立常量文件。纯数据，零耦合 |
| **P0** | `InternalApiClient` | ~140 | 低 | 将 `callOrchestrationApi/callEiApi/callMeetingApi/callAgentsApi/buildSignedHeaders/summarizeApiErrorBody` 提取为共享 HTTP 客户端服务 |
| **P1** | `OrchestrationToolHandler` | ~550 | 中 | 14 个编排工具方法 + schedule 辅助方法。全部遵循 `assertContext → validate → callApi → wrap` 模式 |
| **P1** | `RequirementToolHandler` | ~280 | 中 | 10 个需求管理工具方法，模式与编排完全一致 |
| **P1** | `RepoToolHandler` | ~280 | 低 | 文件系统操作（repo-read/docs-write），与 API 代理完全不同领域 |
| **P1** | `ToolGovernanceService` | ~150 | 低 | 速率限制、熔断、超时、重试、幂等键。拥有独立内存状态 (`rateLimitHits`, `circuitBreakers`) |
| **P2** | `AgentMcpToolHandler` | ~265 | 中 | Agent 管理 MCP 工具（create-agent/list-agents） |
| **P2** | `ToolIdentityService` | ~120 | 低 | 纯无状态工具 ID 解析逻辑 (`parseToolIdentity` 等 8 个方法) |
| **P3** | `MeetingToolHandler` / `ModelToolHandler` / `SkillToolHandler` / `AuditToolHandler` | ~400 | 低 | 各领域剩余工具实现 |

**拆分后效果**: tool.service.ts 从 4,286 行缩减至 **~800-1,000 行**（保留工具 CRUD、执行编排、分发表）。

#### 2.3 关键代码味道

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| 工具 ID 三处同步 | 高 | `builtinTools` 数组、`executeToolImplementation` switch-case、`getImplementedToolIds` 返回数组必须同步维护 |
| `executeToolImplementation` 巨型 switch | 高 | 38 个分支，扩展必须改此文件 |
| HTTP 客户端错误处理不一致 | 中 | `callMeetingApi` 无错误处理；其他三个方法错误处理近乎重复 |
| `String(x \|\| '').trim()` 重复 100+ 次 | 低 | 需提取 `safeStr()` 工具函数 |
| 12 个环境变量散落各处 | 中 | 应集中到 NestJS ConfigService |
| 硬编码安全隐患 | 高 | `contextSecret` 有硬编码 fallback `'internal-context-secret'` |
| Axios timeout `120000` 重复 5 次 | 低 | 应统一配置 |

---

### 3. agent.service.ts (3,567行) — 拆分建议

#### 3.1 现状分析

该文件承担 **6 种职责**：
- Agent CRUD（创建/更新/删除/查询）
- 任务执行与 Runtime 生命周期（含非流式和流式两条路径）
- 多轮工具调用循环
- 编排意图识别（会议场景强制 tool call）
- Model Management Agent 确定性处理
- MCP Profile 管理

**74 个方法**（28 public + 46 private），构造函数注入 14 个依赖。

#### 3.2 拆分方案

| 优先级 | 提取目标 | 预计行数 | 复杂度 | 说明 |
|--------|---------|---------|--------|------|
| **P0** | `AgentExecutionService` | ~1,130 | 高 | 提取执行链路三大方法 (`executeTask*`) + 工具调用循环 + 消息构建 + 预算检查。**最大价值拆分** |
| **P1** | `AgentOrchestrationIntentService` | ~400 | 中 | 提取 `extractForcedOrchestrationAction` 等 8 个意图识别方法。纯无状态分类逻辑（历史项，文件已于 2026-03-19 删除） |
| **P1** | `AgentModelManagementService` | ~450 | 中 | 提取 `testAgentConnection` (221行) + Model Management 确定性处理 (133行) |
| **P2** | `AgentMcpProfileService` | ~455 | 中 | 提取 MCP Profile CRUD + 种子数据 + 权限集管理 |
| **P2** | `OpenCodeExecutionConfigService` | ~130 | 低 | 提取 OpenCode 执行门禁 + 配置解析 |
| **P3** | `MCP_PROFILE_SEEDS`（静态数据文件） | ~190 | 低 | 将 190 行种子数据提取为独立配置文件 |

**拆分后效果**: agent.service.ts 从 3,567 行缩减至 **~400-500 行**（仅保留 Agent CRUD + 委派调用）。

#### 3.3 关键代码味道

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| `executeTaskDetailed` 与 `executeTaskWithStreaming` 80% 重复 | 高 | 应提取 `prepareExecution()` + `finalizeExecution()` 共享流程，消除 ~200 行重复 |
| 模型配置构建重复 5 处 | 中 | `AIModel` 对象创建散布在 5 个方法中 |
| 最新用户消息提取重复 5 处 | 中 | 同一个 `reverse().find()` 模式重复 5 次 |
| `extractForcedOrchestrationAction` 224 行 | 高 | 10 级 if-else 链，难以测试和扩展 |
| 30+ 处硬编码中文字符串 | 中 | 缺乏 i18n 支持 |
| `isCtoAgent()` 硬编码 persona 名称 | 高 | 使用 `'sarah kim'` 字符串判断身份 |
| `4096`/`0.7` 默认模型参数重复 6 处 | 低 | 应定义为常量 |

---

### 4. memo.service.ts (1,712行) — 拆分建议

#### 4.1 现状分析

**70 个方法**，横跨 10+ 功能区域：核心 CRUD、TODO 管理、历史管理、行为事件队列、刷新队列、缓存层、核心文档种子、权限验证、版本管理等。典型的 God Class。

#### 4.2 拆分方案

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P1** | `MemoTaskTodoService` | ~250 | TODO 管理 (`upsertTaskTodo/updateTodoStatus/completeTaskTodo` + 渲染/归一化) |
| **P1** | `MemoTaskHistoryService` | ~230 | 历史管理 (`upsertTaskHistory/readHistoryItems/renderHistoryContent` + 去重) |
| **P2** | `MemoBehaviorAggregatorService` | ~150 | Redis 事件队列 (`recordBehavior/flushEventQueue/mergeTopicEvents`) |
| **P2** | `MemoCacheService` | ~93 | 缓存读写搜索 (`loadMemoKindCache/searchMemosFromCache/refreshMemoCacheByKind`) |
| **P3** | `MemoPermissionGuard` | ~107 | 权限与类型校验 |
| **P3** | 共享工具函数提取 | ~50 | `uniqueStrings/escapeRegex/compact` 与 skill.service.ts 重复 |

**拆分后效果**: memo.service.ts 从 1,712 行缩减至 **~600 行**。

---

### 5. runtime-orchestrator.service.ts (938行) — 拆分建议

#### 5.1 拆分方案

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P2** | `ToolEventRecorder` | ~163 | 4 个 `recordTool*` 方法 + `buildToolEventPayload` |
| **P2** | 统一 `transitionRunStatus()` | — | `pauseRunWithActor/resumeRunWithActor/cancelRunWithActor` 三方法合一模板 |
| **P3** | `ToolParamSanitizer` | ~41 | 脱敏逻辑独立工具类 |

#### 5.2 关键代码味道

| 问题 | 说明 |
|------|------|
| `startRun` 155 行 | 3 种会话类型分支 + 锁获取 + 事件发射，至少 4 个职责混合 |
| 内存 Promise Chain 锁 | `lockTails: Map<string, Promise<void>>` 无法跨实例/跨重启 |
| 魔数 `999999` | `completeRun/failRun` 中用作终态 sequence，应命名常量 |

---

### 6. runtime-persistence.service.ts (890行) — 拆分建议

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P2** | `RuntimeEventOutboxService` | ~197 | 9 个 outbox/死信方法，自成一体 |
| **P3** | `RuntimeMaintenanceService` | ~54 | purge + 审计方法 |

#### 关键代码味道

| 问题 | 说明 |
|------|------|
| `listSessions` 和 `countSessions` 过滤逻辑 100% 重复 | 应提取 `buildSessionFilter()` |
| 硬编码中文 system 提示 | `'你正在参加一个会议'` 等应外部化 |
| 42 个 public 方法 | 单一 Service 方法过多，接口过宽 |

---

### 7. skill.service.ts (933行) — 拆分建议

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P2** | `SkillCacheService` | ~118 | 11 个 Redis 缓存方法 |
| **P2** | `SkillDiscoveryService` | ~103 | GitHub API 搜索，独立外部调用 |
| **P3** | `SkillSuggestionEngine` | ~181 | 推荐引擎逻辑 |

#### 关键代码味道

| 问题 | 说明 |
|------|------|
| 硬编码 GitHub API URL | 搜索 URL 应可配置 |
| 缓存预热三步重复 | create/update/discover 后都执行相同的 3 步缓存操作 |
| `as unknown as Skill` 强转频繁 | Mongoose 文档类型与领域类型未对齐 |

---

### 8. 跨文件共性问题

| 问题 | 涉及文件 | 建议 |
|------|---------|------|
| `uniqueStrings()` 重复实现 | memo.service / skill.service / agent.service | 提取至 `shared/utils` |
| `escapeRegex()` 重复实现 | memo.service / skill.service / tool.service | 同上 |
| `*Safely()` 错误吞没包装模式 | memo.service (3处) / skill.service (4处) | 提取为通用 `safeguard()` 高阶函数 |
| Mongoose `as any` / `as unknown as X` | 全部 4 个文件 | 统一 Mongoose Document → 领域类型的转换层 |
| 环境变量散落无统一管理 | tool.service (12个) / 其他文件 | 收敛至 NestJS ConfigModule |

---

### 9. 拆分优先级总览

```
P0 （立即收益，低风险）
├── tool.service.ts: 提取 builtin-tool-definitions.ts（-750行）
├── tool.service.ts: 提取 InternalApiClient（-140行）
└── agent.service.ts: 提取 AgentExecutionService（-1,130行）

P1 （高价值，中等复杂度）
├── tool.service.ts: 提取 OrchestrationToolHandler（-550行）
├── tool.service.ts: 提取 RequirementToolHandler（-280行）
├── tool.service.ts: 提取 RepoToolHandler（-280行）
├── tool.service.ts: 提取 ToolGovernanceService（-150行）
├── agent.service.ts: 提取 AgentOrchestrationIntentService（-400行，历史项，文件已于 2026-03-19 删除）
├── agent.service.ts: 提取 AgentModelManagementService（-450行）
├── memo.service.ts: 提取 MemoTaskTodoService（-250行）
└── memo.service.ts: 提取 MemoTaskHistoryService（-230行）

P2 （改善维护性）
├── agent.service.ts: 提取 AgentMcpProfileService（-455行）
├── memo.service.ts: 提取 MemoBehaviorAggregatorService（-150行）
├── runtime-orchestrator: 提取 ToolEventRecorder（-163行）
├── runtime-persistence: 提取 RuntimeEventOutboxService（-197行）
├── skill.service.ts: 提取 SkillCacheService（-118行）
├── skill.service.ts: 提取 SkillDiscoveryService（-103行）
└── 共享工具函数提取 uniqueStrings/escapeRegex/safeguard

P3 （锦上添花）
├── 其余小型 ToolHandler（Meeting/Model/Skill/Audit）
├── 种子数据外部化
└── Mongoose 类型对齐
```

**预期效果**: P0+P1 完成后，6 个核心文件从 **12,326 行减至约 4,400 行**，平均每个文件 ~730 行。

---

## 第二章：Orchestration 模块功能设计与实现问题

### 1. 模块概览

Orchestration 模块位于 `backend/src/modules/orchestration/`，是一个计划-执行工作流引擎，包含：

| 文件 | 行数 | 职责 |
|------|------|------|
| `orchestration.service.ts` | 2,057 | 核心引擎：计划管理、任务执行、智能分配、输出验证 |
| `scheduler/scheduler.service.ts` | 1,000 | 定时调度：cron/interval、系统调度、memo 聚合定时器 |
| `planner.service.ts` | 221 | 任务拆解：Agent 拆解 + 启发式兜底 |
| `session-manager.service.ts` | 108 | 会话代理：已弱化（代理到 agents 侧） |
| `orchestration.controller.ts` | 261 | REST API 控制器 |
| 其他 DTO / module | ~238 | DTO 定义与模块配置 |

**合计**: ~3,885 行后端代码 + 3 个 Schema + 前端 ~2,887 行。

---

### 2. orchestration.service.ts (2,057行) — 设计问题

#### 2.1 架构层面

**问题 A: `executeTaskNode` 方法 260 行，混合 7 种职责**

这是整个编排引擎的核心方法（`orchestration.service.ts:859-1118`），但在单个方法中混合了：
1. 任务状态分类（agent/employee/unassigned）
2. Agent 能力检测（邮件工具检查）
3. 执行 payload 构建（描述拼接、依赖上下文）
4. Agent 执行调用（`agentClientService.executeTask`）
5. 输出验证（研究/审阅/邮件/代码四种验证器）
6. 数据库持久化（任务状态更新）
7. PlanSession 同步（会话视图更新）

**建议**: 拆解为 pipeline 模式：`classify → route → buildPayload → execute → validate → persist`。

**问题 B: `createPlanFromPrompt` 与 `replanPlan` ~80% 代码重复**

两个方法（123行 + 136行）共享几乎相同的流程：
1. 调用 `plannerService.planFromPrompt`
2. 遍历结果，为每个任务调用 `selectExecutor`
3. 构建 `tasksToCreate` 数组（结构完全一致）
4. `orchestrationTaskModel.insertMany`
5. 回填 `dependencyTaskIds`
6. 更新 plan 文档
7. Upsert PlanSession
8. 可选 `autoRun`

唯一区别：`replanPlan` 先删除旧任务并保留 `plan.metadata`。

**建议**: 提取 `_createTasksFromPlanningResult(planId, result, requirementObjectId)` 共享方法。

**问题 C: 4 个 public 方法返回 `Promise<any>`**

`createPlanFromPrompt`、`replanPlan`、`updatePlan`、`getPlanById` 缺少具体返回类型定义，传播 `any` 到调用链，类型安全降级。

#### 2.2 requirementId 处理缺陷（与已知问题 1.1 呼应）

| 缺陷 | 位置 | 影响 |
|------|------|------|
| **类型不一致** | Plan 存储为 `string`（在 metadata 袋中），Task 存储为 `ObjectId` | 需要 3 个转换辅助方法互相转换，易出错 |
| **`updatePlan` 不处理 requirementId** | `orchestration.service.ts:332` | 通过 metadata 泛合并可能绕过验证 |
| **`retryTask` 不触发需求状态同步** | `orchestration.service.ts:679` | 重试成功的任务不会推进需求状态 |
| **`debugTaskStep` 不触发需求状态同步** | `orchestration.service.ts:782` | 同上 |
| **`completeHumanTask` 不检查计划完成度** | `orchestration.service.ts:629` | 人工任务完成后不检查计划是否全部完成，不触发需求状态变更 |
| **`executeStandaloneTask` 无需求交互** | `orchestration.service.ts:1130` | 独立任务即使属于有 requirementId 的计划，完成也不触发需求回写 |
| **review→done 即时跳转** | `orchestration.service.ts:517-518` | 计划完成后先设 `review` 再立刻设 `done`，需求永远不会停留在 review 状态 |
| **`assigned` 状态从未使用** | `tryUpdateRequirementStatus` 支持但无调用方传入 `'assigned'` | 需求状态机不完整 |

**建议**: 
1. 将 requirementId 提升为 Plan Schema 的一级字段（而非 metadata 内嵌）
2. 将需求状态同步逻辑统一收敛到 `refreshPlanStats()` 的后置钩子中
3. 增加 review 审批门控，不要直接跳转 done

#### 2.3 任务分类与验证机制

**问题 D: 硬编码关键词匹配做任务分类（已知问题 1.4）**

| 分类方法 | 位置 | 关键词示例 |
|---------|------|-----------|
| `isEmailTask()` | L1592 | `send email`, `发送邮件`, `@` |
| `isResearchTask()` | L1604 | `research`, `调研`, `city_population` |
| `isCodeTask()` | L1666 | `开发`, `implement`, `bug`, `refactor` |
| `isReviewTask()` | L1967 | `review`, `审查`, `code review` |
| `detectResearchTaskKind()` | L1831 | `city_population`, `generic_research` |

这些方法不可扩展、不可配置，且 `city_population` 是一个明显的 demo 遗留。

**建议**: 提取为 `TaskClassificationService`，使用可配置规则表或 LLM 分类替代关键词匹配。

**问题 E: 输出验证依赖 Agent 输出中的魔术标记（已知问题 1.5）**

验证器依赖 Agent 在输出中包含特定标记：
- `EMAIL_SEND_PROOF: {...}` — 正则提取 JSON
- `RESEARCH_EXECUTION_PROOF: {...}` — 正则提取 JSON
- `CODE_EXECUTION_PROOF` — 检查 build/test/lint 证据

这种"约定输出格式"的方式脆弱且不可靠。Agent 可能不遵守格式、输出位置不固定、JSON 截断等都会导致验证失败。

**建议**: 
1. 短期：提取为 `TaskOutputValidationService`（~300行），与主逻辑解耦
2. 中期：改用 structured output（JSON mode）让模型直接返回结构化结果
3. 长期：工具调用本身应该返回执行结果，而非在 LLM 文本中寻找证据

#### 2.4 执行器选择算法（selectExecutor, 108行）

**问题 F: 四级瀑布式分配优先级**

1. `isEmailTask()` → 邮件 Agent → 员工 → unassigned
2. `isResearchTask()` → 研究 Agent → fall through
3. 无匹配 → 第一个活跃 Agent → unassigned
4. Agent 得分 ≥ 员工得分 → Agent，否则员工

问题：
- 得分算法使用 `text.includes()` 统计命中次数，粒度粗
- 当 Agent 和员工都无匹配时，默认取"第一个活跃 Agent"，无随机/负载均衡考虑
- 不支持基于历史执行效果的反馈调整

**建议**: 提取为 `ExecutorSelectionService`，并支持策略模式（规则/LLM/混合）可切换。

#### 2.5 内存锁问题（已知问题 1.3）

```typescript
// orchestration.service.ts:44
private readonly runningPlans = new Set<string>();
```

补充发现：
- `runPlan()` (L458) 不检查 `runningPlans`，只有 `runPlanAsync()` (L523) 检查 → 直接调用 `runPlan()` 可绕过锁
- `runPlanAsync` 使用 `setTimeout(..., 0)` 延迟执行，`.catch()` 仅将错误写入 `metadata.asyncRunError`，无监控告警
- 锁的粒度是 `planId-timestamp`，不是纯 `planId`，因此理论上快速双击仍可能创建两个 runKey 不同的执行

---

### 3. scheduler.service.ts (1,000行) — 设计问题

#### 3.1 职责越界

当前 Scheduler 服务承担了 **4 种不相关职责**：

| 职责 | 方法数 | 行数 | 是否属于调度 |
|------|--------|------|-------------|
| 通用 Schedule CRUD | 10 | ~200 | 是 |
| 会议监控系统调度 | 4 | ~134 | 是 |
| 工程统计系统调度 | 4 | ~163 | 是 |
| Memo 聚合定时器 | 1 | ~30 | **否** |
| 核心调度引擎 | 4 | ~180 | 是 |

`startMemoAggregationTimers()` 与调度无关，仅因该服务有 `OnModuleInit` 生命周期而被放在此处。应迁移到独立的 `MemoSchedulerService`。

#### 3.2 系统调度代码结构性重复

`ensureMeetingMonitorSchedule()` (68行) 与 `ensureEngineeringStatisticsSchedule()` (87行) 遵循完全相同的四步模式：
1. `ensureSystemPlan()` → 获取 planId
2. 查找已有 schedule
3. 存在则更新 + 重新注册
4. 不存在则创建新模型 + 注册

`ensureMeetingMonitorPlan()` (41行) 与 `ensureEngineeringStatisticsPlan()` (40行) 也完全同构。

**建议**: 提取 `ensureSystemSchedule(config: SystemScheduleConfig)` + `ensureSystemPlan(config: SystemPlanConfig)` 通用方法，消除 ~200 行重复。

#### 3.3 调度引擎问题

**问题 G: `dispatchSchedule()` 135 行，职责过多**

一个方法中包含：锁检查 → 锁获取 → 状态更新 → 任务创建 → 执行分发 → 结果处理 → 统计更新 → 锁释放。至少应拆为 4 个子方法。

**问题 H: 内存锁与已知问题 1.6 一致**

```typescript
private readonly runLocks = new Set<string>();
```

与 `orchestration.service.ts` 的 `runningPlans` 完全相同的问题：不分布式、不持久化、无超时保护。

**问题 I: `computeNextRunAt` 静默吞没异常**

```typescript
// scheduler.service.ts:805
try { /* cron parse */ } catch {}  // bare catch, returns undefined silently
```

cron 表达式解析失败时无日志、无告警，导致 `nextRunAt` 为 `undefined` 写入数据库。

**问题 J: 调度失败无重试/死信机制**

`dispatchSchedule` 捕获错误后仅标记 `status: 'error'`，后续自动触发仍会继续，但无指数退避、无重试次数上限、无告警通道。

#### 3.4 硬编码问题

| 值 | 出现次数 | 说明 |
|----|---------|------|
| `'Asia/Shanghai'` | 6 处 | 应为类级常量 |
| `'meeting-assistant'` | 4 处 | 系统 Agent ID 应可配置 |
| `300000` (5分钟) | 1 处 | 会议监控最小间隔 |
| `'0 9 * * *'` | 1 处 | 工程统计默认 cron |
| `3600000` / `7200000` | 各 1 处 | 会议警告/结束阈值 |

---

### 4. planner.service.ts (221行) — 设计问题

整体质量较好，但存在以下问题：

| 问题 | 说明 |
|------|------|
| 启发式拆解过于简单 | `planByHeuristic` 仅按标点断句，对单句需求默认拆为 4 个固定步骤 |
| 依赖优化硬编码邮件流程 | `optimizeDependencies` 仅处理邮件草稿→发送的依赖关系，不可扩展 |
| Agent 拆解失败静默降级 | `planByAgent` 失败时 `catch { return null }` 无日志 |
| `tryParseJson` 重复实现 | 与 `orchestration.service.ts` 中的 `tryParseJson` 逻辑几乎相同 |

---

### 5. session-manager.service.ts (108行) — 设计问题

| 问题 | 说明 |
|------|------|
| `listSessions` 空实现 | `return []` — 永远返回空数组 |
| 遍地 `as any` 类型转换 | 6 处 `(dto as any).*` 表明 DTO 类型定义不完整 |
| 全部方法返回 `Promise<any>` | 无具体返回类型 |
| `appendMessages` 逐条串行 | 多消息追加使用 for 循环逐条调用 API，无批量接口 |

---

### 6. 对照功能文档的实现偏差

以下为功能文档 (`docs/feature/ORCHETRATION_TASK.md`) 描述的能力与实际实现的偏差：

| 文档描述 | 实际情况 | 差距 |
|---------|---------|------|
| "支持任务依赖管理" | 依赖仅在 `executeTaskNode` 中 `buildDependencyContext` 注入上下文，无真正的 DAG 调度器 | 缺少并行模式下的依赖图执行引擎 |
| "parallel: 无依赖任务并行执行" | `runPlan` 中 sequential/parallel/hybrid 三种模式的实际执行差异不明确 | 需验证 parallel 模式是否真正实现了并发 |
| "hybrid: 优先并行，必要时降级为顺序" | 实际行为需确认 | 文档描述模糊，实现可能与预期不符 |
| "计划关联 requirementId，闭环触发" | review→done 即时跳转、多个入口遗漏同步 | 闭环不完整 |
| "智能分配：关键词匹配度" | `text.includes()` 统计 | 距"智能"有较大差距 |
| "外部动作验证：要求可验证证明" | 正则提取魔术标记 | 脆弱，依赖 Agent 遵守约定 |
| "调试 MCP: 返回建议下一步动作" | 实现中有简单的三元判断 | 建议逻辑过于简化 |

---

### 7. Orchestration 模块拆分建议

#### orchestration.service.ts (2,057行) 推荐拆分

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P0** | 提取共享 `_createTasksFromPlanningResult()` | — | 消除 createPlan/replanPlan 重复 |
| **P1** | `TaskClassificationService` | ~100 | `isEmailTask/isResearchTask/isCodeTask/isReviewTask/detectResearchTaskKind` 等 8 个方法 |
| **P1** | `TaskOutputValidationService` | ~300 | 所有 `validate*`/`extract*Proof` 方法 |
| **P1** | `ExecutorSelectionService` | ~130 | `selectExecutor` + 能力检测方法 |
| **P2** | `PlanSessionSyncService` | ~80 | 散布在多个方法中的 PlanSession 同步逻辑 |
| **P2** | `RequirementSyncService` | ~50 | requirementId 解析 + 状态回写 |

**拆分后效果**: orchestration.service.ts 从 2,057 行缩减至 **~1,100 行**。

#### scheduler.service.ts (1,000行) 推荐拆分

| 优先级 | 提取目标 | 预计行数 | 说明 |
|--------|---------|---------|------|
| **P1** | 迁移 `MemoSchedulerService` | ~30 | memo 聚合定时器不属于编排调度 |
| **P2** | 提取 `SystemScheduleBootstrap` | ~200 | 系统调度（会议监控 + 工程统计）的 ensure 逻辑合并为通用方法 |
| **P2** | 拆解 `dispatchSchedule()` | — | 135 行方法拆为 4 个子方法 |

---

## 第三章：综合 Review — 与已有问题清单对照 & 新发现问题

### 1. 已有问题清单覆盖情况

对照 `docs/plan/SYSTEM_TECHNICAL_ISSUES_PLAN.md` 中的 7 类问题，逐一验证 review 是否覆盖并标注补充发现：

| # | 已有问题 | 本次 Review 覆盖 | 补充发现 |
|---|---------|-----------------|---------|
| 1.1 | 编排任务无 requirementId 关联 | 第二章 §2.2 详细分析 | 发现 8 个具体缺陷点，比原描述更深入 |
| 1.2 | 编排 MCP 工具强依赖会议上下文 | 第一章 §2（tool.service.ts `assertMeetingContext` 11 处调用） | 功能文档已标注"meeting/autonomous 双上下文断言"（AGENT_TOOL.md §1.3.15），需确认代码是否已实现 |
| 1.3 | 编排执行使用内存锁 | 第二章 §2.5 详细分析 | 补充：`runPlan()` 不检查锁可绕过；锁粒度含时间戳导致重复风险 |
| 1.4 | 任务智能分配使用硬编码关键词 | 第二章 §2.3 问题 D | 无新增 |
| 1.5 | 任务完成验证使用正则规则匹配 | 第二章 §2.3 问题 E | 增加了短/中/长期改进路径建议 |
| 1.6 | 调度器触发使用内存锁 | 第二章 §3.3 问题 H | 补充：`computeNextRunAt` 静默吞没异常 |
| 2.1 | OpenCode 执行角色门禁硬编码 | 第一章 §3.3（agent.service.ts `OPENCODE_ALLOWED_ROLE_CODES`） | 无新增 |
| 2.2 | Runtime 执行使用内存 Promise Chain 锁 | 第一章 §5.2 | 无新增 |
| 2.3 | 预算门禁是异步暂停，非硬阻断 | 第一章 §3.3（`applyAgentBudgetGate` 81行） | 无新增 |
| 2.4 | 工具执行分发使用巨型 switch-case | 第一章 §2（tool.service.ts 38 分支 switch） | 补充：三处工具 ID 需同步维护 |
| 4.1 | 速率限制与熔断使用内存 Map | 第一章 §2.2（ToolGovernanceService 拆分建议） | 无新增 |
| 4.2 | 工具 ID 规范化依赖运行时解析 | 第一章 §3.3（normalizeToolId/LEGACY_TOOL_ID_ALIASES） | 无新增 |

---

### 2. 本次 Review 新发现的问题（已有清单未涉及）

#### 2.1 代码结构类

| # | 问题 | 模块 | 严重程度 | 位置 |
|---|------|------|---------|------|
| N-1 | **tool.service.ts 4,286 行 God Class** | agents/tools | 高 | 整个文件 |
| N-2 | **agent.service.ts 3,567 行 God Class** | agents/agents | 高 | 整个文件 |
| N-3 | **memo.service.ts 70 个方法 God Class** | agents/memos | 高 | 整个文件 |
| N-4 | **orchestration.service.ts `createPlanFromPrompt`/`replanPlan` 80% 重复** | orchestration | 中 | L67-330 |
| N-5 | **`executeTaskDetailed`/`executeTaskWithStreaming` 80% 重复** | agents/agents | 高 | L1183-1723 |
| N-6 | **scheduler.service.ts 系统调度 ensure 逻辑 100% 结构性重复** | orchestration/scheduler | 中 | L112-308 |
| N-7 | **`uniqueStrings`/`escapeRegex`/`tryParseJson` 跨文件重复实现** | 多文件 | 低 | 散布 |
| N-8 | **构造函数注入 14 个依赖**（tool.service + agent.service 各 14） | agents | 高 | 构造函数 |

#### 2.2 功能设计类

| # | 问题 | 模块 | 严重程度 | 说明 |
|---|------|------|---------|------|
| N-9 | **编排 parallel/hybrid 模式实现存疑** | orchestration | 中 | 功能文档描述"无依赖任务并行执行"，但实际代码中 `runPlan` 的三种模式执行差异需验证 |
| N-10 | **需求状态 review→done 即时跳转** | orchestration | 高 | 需求永远不会停在 review 状态，无审批门控 |
| N-11 | **`completeHumanTask`/`retryTask`/`debugTaskStep` 不触发需求同步** | orchestration | 高 | 仅 `runPlan` 完成后触发需求回写，其他入口遗漏 |
| N-12 | **Scheduler memo 聚合定时器职责越界** | orchestration/scheduler | 中 | memo timer 与调度无关，仅因 `OnModuleInit` 挂载在此 |
| N-13 | **调度失败无重试/死信机制** | orchestration/scheduler | 中 | 仅标记 error 状态，无退避/告警 |
| N-14 | **`computeNextRunAt` 静默吞没 cron 解析异常** | orchestration/scheduler | 中 | bare catch 无日志 |
| N-15 | **`session-manager.service.ts` `listSessions` 空实现** | orchestration | 低 | `return []` 永远返回空数组 |
| N-16 | **planner 拆解失败静默降级** | orchestration | 低 | `planByAgent` catch 内无日志 |

#### 2.3 安全与稳定性类

| # | 问题 | 模块 | 严重程度 | 说明 |
|---|------|------|---------|------|
| N-17 | **`contextSecret` 硬编码 fallback** | agents/tools | 高 | `tool.service.ts:121` 有 `'internal-context-secret'` 默认值，泄露风险 |
| N-18 | **Mongoose `as any`/`as unknown as X` 全局泛滥** | 全模块 | 中 | 类型安全降级，runtime bug 风险增加 |
| N-19 | **`isCtoAgent()` 硬编码 persona 名称** | agents/agents | 高 | 使用 `'sarah kim'` 字符串做身份判断 |
| N-20 | **多处内存状态无跨实例方案** | 全模块 | 高 | `runningPlans`(Set), `runLocks`(Set), `lockTails`(Map), `rateLimitHits`(Map), `circuitBreakers`(Map), memo timers — 共 6 处内存状态 |
| N-21 | **`runPlanAsync` 异步错误仅写 metadata，无监控** | orchestration | 中 | 编排执行失败后无告警通道 |

#### 2.4 可维护性类

| # | 问题 | 模块 | 严重程度 | 说明 |
|---|------|------|---------|------|
| N-22 | **12+ 个环境变量散落在 tool.service.ts** | agents/tools | 中 | 无统一 ConfigService 管理 |
| N-23 | **30+ 处硬编码中文字符串** | agents/agents | 中 | 无 i18n 基础设施 |
| N-24 | **`'Asia/Shanghai'` 硬编码 6 处** | orchestration/scheduler | 低 | 应为常量 |
| N-25 | **`city_population` demo 遗留** | orchestration | 低 | 硬编码在通用引擎中的特定 demo 逻辑 |
| N-26 | **`runtime-persistence.service.ts` 42 个 public 方法** | agents/runtime | 中 | 接口过宽，职责过多 |
| N-27 | **`dispatchSchedule()` 135 行单方法** | orchestration/scheduler | 中 | 职责混合：锁/创建/执行/统计 |

---

### 3. 综合优先级排序

#### P0 — 阻断性问题或高安全风险（建议立即处理）

| # | 问题 | 来源 | 模块 |
|---|------|------|------|
| 1.1 | 编排任务 requirementId 关联不完整 | 已有 | orchestration |
| 1.2 | 编排 MCP 工具强依赖会议上下文 | 已有 | agents/tools |
| N-10 | 需求状态 review→done 即时跳转 | 新发现 | orchestration |
| N-11 | 多入口不触发需求同步 | 新发现 | orchestration |
| N-17 | contextSecret 硬编码 fallback | 新发现 | agents/tools |
| N-19 | isCtoAgent 硬编码 persona 名称 | 新发现 | agents/agents |

#### P1 — 影响功能完整性或代码可维护性

| # | 问题 | 来源 | 模块 |
|---|------|------|------|
| 2.1 | OpenCode 角色门禁硬编码 | 已有 | agents/agents |
| N-1 | tool.service.ts God Class (4,286行) | 新发现 | agents/tools |
| N-2 | agent.service.ts God Class (3,567行) | 新发现 | agents/agents |
| N-5 | executeTaskDetailed/Streaming 80% 重复 | 新发现 | agents/agents |
| N-9 | parallel/hybrid 模式实现存疑 | 新发现 | orchestration |
| N-20 | 6 处内存状态无跨实例方案 | 新发现 | 全模块 |

#### P2 — 改善稳定性和可维护性

| # | 问题 | 来源 | 模块 |
|---|------|------|------|
| 1.3+1.6 | 内存锁不持久化 | 已有 | orchestration |
| 1.4 | 任务分配硬编码关键词 | 已有 | orchestration |
| 1.5 | 任务验证正则匹配 | 已有 | orchestration |
| 2.2 | Runtime Promise Chain 锁 | 已有 | agents/runtime |
| N-3 | memo.service.ts God Class (1,712行) | 新发现 | agents/memos |
| N-4 | createPlan/replanPlan 重复 | 新发现 | orchestration |
| N-12 | Scheduler memo timer 职责越界 | 新发现 | orchestration/scheduler |
| N-13 | 调度失败无重试/死信 | 新发现 | orchestration/scheduler |
| N-22 | 环境变量无统一管理 | 新发现 | agents/tools |

#### P3 — 锦上添花

| # | 问题 | 来源 | 模块 |
|---|------|------|------|
| N-7 | 工具函数跨文件重复 | 新发现 | 多文件 |
| N-14 | cron 解析异常静默吞没 | 新发现 | orchestration/scheduler |
| N-15 | listSessions 空实现 | 新发现 | orchestration |
| N-16 | planner 失败静默降级 | 新发现 | orchestration |
| N-18 | Mongoose as any 泛滥 | 新发现 | 全模块 |
| N-23 | 硬编码中文字符串 | 新发现 | agents/agents |
| N-25 | city_population demo 遗留 | 新发现 | orchestration |

---

### 4. 建议行动路线

```
Phase 1: 安全与功能闭环修复（P0，1-2 周）
├── 修复 contextSecret 硬编码 fallback
├── 移除 isCtoAgent 中的 persona 名称硬编码
├── 统一需求状态同步入口（收敛到 refreshPlanStats 后置钩子）
├── 增加 review 状态审批门控
└── 验证并修复 orchestration MCP 双上下文断言

Phase 2: 代码结构重构（P0-P1，3-4 周）
├── tool.service.ts 拆分（P0 项可先行：builtin 数据 + API client）
├── agent.service.ts 拆分（P0 项先行：AgentExecutionService）
├── orchestration.service.ts 消除 createPlan/replanPlan 重复
├── executeTaskDetailed/Streaming 统一执行模板
└── memo.service.ts 拆分（MemoTaskTodoService + MemoTaskHistoryService）

Phase 3: 架构加固（P2，持续改进）
├── 内存锁替换为分布式锁（Redis 或 MongoDB 乐观锁）
├── 环境变量收敛至 NestJS ConfigModule
├── 调度器增加失败重试 + 死信机制
├── Scheduler memo timer 迁出
└── TaskClassificationService 可配置化
```

---

### 5. 数据汇总

| 维度 | 数值 |
|------|------|
| Review 覆盖文件数 | 10 个核心 .ts 文件 |
| 已有问题清单条目 | 12 条（7 类） |
| 本次新发现问题 | 27 条 |
| 建议拆分的新 Service 数 | agents 侧 16 个 + orchestration 侧 8 个 |
| 预计可消除的代码行数 | P0+P1 合计 ~8,000 行（从大文件中提取） |
| 识别的内存状态风险点 | 6 处 |
| 识别的安全风险点 | 2 处（contextSecret + persona 硬编码） |

---

## 第四章：新增专项审计（集合命名 / MCP 鉴权 / Toolkit-Tool 边界）

本章响应新增的 3 个审计问题：
1. 数据库 collection 命名统一性（目标：`module_model`）
2. MCP 工具调用缺少鉴权
3. Toolkit 与 Tool 职责边界不清晰

---

### 1. Collection 命名一致性审计

#### 1.1 审计范围与口径

已审计目录：
- `backend/src/shared/schemas/`
- `backend/apps/agents/src/schemas/`
- `backend/apps/engineering-intelligence/src/schemas/`

判定口径：
- **一致**：显式声明 `@Schema({ collection: 'module_model' })` 且为 snake_case
- **不一致**：
  - 未显式声明（落入 Mongoose 默认复数化，如 `agentmemos`）
  - 或显式值不符合 `module_model` 规范（无模块前缀/语义混乱）

#### 1.2 总体结论

| 指标 | 数值 |
|------|------|
| Schema 总数（唯一类） | 38 |
| 显式声明 `collection` | 15 |
| 依赖 Mongoose 默认命名 | 23 |
| 一致（可接受） | 15 |
| 不一致 | 23 |

核心结论：**61% 的 schema 未显式声明 collection，命名漂移严重**，已出现 `agent_runs` 与 `agentmemos` 并存的风格割裂。

#### 1.3 重点不一致样例

| Schema | 当前集合名 | 问题 | 建议名 |
|--------|-----------|------|-------|
| `AgentMemo` | `agentmemos` | 默认复数化，非 snake_case | `agent_memos` |
| `AgentSkill` | `agentskills` | 默认复数化 | `agent_skills` |
| `AgentMemoVersion` | `agentmemoversions` | 默认复数化 | `agent_memo_versions` |
| `OrchestrationPlan` | `orchestrationplans` | 默认复数化 | `orchestration_plans` |
| `OrchestrationTask` | `orchestrationtasks` | 默认复数化 | `orchestration_tasks` |
| `OrchestrationSchedule` | `orchestrationschedules` | 默认复数化 | `orchestration_schedules` |
| `ToolExecution` | `toolexecutions` | 默认复数化 | `tool_executions` |
| `AgentSession` | `agentsessions` | 默认复数化 | `agent_sessions` |
| `AgentProfile` | `agentprofiles` | 默认复数化 | `agent_profiles` |
| `EngineeringRepository` | `engineeringrepositories` | 默认复数化 | `ei_repositories` |

#### 1.4 高风险结构问题：`AgentSession` 双定义

`AgentSession` 在两个位置分别定义，且都未显式声明 collection：
- `backend/src/shared/schemas/agent-session.schema.ts`
- `backend/apps/agents/src/schemas/agent-session.schema.ts`

两者都会落到 `agentsessions`，且字段并不完全一致。该问题会造成：
- 模型注册顺序敏感
- 同名 Model 在不同模块上下文中行为不稳定
- 隐性 schema 漂移风险

#### 1.5 落地建议（分阶段）

**Phase A（先固化，不迁移）**
1. 所有 schema 补齐显式 `collection`，避免未来继续漂移
2. 新增 lint/脚本规则：禁止缺省 collection

**Phase B（迁移存量）**
1. 对不一致 collection 建立迁移清单（旧名→新名）
2. 分批执行 rename/migrate（低流量窗口）
3. 灰度期双读或兼容映射，完成后删除旧集合引用

**Phase C（治理）**
1. 发布《Mongo Collection 命名规范》：统一 `module_model`
2. 在 PR 检查中加入 schema 命名校验

---

### 2. MCP 工具调用鉴权审计

> 结论先行：当前代码中的 “MCP 工具”主要是内部工具 ID 命名体系，并非完整外部 MCP 协议链路；但工具执行链路确实存在多处鉴权/授权缺口。

#### 2.1 调用链路（关键路径）

1. `AgentService.executeWithToolCalling()` 从 LLM 结果中解析 `<tool_call>`
2. 仅在该路径中校验 `assignedToolIds.has(toolId)`（白名单）
3. 调用 `ToolService.executeTool()`
4. `ToolService.authorizeToolExecution()` 执行基础检查
5. `executeToolImplementation()` switch-case 分发到具体实现
6. 部分内部工具通过 `buildSignedHeaders()` 调用其他服务

#### 2.2 发现的主要缺口

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| A-1 | `authorizeToolExecution()` 仅做启用态与 agentId 非空检查 | 高 | 未使用 `requiredPermissions` 做权限判定 |
| A-2 | 真实发起人身份未透传，内部调用使用固定系统身份 | 高 | 下游无法做 user-level 授权与审计归因 |
| A-3 | 工具白名单仅在 Agent 循环路径生效 | 高 | 若有其他路径直调 `ToolService.executeTool`，可能绕过白名单 |
| A-4 | `inputSchema` 未严格校验 | 中 | LLM 参数可直接进入执行器 |
| A-5 | 工具输出未做注入防护/净化 | 中 | 存在间接 prompt injection 风险 |
| A-6 | `INTERNAL_CONTEXT_SECRET` 存在硬编码 fallback | 高 | 可被伪造内部上下文 |
| A-7 | 部分命令型工具参数约束不足（repo-read 场景） | 中 | 仍有参数注入边界风险 |

#### 2.3 鉴权模型建议

**建议目标：从“工具可用”升级为“主体-权限-作用域”三元校验**

1. **执行入口统一授权**
   - 在 `ToolService.executeTool()` 内强制做：
     - `tool enabled`
     - `assigned whitelist`
     - `requiredPermissions`
     - `tenant/org scope`
2. **透传真实主体**
   - `buildSignedHeaders()` 增加 `actorId/actorRole/originSessionId`
   - 下游服务按真实主体做 RBAC
3. **Schema 强校验**
   - 入参按 `inputSchema` 校验（失败直接拒绝）
4. **输出净化与隔离**
   - 工具结果进入 LLM 前做最大长度、结构白名单、敏感字段过滤
5. **密钥治理**
   - 移除 `INTERNAL_CONTEXT_SECRET` 默认值；启动时强制校验

---

### 3. Toolkit vs Tool 边界审计

#### 3.1 现状结论

当前实现中，Toolkit 更像是从 Tool 派生出来的“物化分组视图”，而非独立一等领域对象：
- 无 `ToolkitService`
- Toolkit 基本由 `ToolService` 在工具初始化/同步时自动 upsert
- 多数字段从 Tool ID 解析得到，非人工维护主数据

#### 3.2 边界模糊点

| 编号 | 模糊点 | 说明 |
|------|--------|------|
| B-1 | `provider/namespace/executionChannel` 双边重复 | Toolkit 与 Tool 同时存储，来源一致，造成冗余 |
| B-2 | Toolkit 状态对 Tool 执行无实际约束 | Toolkit `disabled/deprecated` 不影响 Tool 可执行性 |
| B-3 | Tool 本身存在 `enabled + status + deprecated` 三套状态语义 | 语义重叠且未统一执行口径 |
| B-4 | Toolkit 字段 `rateLimitPolicyId/defaultTimeoutMs` 基本未参与执行链 | 设计意图与实现脱节 |
| B-5 | 工具查询接口大量按 Tool ID 解析 toolkit 信息 | 读取路径并不依赖 Toolkit 集合 |
| B-6 | API 结构上 toolkit 归属在 `/tools/toolkits` | 体现为 Tool 子资源，而非平级域 |

#### 3.3 设计澄清建议（两种可选方向）

**方向 1：Toolkit 作为“策略容器”（推荐）**
1. Toolkit 成为独立可管理实体（独立 service + CRUD）
2. Tool 只保留 `toolkitId` 引用，不重复存 provider/channel/namespace
3. 执行时先读取 Toolkit 策略（auth、限流、默认超时）再叠加 Tool 局部覆盖
4. 状态语义统一：Toolkit disabled 会级联禁用其 Tool（可配置）

**方向 2：去掉 Toolkit 集合，完全派生化**
1. 若仅用于分组展示，可移除持久化 Toolkit
2. Registry 查询实时按 Tool canonicalId 聚合
3. 将 `authStrategy/rateLimit/defaultTimeout` 下沉到 Tool 或 provider 配置层

#### 3.4 建议优先落地项

1. 先统一 Tool 状态语义（`enabled/status/deprecated` 三选一主口径）
2. 明确 Toolkit 是否参与执行策略；若参与，立即接入执行链
3. 若不参与执行策略，削减 Toolkit 冗余字段，降为只读聚合视图

---

### 4. 第四章问题清单（新增）

| 编号 | 问题 | 类别 | 严重度 |
|------|------|------|--------|
| N-28 | 23/38 schema 未显式声明 collection，命名漂移 | 数据一致性 | 高 |
| N-29 | `AgentSession` 双 schema 定义且同集合 | 模型冲突 | 高 |
| N-30 | 工具执行授权检查为弱校验 | 安全 | 高 |
| N-31 | 内部服务调用未透传真实主体身份 | 安全/审计 | 高 |
| N-32 | `INTERNAL_CONTEXT_SECRET` 默认值风险 | 安全 | 高 |
| N-33 | tool input/output 缺少强校验与净化 | 安全 | 中 |
| N-34 | Toolkit 与 Tool 领域边界不清晰（冗余字段 + 无策略生效） | 架构 | 中 |
| N-35 | Tool 状态语义三轨并存，执行口径不一致 | 架构/可维护性 | 中 |

---

### 5. 结合前三章后的总行动建议（增补）

```
Phase 0（安全热修，1-3 天）
├── 移除 INTERNAL_CONTEXT_SECRET 默认值
├── 在 ToolService.executeTool 增加白名单 + requiredPermissions 双重校验
└── 下游签名上下文透传真实 actor 字段

Phase 1（一致性修复，1-2 周）
├── 全量 schema 显式 collection 固化
├── 先修复 AgentSession 双定义冲突
└── 制定并落地 module_model 命名规范

Phase 2（边界重构，2-4 周）
├── 二选一：Toolkit 领域化（推荐）或 Toolkit 派生化（去持久化）
├── 统一 Tool 状态模型
└── 将 toolkit 级策略真正接入执行链（或删除无效字段）
```
