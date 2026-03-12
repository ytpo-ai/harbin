# Engineering Intelligence API

## 基础信息

- 服务地址（直连）：`http://localhost:3201/api`
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

## 说明

- 历史兼容路径 `/api/cto-docs/*` 已移除。
- 前端入口位于主前端应用：`/engineering-intelligence`。
