# Agent Memo（长期记忆）

## 1. 功能设计

### 1.1 目标

- 为 agent 提供长期记忆能力，沉淀简历、TODO、历史任务、草稿与主题知识。
- Memo 更新支持自动版本快照，主文档维护 `version` 递增。
- 使用 Redis 聚合缓存 + MongoDB 持久化 + Markdown 文档三层协同。
- 任务执行时按需优先读取 Redis（`memo:{agentId}:{memoKind}`），缓存缺失时回源 DB 并回填。
- 自动聚合 Agent 简历（Identity）和工作评估（Evaluation）文档

### 1.2 数据结构

```typescript
// Schema 定义: backend/apps/agents/src/schemas/agent-memo.schema.ts
type MemoKind =
  | 'identity'
  | 'todo'
  | 'topic'
  | 'history'
  | 'draft'
  | 'custom'
  | 'evaluation'
  | 'achievement'
  | 'criticism';
type MemoType = 'knowledge' | 'standard';
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 (UUID) |
| `agentId` | string | 关联的 Agent ID |
| `memoKind` | MemoKind | 备忘录类型 |
| `memoType` | MemoType | 备忘录子类型 |
| `title` | string | 标题 |
| `slug` | string | 稳定 URL |
| `content` | string | 内容 (Markdown) |
| `version` | number | 版本号 |
| `payload` | Object | 扩展字段 (topic/taskId/status/toolCalls/period/sources) |
| `tags` | string[] | 标签 |
| `contextKeywords` | string[] | 上下文关键词 |
| `source` | string | 来源 |

- 版本表：`AgentMemoVersion(memoId, version, content, changeNote, createdAt)`

### 1.3 文档类型

#### 标准备忘录 vs 主题备忘录

| 分类 | memoKind | memoType | 说明 |
|------|----------|----------|------|
| **标准** | `identity` | standard | Agent 动态简历（角色、技能、任务履历） |
| **标准** | `todo` | standard | 任务清单（状态追踪） |
| **标准** | `history` | standard | 历史任务记录 |
| **标准** | `draft` | standard | 草稿 |
| **标准** | `evaluation` | standard | 工作绩效评估（工具使用、SLA指标） |
| **标准** | `achievement` | standard | 成绩备忘录（记录做得很好的事情） |
| **标准** | `criticism` | standard | 批评备忘录（记录做得不好的事情） |
| **标准** | `custom` | standard | 自定义 |
| **主题** | `topic` | knowledge | 主题知识积累（按主题归类的运行时事件聚合） |

> 注：`memoKind = topic` 时系统强制 `memoType = 'knowledge'`；`memoKind` 为 `identity`, `todo`, `history`, `draft`, `custom`, `evaluation`, `achievement`, `criticism` 时系统自动设置 `memoType = 'standard'`。

#### Achievement / Criticism 写入规则

- `achievement`：仅高管 / 人类专属助理 / HR 可记录，agent 自身禁止写入。
- `criticism`：高管 / 人类专属助理 / HR / agent 自身均可记录。
- 规则在 memo create/update 链路统一执行，基于调用方用户上下文角色与来源字段进行校验。
- 每个 agent 的 `achievement` 与 `criticism` 各维护一个文档，新增记录追加到文档末尾，不覆盖历史。
- 追加时若文档已有内容，先插入分割线 `—`，再追加本次记录。

#### Identity（简历）

- **用途**：Agent 的动态简历，包含角色、技能、任务履历等
- **数据源**：Agent 表、AgentSkill 表、Skill 表、OrchestrationTask 表
- **更新触发**：`agent.updated`、`agent.skill_changed`、定时任务
- **内容模板**：
  - Agent Profile（Agent 名称、角色、描述）
  - 技能矩阵（绑定技能、熟练度、统计）
  - 能力域（工具集、工具描述、模型能力）
  - 工作风格（人格特质、学习能力）
  - 任务履历（近30天统计、最近完成任务）

#### Evaluation（工作评估）

- **用途**：Agent 的工作绩效评估，包含工具使用、SLA指标等
- **数据源**：AgentRun 表、AgentPart 表
- **更新触发**：`task.completed`、定时任务、每月周期
- **内容模板**：
  - 工具使用统计（使用次数、成功率）
  - SLA 响应指标（完成率、平均响应时间）

#### TODO

- 只记录任务编排（orchestration）中的未执行任务，不记录会议聊天内容。
- 仅接收 `sourceType=orchestration_task` 的任务事件；`meeting_chat` 事件默认拒绝写入。
- 视图口径：`pending` / `queued` / `scheduled`（尚未进入执行态）。
- API: `POST /api/memos/todos/upsert`, `PUT /api/memos/todos/:id/status`

#### History

- 记录已执行的编排任务及状态轨迹（开始执行后到终态）。
- 视图口径：`running` / `success` / `failed` / `cancelled`。
- `todo` 中任务一旦进入执行态（如 `running`）即自动出队，并进入 `history` 聚合域。

#### Topic（主题积累）

- 按主题归类的运行时事件聚合。
- 当前已暂停自动聚合写入（事件仍可进入队列并在 flush 时丢弃，不再落库为 topic memo）。
- 历史 topic 文档保留可读，后续可按质量方案恢复聚合。

### 1.4 API（agents service）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/memos` | 分页查询备忘录 |
| POST | `/api/memos/search` | 按 agent + query 检索（支持渐进摘要） |
| POST | `/api/memos` | 创建备忘录 |
| PUT | `/api/memos/:id` | 更新备忘录 |
| DELETE | `/api/memos/:id` | 删除备忘录 |
| GET | `/api/memos/:id/versions` | 查看版本历史 |
| POST | `/api/memos/behavior` | 写入 Redis 事件流（不直接落库） |
| POST | `/api/memos/todos/upsert` | 创建/更新 TODO |
| PUT | `/api/memos/todos/:id/status` | 更新 TODO 状态 |
| POST | `/api/memos/events/flush` | 触发 Redis 聚合入库 |
| GET | `/api/memos/aggregation/status` | 查看聚合状态 |
| POST | `/api/memos/aggregation/full` | 手动触发全量聚合（Identity + Evaluation） |
| POST | `/api/memos/identity/aggregate` | 手动触发 Identity 聚合 |
| POST | `/api/memos/evaluation/aggregate` | 手动触发 Evaluation 聚合 |
| POST | `/api/memos/docs/rebuild` | 重建 Markdown 索引 |

