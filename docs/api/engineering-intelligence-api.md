# Engineering Intelligence API

## 基础信息

- 服务地址（直连）：`http://localhost:3004/api`
- 经 Gateway 访问：`http://localhost:3100/api/engineering-intelligence`
- 服务职责：仓库配置管理、docs 目录浏览、文档摘要与历史追踪

## Repositories（`/engineering-intelligence/repositories`）

- `GET /repositories`：获取仓库配置列表
- `POST /repositories`：新增仓库配置（支持 branch）
- `PUT /repositories/:id`：更新仓库配置
- `DELETE /repositories/:id`：删除仓库配置

## 文档处理

- `POST /repositories/:id/summarize`：触发文档摘要
- `GET /repositories/:id/docs/tree`：获取 docs 目录树
- `GET /repositories/:id/docs/content?path=docs/...`：获取文档正文
- `GET /repositories/:id/docs/history?path=docs/...&limit=20`：获取文档更新记录与贡献统计

## OpenCode 同步与分析（已实现第一阶段）

- `POST /engineering-intelligence/opencode/runs/sync`
  - 作用：接收 Agents 终态 run 的事件明细同步（A 方案）。
  - 幂等键：`runId + syncBatchId`。
  - 顺序约束：`events[].sequence` 必须连续升序。
  - 多环境字段：`envId`、`nodeId` 必填，且需满足节点标识格式约束。

- `POST /engineering-intelligence/opencode/ingest/events`
  - 作用：边缘节点（local/ecds）批量上报事件明细到中心。
  - 校验要点：节点验签、幂等去重、顺序校验、脱敏校验。
  - 验签骨架请求头：`x-ei-node-signature`、`x-ei-node-timestamp`。
  - 支持单批次 payload 或 `{ batches: [...] }` 批量模式。

落库集合（当前实现）：

- `ei_opencode_run_sync_batches`
- `ei_opencode_event_facts`
- `ei_opencode_run_analytics`

- `GET /engineering-intelligence/opencode/runs/:runId/analysis`
  - 作用：查询单 run 成本/效率/质量/惊喜度分析视图。

- `GET /engineering-intelligence/opencode/metrics/overview`
  - 作用：查询聚合指标看板。

- `POST /engineering-intelligence/opencode/runs/:runId/recompute-metrics`
  - 作用：按 run 重算指标，支持口径演进后的回放计算。

## 工程统计（新增）

- `POST /engineering-intelligence/statistics/snapshots`
  - 作用：由统计计划或工具触发一次工程统计并创建快照。
  - 请求体：`scope(all/docs/frontend/backend)`、`tokenMode(estimate/exact)`、`projectIds[]`、`triggeredBy`、`receiverId`（可选，传入后将通过 legacy message-center 写入通知）。

- `GET /engineering-intelligence/statistics/snapshots/latest`
  - 作用：获取最近一次统计快照。

- `GET /engineering-intelligence/statistics/snapshots/:snapshotId`
  - 作用：获取指定快照详情（项目明细 + 汇总 + 错误列表）。

- `GET /engineering-intelligence/statistics/snapshots?limit=20`
  - 作用：分页获取统计历史（按时间倒序）。

## 编排调度入口（按钮触发）

- `GET /orchestration/schedules/system/engineering-statistics`
  - 作用：获取（或确保存在）系统默认工程统计计划。

- `POST /orchestration/schedules/system/engineering-statistics/trigger`
  - 作用：触发系统工程统计计划执行一次。
  - 请求体：`receiverId`、`scope`、`tokenMode`、`projectIds[]`、`triggeredBy`。

落库集合（新增）：

- `ei_project_statistics_snapshots`

## 研发需求管理（新增）

- `POST /engineering-intelligence/requirements`
  - 作用：创建需求条目，初始状态为 `todo`。
  - 请求体：`title`、`description?`、`priority?`、`labels?`、`createdBy*?`。

- `GET /engineering-intelligence/requirements`
  - 作用：需求列表查询。
  - 查询参数：`status?`、`assigneeAgentId?`、`search?`、`limit?`。

- `GET /engineering-intelligence/requirements/:requirementId`
  - 作用：获取需求详情（讨论、分发、状态轨迹、GitHub 映射）。

- `POST /engineering-intelligence/requirements/:requirementId/comments`
  - 作用：追加讨论消息。
  - 请求体：`content`、`authorId?`、`authorName?`、`authorType?`。

- `POST /engineering-intelligence/requirements/:requirementId/assign`
  - 作用：将需求分发给研发 Agent，并将状态推进到 `assigned`。
  - 请求体：`toAgentId`、`toAgentName?`、`assignedBy*?`、`reason?`。

- `POST /engineering-intelligence/requirements/:requirementId/status`
  - 作用：更新需求状态并记录状态轨迹。
  - 请求体：`status(todo/assigned/in_progress/review/done/blocked)`、`changedBy*?`、`note?`。

- `GET /engineering-intelligence/requirements/board`
  - 作用：按状态泳道返回看板数据。

- `POST /engineering-intelligence/requirements/:requirementId/github/sync`
  - 作用：一键创建 GitHub Issue 并回写映射关系。
  - 请求体：`owner`、`repo`、`labels?`、`metadata?`。

落库集合（新增）：

- `ei_requirements`

## 说明

- 历史兼容路径 `/api/cto-docs/*` 已移除。
- 前端入口位于主前端应用：`/engineering-intelligence`。
