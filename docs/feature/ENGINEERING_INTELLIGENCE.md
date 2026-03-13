# Engineering Intelligence（工程智能）

## 1. 功能设计

### 1.1 目标

- 承接 Agents Runtime 的 OpenCode 执行归档数据，形成可查询、可重算的研发分析数据底座。
- 统一输出成本、效率、质量与惊喜度等指标，避免分析逻辑散落在执行侧。
- 在多环境（local/ecds）场景下保持同步可追踪、可幂等、可补偿。

### 1.2 数据分层定位

- Agents（运行事实层）：保留 run 最小执行事实与运行控制状态。
- Engineering Intelligence（分析层）：保存事件明细与 run 分析宽表，负责指标计算。
- 主关联键：`runId`，明细幂等键：`runId + eventId`，顺序键：`runId + sequence`。

### 1.3 OpenCode 同步设计（A 方案）

1. run 进入终态后，Agents 触发 `POST /engineering-intelligence/opencode/runs/sync`。
2. EI 先落库事件明细，再计算 run 级分析结果。
3. 成功后回写 Agents `sync.state=synced`；失败标记 `sync.state=failed` 并进入重试补偿。
4. 支持幂等重放与指标重算，不依赖一次性同步成功。

关键字段（同步请求必填）：

- `syncBatchId`
- `run`（含 `runId/agentId/roleCode/status/startedAt/completedAt`）
- `events[]`（含 `eventId/sequence/eventType/timestamp/payloadDigest`）
- `envId/nodeId`（多环境归因）

### 1.4 分析模型

- `ei_opencode_run_analytics`：run 级宽表（成本、效率、质量、惊喜度、同步元数据）。
- `ei_opencode_event_facts`：事件明细表（事件序列、步骤与工具关联、脱敏摘要）。
- `ei_opencode_run_sync_batches`：同步批次审计表（`runId + syncBatchId` 幂等批次）。

### 1.5 Ingest 与验签骨架

- Ingest 接口：`POST /engineering-intelligence/opencode/ingest/events`。
- 支持单批次 payload 或 `{ batches: [...] }` 批量模式。
- 验签头：`x-ei-node-signature`、`x-ei-node-timestamp`。
- 验签策略（骨架）：可通过环境变量开启强校验，默认允许非强制旁路模式。

### 1.6 状态与约束

- 同步顺序必须按 `sequence` 连续升序；存在缺口时拒收并返回可重试错误。
- 同一批次重复写入按幂等成功处理，不重复计算。
- 边缘节点禁止直连中心分析核心库，只允许通过 Ingest/API 写入。

### 1.7 研发会话项目同步（本轮）

- 研发会话页面改为先选择研发 Agent，再触发 OpenCode projects 同步。
- 项目记录集合统一为 `ei_projects`（复用原 `rdproject` 结构并扩展同步字段）。
- `ei_projects` 仅允许通过同步链路创建（`POST /rd-management/agents/:agentId/opencode/projects/sync`），不允许前端手工创建。
- 同步按 `agentId + opencodeProjectPath / opencodeProjectId` 幂等更新，返回 `created/updated/skipped` 统计。
- `ei_projects` 新增三类项目来源：`local`（本地项目）、`opencode`（OpenCode 项目）、`github`（GitHub 仓库）。
- 绑定关系约束：一个 `local` 项目可绑定多个 `opencode` 项目，但最多绑定一个 `github` 仓库。
- GitHub 凭据不落库明文，改为引用 API Key（`githubApiKeyId`）。
- RD 管理 OpenCode 集成侧已移除 SDK，项目/会话/事件查询统一通过 OpenCode HTTP API 直连。
- RD 管理页恢复“新建 Session”能力：创建时优先对齐所选 Agent 绑定模型（`providerID/modelID`）并透传到 OpenCode session。
- RD 管理发送前会进行 OpenCode 模型能力校验；若目标模型未配置，接口返回明确错误（不自动改写 OpenCode 全局配置）。
- RD 管理 events 面板按当前选中 `sessionId` 过滤，保障会话视角下事件信息同步一致。

### 1.8 工程统计（本轮新增）

