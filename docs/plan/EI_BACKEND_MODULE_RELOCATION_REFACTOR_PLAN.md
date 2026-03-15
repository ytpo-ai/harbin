# EI Backend Module Relocation and API Restructure Plan

## 1. 背景与目标

- 当前 `backend/src/modules` 中仍有工程智能（EI）相关实现，职责与 `apps/engineering-intelligence` 边界不清晰。
- 现有 Controller/Service 存在按功能堆叠的问题，不利于后续扩展与维护。
- 本次目标是完成两件事：
  - EI 后端代码从 legacy backend 迁移到 `apps/engineering-intelligence`。
  - API 与文件结构按数据资源重构，形成清晰、稳定的接口体系。

## 2. 范围定义

### 2.1 包含范围

- `backend/src/modules` 下 EI 相关模块、子模块、DTO、Schema 引用、测试用例。
- `backend/apps/engineering-intelligence/src` 内的 module/controller/service 重组。
- EI 对外 API 设计调整（资源化拆分、状态码与错误语义统一）。
- 前端 EI 页面路由从 `/engineering-intelligence` 调整为 `/ei`（含兼容跳转策略）。
- API 文档与技术方案文档更新。

### 2.2 不包含范围

- 主前端工程拆分或迁移（保持在 `frontend/`）。
- 非 EI 业务模块重构。
- `organizationId` 恢复或透传（严格禁止）。

## 3. 新结构设计原则

- 资源优先：按资源拆分 Controller/Service，而不是按页面或调用方拆分。
- 单一职责：每个 Controller 文件只负责一个资源域。
- 明确边界：EI 业务实现归属 `apps/engineering-intelligence`，legacy backend 仅保留必要兼容入口或 Hook。
- 幂等与可重放：同步、ingest、统计等写路径必须保留幂等键与重试语义。

## 4. 执行步骤

1. 盘点 EI 代码与接口现状，形成迁移清单（文件、依赖、路由、调用方）。
2. 在 EI app 内按资源创建目录与模块装配，准备迁移容器。
3. 迁移 EI 代码并修正依赖注入与共享模型引用。
4. 按资源拆分 Controller/Service，淘汰大文件聚合实现。
5. 调整 API 路由与 DTO，完成旧接口映射和兼容策略。
6. 联调与质量校验（lint/typecheck/test），再进行文档与日志收敛。

## 5. 新 API 设计（目标结构）

说明：以下为本次重构目标接口，落地前后会在 API 文档中标注状态（planned/active/deprecated）。

### 5.1 Ingest 与同步批次

- `POST /ei/ingest/events`
  - 用途：接收单批次或多批次事件上报。
  - 特性：验签、顺序校验、幂等去重。
- `POST /ei/sync-batches`
  - 用途：创建或重放一个同步批次（run 终态同步入口）。
- `GET /ei/sync-batches/:batchId`
  - 用途：查询批次处理状态与错误信息。

### 5.2 Runs 与事件明细

- `GET /ei/runs`
  - 用途：分页查询 run 列表（支持 agentId/status/time range 等筛选）。
- `GET /ei/runs/:runId`
  - 用途：查询 run 分析详情（成本/效率/质量/惊喜度）。
- `GET /ei/runs/:runId/events`
  - 用途：查询 run 对应事件事实明细。
- `POST /ei/runs/:runId/recompute-metrics`
  - 用途：重算单 run 指标。
- `GET /ei/metrics/overview`
  - 用途：查询聚合指标总览。

### 5.3 Projects 资源

- `GET /ei/projects`
  - 用途：查询 local/opencode/github 项目与绑定关系。
- `POST /ei/projects/opencode/sync`
  - 用途：同步 OpenCode 项目并返回 `created/updated/skipped`。
- `POST /ei/projects/:projectId/bindings/opencode`
  - 用途：绑定 OpenCode 项目。
- `DELETE /ei/projects/:projectId/bindings/opencode/:bindingId`
  - 用途：解绑 OpenCode 项目。
- `POST /ei/projects/:projectId/bindings/github`
  - 用途：绑定 GitHub 仓库（使用 `githubApiKeyId` 引用凭据）。
- `DELETE /ei/projects/:projectId/bindings/github/:bindingId`
  - 用途：解绑 GitHub 仓库。