### 1.5 MCP 工具

- `memo_mcp_search`：检索记忆（可返回摘要或全文）
- `memo_mcp_append`：追加记忆条目（新建或追加到已有 memo）

`memo_mcp_append` 提示词约束：
- 写入目标必须是目标 agent 的备忘录。
- `topic` 必须使用 `memoType=knowledge`。
- `achievement/criticism` 必须使用 `memoType=standard`，并按追加模式写入，已有内容前插入 `—` 分割线。
- 传入 `memoType=standard` 时必须显式提供 `memoKind`，避免回退默认 topic。
- `achievement/criticism` 建议显式传 `targetAgentId`（或等效 agentId 参数）确保不会误写到调用者自身。

### 1.6 聚合机制

#### 事件驱动

- Redis key：`memo:event:{agentId}`
- Redis 缓存 key：`memo:{agentId}:{memoKind}`
- Redis 刷新队列 key：`memo:refresh:queue:{agentId}`
- `MemoAggregationService` 负责事件监听与聚合能力编排，不再内置定时器
- 定时触发由编排调度模块统一承接：
  - 事件队列 flush 周期：`MEMO_AGGREGATION_INTERVAL_MS`（默认 60s）
  - 全量聚合周期：`MEMO_FULL_AGGREGATION_INTERVAL_MS`（默认 24h）
  - 总开关：`MEMO_SCHEDULER_ENABLED`（`false` 时关闭该组定时任务）

#### TODO/History 聚合边界

- 聚合主键：`taskId`（必要时追加 `orchestrationId` 作为复合键）。
- 幂等键：`taskId + eventSeq`（或 `taskId + updatedAt`）用于去重与乱序保护。
- 路由规则：
  - `todo`：仅保留未执行状态的最新快照。
  - `history`：保存进入执行后的状态事件流与最终状态快照。
- 内容过滤：聊天类事件不进入 `todo/history` 的任务聚合管道。

#### 触发事件

- `agent.updated` - Agent 基础信息变更
- `agent.skill_changed` - 技能绑定变更
- `task.completed` / `orchestration.task_completed` - 任务完成
- 定时全量聚合（默认每天）

#### 聚合结果

- Identity：`$AGENT_DATA_ROOT/memos/<agentId>/identity/identity-and-responsibilities.md`（未配置时回退 `docs/memos/...`）
- Evaluation：`$AGENT_DATA_ROOT/memos/<agentId>/evaluation/evaluation-<period>.md`（未配置时回退 `docs/memos/...`）
- Topic：按 `agent + topic` 归并到 `topic-*.md`

> 当前状态：`topic` 自动聚合已暂停，不再新增 topic 聚合文档。

#### 文档落盘