- 前端在 `研发智能` 分组下新增二级菜单 `工程统计`。
- 页面支持一键触发统计计划执行：覆盖 `docs`、`frontend`、`backend` 维度。
- `backend` 维度细化为 `backend/src` + `backend/apps/<app>` 各子应用独立统计行。
- 统计结果按“项目明细 + 汇总”返回，并落库到 `ei_project_statistics_snapshots`。
- 快照状态机：`running/success/failed`，支持查询 latest/detail/history。
- 统计能力对外暴露为 Agent MCP 工具：`builtin.sys-mg.mcp.rd-intelligence.engineering-statistics-run`。
- 前端 `工程统计` 页面采用“历史列表主视图 + 详情抽屉”交互，支持按状态筛选、分页浏览历史快照，并查看指定快照的汇总/项目明细/异常信息。

### 1.9 研发需求管理（本轮新增）

- 前端在 `研发智能` 分组下新增二级菜单 `需求管理` 与 `智能研发看板`。
- 新增需求领域模型 `ei_requirements`，承接 Agent 与人类讨论后的需求条目。
- 需求状态机：`todo -> assigned -> in_progress -> review -> done`，并支持 `blocked`。
- 支持需求讨论追加、CTO/负责人分发到研发 Agent、状态流转记录与审计轨迹。
- 看板接口按状态泳道聚合需求，前端定时刷新以实现近实时状态感知。
- 支持一键同步到 GitHub Issues，回写 `owner/repo/issueNumber/issueUrl/state/syncedAt` 映射信息。
- 系统默认创建定时计划 `system-engineering-statistics`，按钮触发本质为触发该计划一次执行。
- 计划执行完成后通过消息中心 Hook 发送提醒，前端可在消息中心查看并跳转快照。
- 统计快照创建接口支持可选 `receiverId`，用于在统计完成/失败后触发 legacy 消息中心通知落库。
- 通过系统调度触发时，`receiverId` 会默认回填为当前登录用户，保障前端按钮触发后可收到消息中心通知。
- 前端 `工程统计` 页面按钮触发时会显式透传当前登录用户 `receiverId`，避免跨服务链路中上下文丢失导致通知静默。

### 1.9 消息中心联动（本轮新增）

- 消息中心能力归属 legacy 主 backend（`backend/src/modules/message-center`），不落在 EI 独立服务中。
- EI 仅负责在统计完成后通过 Hook 调用 legacy：`POST /api/message-center/hooks/engineering-statistics`。
- 前端消息入口位于主站 Header 右上角，支持最近消息抽屉与完整消息中心页。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/OPENCODE_SERVE_INTERACTION_MASTER_PLAN.md` | OpenCode 执行到分析的总体规划 |
| `plan/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发会话页 EI 项目同步改造计划 |
| `plan/OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连改造计划 |
| `plan/ENGINEERING_INTELLIGENCE_REQUIREMENT_MANAGEMENT_PLAN.md` | 研发智能需求管理（Issue 协作）计划 |

### 技术文档 (docs/technical/)

| 文件 | 说明 |
|------|------|
| `technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md` | 数据分层、同步契约、补偿策略 |
| `technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md` | 多环境同步、节点治理与冲突处理 |

### 开发讨论文档 (docs/development/)

| 文件 | 说明 |
|------|------|
| `development/OPENCODE_RD_WORKFLOW_DISCUSSION_TOPICS.md` | 研发流程议题与待决策项 |
| `development/OPENCODE_TODO_ROUND1_EXECUTION_PLAN.md` | OpenCode Round1 EI 同步与分析实现总结 |
| `development/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发会话页 EI 项目同步实现与排障总结 |
| `development/OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连实现总结 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/engineering-intelligence-api.md` | EI 现有接口与后续 OpenCode 扩展入口 |

---

## 3. 相关代码文件

### 后端服务（规划影响）

| 路径 | 功能 |
|------|------|
| `backend/apps/engineering-intelligence/src/` | EI 服务主模块（同步接收、分析计算、查询接口） |
| `backend/apps/agents/src/modules/runtime/` | Runtime 事件事实来源与同步触发链路 |
| `backend/apps/agents/src/modules/tools/` | 工程统计 MCP 工具定义与执行入口 |
| `backend/src/modules/rd-management/` | 研发会话页 OpenCode 项目同步与 EI 项目列表接口 |
| `backend/src/shared/schemas/rd-project.schema.ts` | `ei_projects` 集合模型（同步来源、OpenCode 项目标识） |

### 前端入口（规划影响）

| 路径 | 功能 |
|------|------|
| `frontend/src/pages/` | 主前端中的工程智能页面与分析展示入口 |