### 5.4 Requirements 资源

- `POST /ei/requirements`
- `GET /ei/requirements`
- `GET /ei/requirements/:requirementId`
- `PATCH /ei/requirements/:requirementId/status`
- `POST /ei/requirements/:requirementId/assign`
- `POST /ei/requirements/:requirementId/comments`
- `POST /ei/requirements/:requirementId/github/sync`
- `GET /ei/requirements/board`

### 5.5 Statistics 资源

- `POST /ei/statistics/snapshots`
- `GET /ei/statistics/snapshots`
- `GET /ei/statistics/snapshots/latest`
- `GET /ei/statistics/snapshots/:snapshotId`

## 6. Controller/Service 拆分方案

建议目录（示例）：

- `apps/engineering-intelligence/src/modules/ingest/controllers/ingest-events.controller.ts`
- `apps/engineering-intelligence/src/modules/sync-batches/controllers/sync-batches.controller.ts`
- `apps/engineering-intelligence/src/modules/runs/controllers/runs.controller.ts`
- `apps/engineering-intelligence/src/modules/runs/controllers/run-events.controller.ts`
- `apps/engineering-intelligence/src/modules/projects/controllers/projects.controller.ts`
- `apps/engineering-intelligence/src/modules/project-bindings/controllers/project-opencode-bindings.controller.ts`
- `apps/engineering-intelligence/src/modules/project-bindings/controllers/project-github-bindings.controller.ts`
- `apps/engineering-intelligence/src/modules/requirements/controllers/requirements.controller.ts`
- `apps/engineering-intelligence/src/modules/requirements/controllers/requirement-status.controller.ts`
- `apps/engineering-intelligence/src/modules/statistics/controllers/statistics-snapshots.controller.ts`

Service 对应按资源同名拆分，不再保留“全量 EI 业务”聚合 Service。

## 7. 兼容策略与迁移节奏

- 第 1 阶段：新资源接口在 EI app 中就位，旧接口增加 deprecation 标记。
- 第 2 阶段：调用方迁移（frontend/agents/orchestration）到新接口。
- 第 3 阶段：移除 legacy backend 中 EI 业务实现，仅保留必要转发或 Hook。
- 第 4 阶段：下线旧接口（需要发布公告与变更窗口）。

## 8. 风险与应对

- Nest DI 失配风险：通过模块导出清单与集成测试提前发现。
- 循环依赖风险：资源间通过 facade/token 解耦，避免 service 互相直引。
- 接口切换风险：双轨兼容 + 映射表 + 分阶段迁移。

## 9. 验收标准

- EI 业务代码从 `backend/src/modules` 迁移到 `apps/engineering-intelligence`。
- Controller/Service 按资源拆分完成，无单文件聚合实现。
- API 文档完成新结构定义，并附带旧到新映射。
- lint/typecheck/test 通过，调用链路可用。

## 10. 会话补充方案：Modules Flatten to `src`

> 说明：本节用于沉淀本次会话中对原“按资源 module 目录拆分”方案的调整决策。

### 10.1 背景

- 当前 `backend/apps/ei/src/modules/engineering-intelligence` 仍使用聚合式 `controllers/services/dto` 布局，且存在 `ei-` 文件名前缀。
- 本轮决策不再继续按资源建立独立 module 目录。
- 目标调整为：将 `controllers/services/dto` 上移到应用级 `src`，并统一移除 `ei-` 文件名前缀。

### 10.2 执行步骤

1. 将 `modules/engineering-intelligence/` 下 `controllers/`、`services/`、`dto/` 上移到 `src/`。
2. 批量重命名 `ei-*.ts` 为无前缀文件名。
3. 修正所有受影响的 import 路径与符号引用。
4. 保持/调整模块装配，确保 Nest 依赖注入与路由注册正常。
5. 运行类型与构建校验，修复迁移引入问题。

### 10.3 影响范围

- 后端目录结构与 import graph
- NestJS controllers/providers 注册路径
- DTO 导出与引用路径
- build/typecheck/lint 校验链路

### 10.4 风险

- 批量重命名后遗漏路径修正会导致编译失败。
- 去前缀时可能出现同名文件冲突。
- 相对路径层级变化可能导致模块引用失效。