- 目录：`$AGENT_DATA_ROOT/memos/<agentId>/<memoKind>/<slug>.md`（未配置时回退 `docs/memos/...`）
- 索引：`$AGENT_DATA_ROOT/memos/README.md`（未配置时回退 `docs/memos/README.md`）

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `AGENT_MEMO_REDESIGN_PLAN.md` | 备忘录重构计划（已合并到开发总结） |
| `AGENT_MEMO_MCP_PLAN.md` | 备忘录 MCP 工具计划 |
| `TODO_HISTORY_MEMO_AGGREGATION_OPTIMIZATION_PLAN.md` | TODO/History 内容与聚合优化计划 |
| `AGENT_DETAIL_TABS_MEMO_LOG_PLAN.md` | Agent详情页备忘录/日志Tab计划 |
| `AGENTSESSION_MEMO_SNAPSHOT_PLAN.md` | AgentSession memo快照计划 |
| `AGENT_IDENTITY_EVALUATION_DEVELOPMENT_PLAN.md` | Identity/Evaluation开发计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `AGENT_MEMO_REDESIGN_PLAN.md` | 备忘录重构开发总结 |
| `AGENT_IDENTITY_EVALUATION_DEVELOPMENT_SUMMARY.md` | Identity/Evaluation开发总结 |
| `TODO_HISTORY_MEMO_AGGREGATION_OPTIMIZATION_PLAN.md` | TODO/History 内容与聚合优化开发总结 |

### 技术文档 (docs/technical/, docs/features/)

| 文件 | 说明 |
|------|------|
| `features/AGENT_MEMO.md` | 备忘录功能设计文档 |
| `technical/AGENT_IDENTITY_EVALUATION_DESIGN.md` | Identity/Evaluation技术设计 |
| `technical/TODO_HISTORY_MEMO_AGGREGATION_DESIGN.md` | TODO/History 任务聚合技术设计 |

---

## 3. 相关代码文件

### 后端 (backend/apps/agents/src/)

#### Schema 定义

| 文件 | 功能 |
|------|------|
| `schemas/agent-memo.schema.ts` | AgentMemo 数据模型定义，包含 memoKind, memoType, payload 等字段 |
| `schemas/agent-memo-version.schema.ts` | AgentMemoVersion 版本快照模型 |

#### 核心服务

| 文件 | 功能 |
|------|------|
| `modules/memos/memo.module.ts` | Memo 模块依赖注入配置 |
| `modules/memos/memo.controller.ts` | REST API 控制器，处理所有 memo 相关请求 |
| `modules/memos/memo.service.ts` | 核心业务逻辑，CRUD、搜索、版本管理 |
| `modules/memos/memo.service.spec.ts` | 单元测试 |

#### 聚合服务

| 文件 | 功能 |
|------|------|
| `modules/memos/memo-aggregation.service.ts` | 聚合编排服务，管理事件触发与全量聚合入口 |
| `modules/memos/identity-aggregation.service.ts` | Identity 简历聚合，从 Agent/Skill/Task 表聚合 |
| `modules/memos/evaluation-aggregation.service.ts` | Evaluation 工作评估聚合，从 AgentRun/AgentPart 表聚合 |

### 调度承接（backend/src/）

| 文件 | 功能 |
|------|------|
| `modules/orchestration/scheduler/scheduler.service.ts` | 统一承接 memo 定时聚合触发（flush + full） |
| `modules/orchestration/scheduler/scheduler.module.ts` | 注入 scheduler 依赖与 AgentClient 模块 |
| `modules/agents-client/agent-client.service.ts` | 调用 agents 服务 memo 聚合接口（`/events/flush`、`/aggregation/full`） |

#### 辅助服务

| 文件 | 功能 |
|------|------|
| `modules/memos/memo-event-bus.service.ts` | 事件总线，监听 agent.updated 等事件触发聚合 |
| `modules/memos/memo-doc-sync.service.ts` | Markdown 文档同步，将 memo 落盘到 docs/ 目录 |

#### 集成使用

| 文件 | 功能 |
|------|------|
| `modules/runtime/runtime-persistence.service.ts` | 会话持久化时写入 memoSnapshot |
| `modules/runtime/runtime-orchestrator.service.ts` | 运行时编排，任务完成触发 memo 事件 |
| `modules/agents/agent.service.ts` | Agent 服务，部分操作触发 memo 聚合 |

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Memos.tsx` | 备忘录管理页面 |
| `pages/AgentDetail.tsx` | Agent详情页（包含备忘录标签页） |
| `services/memoService.ts` | Memo API 调用服务 |
| `services/orchestrationService.ts` | 包含 memoSnapshot 类型定义 |
| `types/index.ts` | Memo 相关 TypeScript 类型定义 |
