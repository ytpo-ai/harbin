# Engineering Intelligence API

## 基础信息

- 服务地址（直连）：`http://localhost:3004/api`
- 经 Gateway 访问：`http://localhost:3100/api/ei`
- 说明：本文档已更新为“资源化 API 结构”目标设计，用于 EI 后端模块迁移与接口重构。

## 状态约定

- `active`：当前已使用或计划作为主路径。
- `compat`：兼容路径，短期保留用于平滑迁移。
- `deprecated`：已标记弃用，待下线。

## 资源化接口清单

### 1) Ingest（事件接入）

- `POST /ei/ingest/events` (`active`)
  - 作用：接收单批次或多批次事件上报。
  - 请求头：`x-ei-node-signature`、`x-ei-node-timestamp`。
  - 请求体：支持 `{ syncBatchId, run, events, envId, nodeId }` 或 `{ batches: [...] }`。

### 2) Sync Batches（同步批次）

- `POST /ei/sync-batches` (`active`)
  - 作用：创建/重放 run 同步批次。
- `GET /ei/sync-batches/:batchId` (`active`)
  - 作用：查询批次状态与错误信息。

### 3) Runs（run 分析）

- `GET /ei/runs` (`active`)
  - 作用：分页查询 run 列表。
- `GET /ei/runs/:runId` (`active`)
  - 作用：查询单 run 分析详情。
- `GET /ei/runs/:runId/events` (`active`)
  - 作用：查询单 run 事件明细。
- `POST /ei/runs/:runId/recompute-metrics` (`active`)
  - 作用：按 run 重算指标。

### 4) Metrics（聚合指标）

- `GET /ei/metrics/overview` (`active`)
  - 作用：查询聚合指标看板。

### 5) Projects（项目与绑定）

- `GET /ei/projects` (`active`)
- `POST /ei/projects/opencode/sync` (`active`)
- `POST /ei/projects/:projectId/bindings/opencode` (`active`)
- `DELETE /ei/projects/:projectId/bindings/opencode/:bindingId` (`active`)
- `POST /ei/projects/:projectId/bindings/github` (`active`)
- `DELETE /ei/projects/:projectId/bindings/github/:bindingId` (`active`)

说明：GitHub 绑定必须使用 `githubApiKeyId`，不落库明文凭据。

### 6) Requirements（研发需求）

- `POST /ei/requirements` (`active`)
- `GET /ei/requirements` (`active`)
- `GET /ei/requirements/:requirementId` (`active`)
- `PATCH /ei/requirements/:requirementId/status` (`active`)
- `POST /ei/requirements/:requirementId/assign` (`active`)
- `POST /ei/requirements/:requirementId/comments` (`active`)
- `POST /ei/requirements/:requirementId/github/sync` (`active`)
- `GET /ei/requirements/board` (`active`)

### 7) Statistics（工程统计）

- `POST /ei/statistics/snapshots` (`active`)
  - 请求体：`scope`、`tokenMode`、`projectIds[]`、`triggeredBy`、`receiverId?`。
- `GET /ei/statistics/snapshots` (`active`)
- `GET /ei/statistics/snapshots/latest` (`active`)
- `GET /ei/statistics/snapshots/:snapshotId` (`active`)

## 兼容路径映射

- `POST /ei/opencode/runs/sync` (`compat`) -> `POST /ei/sync-batches`
- `POST /ei/opencode/ingest/events` (`compat`) -> `POST /ei/ingest/events`
- `GET /ei/opencode/runs/:runId/analysis` (`compat`) -> `GET /ei/runs/:runId`
- `GET /ei/opencode/metrics/overview` (`compat`) -> `GET /ei/metrics/overview`
- `POST /ei/opencode/runs/:runId/recompute-metrics` (`compat`) -> `POST /ei/runs/:runId/recompute-metrics`

## 编排调度入口（保持不变）

- `GET /orchestration/schedules/system/engineering-statistics`
- `POST /orchestration/schedules/system/engineering-statistics/trigger`

## 落库集合

- `ei_opencode_run_sync_batches`
- `ei_opencode_event_facts`
- `ei_opencode_run_analytics`
- `ei_project_statistics_snapshots`
- `ei_requirements`
- `ei_projects`

## 约束

- 禁止新增/透传 `organizationId`。
- ingest/sync 必须保留幂等与顺序校验。
- 前端入口保持在主应用：`/ei`。
