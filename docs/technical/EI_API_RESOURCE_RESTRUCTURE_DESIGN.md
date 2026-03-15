# EI API Resource Restructure Technical Design

## 1. 设计目标

- 将 EI API 从“按页面/场景聚合”调整为“按资源域路由”。
- 在保持线上可用的前提下，逐步收敛旧兼容路径（主要是 `/ei/opencode/*`）。
- 文档与当前代码结构保持一致，避免目录与模块描述失真。

## 2. 当前实现快照（As-Is）

### 2.1 应用与项目标识

- Nest 项目 key：`ei`
- 应用目录：`backend/apps/ei`
- 应用入口：`backend/apps/ei/src/app.module.ts`
- API 前缀：`/api`（应用内资源前缀为 `/ei`）

### 2.2 代码目录结构（已落地）

当前 EI 后端已采用“顶层扁平目录 + 资源化 controller/service”结构，而非“每个资源独立 module 目录”：

```text
backend/apps/ei/src/
  app.module.ts
  main.ts
  controllers/
  services/
  dto/
  schemas/
```

说明：

- `controllers/`、`services/`、`dto/` 已从历史聚合目录上移到 `src/` 顶层。
- 原 `ei-*.ts` 命名已统一去前缀（如 `tasks.controller.ts`、`projects.service.ts`）。
- `EngineeringIntelligenceModule` 已合并进 `app.module.ts`，不再保留单独 feature module 文件。

## 3. 资源域划分（保持目标不变）

- `ingest`：边缘事件接入与验签。
- `sync-batches`：run 终态同步批次处理与审计。
- `runs`：run 分析结果与事件明细查询。
- `projects`：EI 项目与绑定关系管理。
- `requirements`：研发需求生命周期管理。
- `statistics`：工程统计快照执行与查询。
- `metrics`：聚合看板指标。

## 4. 路由设计与当前状态

统一业务前缀：`/ei`（完整访问路径为 `/api/ei/*`）。

### 4.1 已落地主路径（Active）

- `POST /ei/ingest/events`
- `POST /ei/sync-batches`
- `POST /ei/statistics/snapshots`
- `GET /ei/statistics/snapshots`
- `GET /ei/statistics/snapshots/latest`
- `GET /ei/statistics/snapshots/:snapshotId`
- `POST /ei/requirements`
- `GET /ei/requirements`
- `GET /ei/requirements/board`
- `GET /ei/requirements/:requirementId`
- `DELETE /ei/requirements/:requirementId`
- `POST /ei/requirements/:requirementId/comments`
- `POST /ei/requirements/:requirementId/assign`
- `PATCH /ei/requirements/:requirementId/status`
- `POST /ei/requirements/:requirementId/status`（兼容保留）
- `POST /ei/requirements/:requirementId/github/sync`
- `POST /ei/projects`
- `POST /ei/projects/local`
- `GET /ei/projects`
- `GET /ei/projects/:id`
- `PUT /ei/projects/:id`
- `DELETE /ei/projects/:id`
- `POST /ei/projects/bind/opencode`
- `POST /ei/projects/bind/github`
- `POST /ei/projects/:id/unbind/opencode`
- `POST /ei/projects/:id/unbind/github`
- `POST /ei/projects/:id/opencode/sync-current`
- `POST /ei/repositories`
- `GET /ei/repositories`
- `PUT /ei/repositories/:id`
- `DELETE /ei/repositories/:id`
- `POST /ei/repositories/:id/summarize`
- `GET /ei/repositories/:id/docs/tree`
- `GET /ei/repositories/:id/docs/content`
- `GET /ei/repositories/:id/docs/history`
- `POST /ei/tasks`
- `GET /ei/tasks`
- `GET /ei/tasks/:id`
- `PUT /ei/tasks/:id`
- `DELETE /ei/tasks/:id`
- `POST /ei/tasks/:id/complete`

### 4.2 兼容路径（Deprecated-Compatible）

以下路径仍保留以保障调用方平滑迁移，后续按窗口下线：

- `POST /ei/opencode/runs/sync`（等价于 `POST /ei/sync-batches`）
- `POST /ei/opencode/ingest/events`（等价于 `POST /ei/ingest/events`）
- `GET /ei/opencode/current`
- `GET /ei/opencode/projects`
- `POST /ei/opencode/projects/import`
- `POST /ei/agents/:agentId/opencode/projects/sync`
- `GET /ei/opencode/sessions`
- `GET /ei/opencode/sessions/:id`
- `GET /ei/opencode/sessions/:id/messages`
- `POST /ei/opencode/sessions`
- `POST /ei/opencode/sessions/:id/prompt`
- `GET /ei/opencode/events`
- `POST /ei/tasks/:id/opencode/prompt`
- `POST /ei/tasks/:id/opencode/session`
- `GET /ei/tasks/:id/opencode/history`
- `POST /ei/tasks/:id/opencode/sync-current`

## 5. 错误语义

统一错误结构：

```json
{
  "code": "EI_SYNC_SEQUENCE_GAP",
  "message": "events sequence is not continuous",
  "details": {
    "runId": "run_xxx",
    "expected": 12,
    "actual": 14
  },
  "requestId": "req_xxx"
}
```

建议错误码：

- `EI_UNAUTHORIZED_NODE_SIGNATURE`
- `EI_SYNC_SEQUENCE_GAP`
- `EI_SYNC_BATCH_DUPLICATED`
- `EI_RUN_NOT_FOUND`
- `EI_PROJECT_BINDING_CONFLICT`
- `EI_REQUIREMENT_INVALID_STATUS_TRANSITION`
- `EI_STATISTICS_SNAPSHOT_NOT_FOUND`

## 6. 旧新接口映射（当前生效）

| 兼容接口 | 主路径接口 | 当前策略 |
|------|------|------|
| `POST /ei/opencode/runs/sync` | `POST /ei/sync-batches` | 并行保留，优先使用主路径 |
| `POST /ei/opencode/ingest/events` | `POST /ei/ingest/events` | 并行保留，优先使用主路径 |
| `POST /ei/requirements/:id/status` | `PATCH /ei/requirements/:id/status` | 兼容保留，调用方逐步切换 |

## 7. 迁移状态与后续动作

### 7.1 已完成

- EI 应用目录从 `apps/engineering-intelligence` 收敛为 `apps/ei`。
- `controllers/services/dto` 已上移至 `src` 顶层。
- 文件命名已去除 `ei-` 前缀。
- `EngineeringIntelligenceModule` 已并入 `app.module.ts`。

### 7.2 待推进

- 逐步下线 `/ei/opencode/*` 兼容路径（先完成所有调用方切换）。
- 在 API 文档中增加每条兼容接口的下线窗口与版本标注。

## 8. 安全与约束

- 禁止新增、恢复或透传 `organizationId`。
- GitHub 凭据仅通过 `githubApiKeyId` 引用，不落库明文。
- ingest/sync 写路径保留幂等语义与顺序校验。

## 9. 前端路由迁移

- 前端主入口路由为 `/ei`。
- 旧路由 `/engineering-intelligence` 保留兼容跳转，避免历史深链失效。
- 菜单与消息中心跳转统一收敛到 `/ei`。
