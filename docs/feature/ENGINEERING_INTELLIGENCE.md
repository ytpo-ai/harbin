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

### 1.7 研发管理项目同步（本轮）

- 研发管理页面改为先选择研发 Agent，再触发 OpenCode projects 同步。
- 项目记录集合统一为 `ei_projects`（复用原 `rdproject` 结构并扩展同步字段）。
- `ei_projects` 仅允许通过同步链路创建（`POST /rd-management/agents/:agentId/opencode/projects/sync`），不允许前端手工创建。
- 同步按 `agentId + opencodeProjectPath / opencodeProjectId` 幂等更新，返回 `created/updated/skipped` 统计。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/OPENCODE_SERVE_INTERACTION_MASTER_PLAN.md` | OpenCode 执行到分析的总体规划 |
| `plan/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发管理页 EI 项目同步改造计划 |

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
| `development/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发管理页 EI 项目同步实现与排障总结 |

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
| `backend/src/modules/rd-management/` | 研发管理页 OpenCode 项目同步与 EI 项目列表接口 |
| `backend/src/shared/schemas/rd-project.schema.ts` | `ei_projects` 集合模型（同步来源、OpenCode 项目标识） |

### 前端入口（规划影响）

| 路径 | 功能 |
|------|------|
| `frontend/src/pages/` | 主前端中的工程智能页面与分析展示入口 |
