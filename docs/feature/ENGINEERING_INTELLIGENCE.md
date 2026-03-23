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
- `ei_projects` 仅允许通过同步链路创建（`POST /ei/agents/:agentId/opencode/projects/sync`），不允许前端手工创建。
- 同步按 `agentId + opencodeProjectPath / opencodeProjectId` 幂等更新，返回 `created/updated/skipped` 统计。
- Agent 项目同步支持按 Agent config 透传 OpenCode 连接策略：优先使用 `execution.endpoint`，其次 `execution.endpointRef`，最终回退服务端 `OPENCODE_SERVER_URL`。
- Agent 项目同步新增 `auth_enable` 语义：仅当 `auth_enable=true` 时服务端才读取 `OPENCODE_SERVER_PASSWORD` 并携带 Basic Auth；否则不携带用户名/密码。
- `ei_projects` 新增三类项目来源：`local`（本地项目）、`opencode`（OpenCode 项目）、`github`（GitHub 仓库）。
- 绑定关系约束：一个 `local` 项目可绑定多个 `opencode` 项目，但最多绑定一个 `github` 仓库。
- GitHub 凭据不落库明文，改为引用 API Key（`githubApiKeyId`）。
- RD 管理 OpenCode 集成侧已移除 SDK，项目/会话/事件查询统一通过 OpenCode HTTP API 直连。
- RD 管理页恢复“新建 Session”能力：创建时优先对齐所选 Agent 绑定模型（`providerID/modelID`）并透传到 OpenCode session。
- RD 管理发送前会进行 OpenCode 模型能力校验；若目标模型未配置，接口返回明确错误（不自动改写 OpenCode 全局配置）。
- RD 管理 events 面板按当前选中 `sessionId` 过滤，保障会话视角下事件信息同步一致。
- `研发智能` 首页已重建为 `项目管理`：默认聚焦三类项目（local/opencode/github）与绑定关系管理。
- 研发智能前端主路由已从 `/engineering-intelligence` 统一迁移到 `/ei`（旧路由保留兼容重定向）。
- 首页移除文档树、提交历史、文档详情抽屉能力；文档相关能力不再作为该入口主流程。
- 绑定交互遵循前置约束：必须先创建并选中 local 项目，才可绑定 opencode/github。
- 项目管理页支持解绑能力：可对已绑定的 opencode/github 关系执行解绑。
- OpenCode 绑定支持冲突提示：当目标项目已绑定其他 local 项目时，前端二次确认后改绑。
- 本地项目列表支持搜索与分页，便于多项目管理。
- 项目管理页交互已按前端规范重构：列表优先、创建弹窗化、详情抽屉化（抽屉内 Tab 管理绑定能力）。
- GitHub 绑定增强：支持从仓库 URL 自动解析 `owner/repo`（HTTPS/SSH），并在 URL 非法时提供前端校验提示。
- GitHub API Key 选择增强：前端按“GitHub-like provider”筛选可用 key，兼容历史 provider 命名差异。
- 项目管理页绑定反馈增强：统一成功/失败提示区，绑定/解绑/同步过程显示 loading 文案。
- 绑定概览修复：OpenCode 绑定列表改为按 `bindingLocalProjectId` 查询，确保与绑定页状态一致。
- 抽屉内补齐 loading/empty/error 统一样式，提升状态可感知性。
- 操作反馈升级为全局 Toast：支持成功/失败提示、自动消失与手动关闭。
- Toast 能力已抽离为通用前端 Hook/组件（`useToast` + `Toast`），便于需求管理/工程统计等页面复用统一交互。
- `需求管理` 与 `工程统计` 页面已接入统一 Toast 反馈（成功/失败），减少原生弹窗提示并统一操作反馈体验。
- `需求管理` 页“同步 GitHub”交互已从原生 `window.prompt` 升级为规范化弹窗表单（owner/repo/labels）。
- 需求管理新增 EI 本地项目关联：创建需求可选择 `local` 项目，列表支持按项目筛选。
- 需求同步 GitHub 改为优先复用需求所属本地项目绑定仓库；若项目未绑定 GitHub，列表显示“未绑定 GitHub”并禁用同步按钮。
- 需求详情页新增删除能力：支持二次确认删除需求，成功后返回需求列表并刷新看板/列表缓存。

### 1.8 工程统计（本轮新增）

- 前端在 `研发智能` 分组下新增二级菜单 `工程统计`。
- 页面支持一键触发统计计划执行：覆盖 `docs`、`frontend`、`backend` 维度。
- `backend` 维度细化为 `backend/src` + `backend/apps/<app>` 各子应用独立统计行。
- 统计结果按“项目明细 + 汇总”返回，并落库到 `ei_project_statistics_snapshots`。
- 快照状态机：`running/success/failed`，支持查询 latest/detail/history。
- 统计能力对外暴露为 Agent MCP 工具：`builtin.sys-mg.mcp.rd-intelligence.engineering-statistics-run`。
- 前端 `工程统计` 页面采用“历史列表主视图 + 详情抽屉”交互，支持按状态筛选、分页浏览历史快照，并查看指定快照的汇总/项目明细/异常信息。
- “最近统计”卡片新增大文件告警条：前端基于 `latest.projects[].topLineFiles` 计算 `lines >= 1500` 的超限文件数，点击告警条弹出明细表（所属模块/文件路径/行数/字节数，按行数降序）。

### 1.9 研发需求管理（本轮新增）

- 前端在 `研发智能` 分组下新增二级菜单 `需求管理` 与 `智能研发看板`。
- 主站侧边栏一级分组支持折叠/展开，`研发智能` 分组可按需收起，仅在展开时展示二级菜单列表。
- 侧边栏菜单图标完成去重优化：`需求管理` 与 `智能研发看板` 使用独立图标，避免与 `工程统计` 图标重复。
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

### 1.10 CTO 日常研发闭环（本轮新增）

- Agents 侧新增 requirement MCP 工具集（list/get/create/update-status/assign/comment/sync-github/board），用于 CTO 治理链路直接操作 EI 需求。
- 编排任务支持 `requirementId` 关联；创建计划与重规划可透传来源需求。
- 编排运行链路在计划启动时回写需求 `in_progress`，计划完成后回写 `review -> done`（best-effort，不阻塞主链路）。
- 需求状态流转到 `done` 自动关闭关联 GitHub Issue；从 `done` 回退时自动 reopen（失败仅记录 `lastError`）。
- 开发类任务新增 `CODE_EXECUTION_PROOF` warning 校验，用于自动验收 build/test/lint 与代码变更证据。
- 系统内置定时计划新增 `system-cto-daily-requirement-triage`，每日 10:00 触发 CTO Agent 执行需求整理与研发分发。

### 1.11 文档热度统计（本轮新增）

#### 1.11.1 功能目标

通过扫描 `docs/` 目录下文档的 Git commit 记录，统计文档写入频率，计算文档热度排名，使 CTO 能在工程统计页面直观了解当前研发集中在哪个方向、哪些功能正在密集开发。

后续阶段将基于热度 TopN 自动预加载到 CTO Agent 记忆中，使其日常工作时无需每次读文件即可了解研发动态（本期不实现记忆预加载）。

#### 1.11.2 前端展示

- 在现有 `工程统计` 页面新增 Tab：`工程规模统计 | 文档热度`。
- 文档热度 Tab 内容：
  - 时间窗口切换：`8H / 1D / 7D`。
  - TopN 排行表格：`排名 / 文档路径 / 写入次数 / 写入频率 / 最近更新时间 / 热度分`。
  - Top 1-3 高亮标记。
  - "触发统计"按钮（走 Orchestration Schedule trigger）。
  - 上次统计时间 + 运行状态。
  - "权重配置"入口（齿轮图标），打开抽屉/弹窗管理目录权重、排除路径、默认 TopN。

#### 1.11.3 热度指标

- `writeCount`：窗口内文档被 commit 命中的次数。
- `writeFreq`：`writeCount / windowHours`。
- `lastWrittenAt`：窗口内最近一次 commit 时间。
- `heatScore`：`writeFreq * weight * recencyDecay`。
  - `recencyDecay = exp(-hoursSinceLastWrite / windowHours)`。
  - `weight` 由目录权重配置决定。

#### 1.11.4 目录权重（页面可配置）

默认权重：

| 目录 | 权重 | 说明 |
|------|------|------|
| `docs/features/**` | 1.5 | 功能文档，核心研发方向 |
| `docs/dailylog/**` | 1.2 | 每日进度，CTO 判断研发节奏 |
| `docs/plan/**` | 0.8 | 计划文档 |
| `docs/issue/**` | 1.0 | 修复记录 |
| `docs/**` | 1.0 | 其他文档（兜底） |

- 匹配规则：从上往下 glob 匹配，命中第一个即停止；未命中走 `defaultWeight`。
- 支持增删权重行、调整排除路径、修改默认 TopN。
- 配置变更即时生效（下次统计使用新配置）。

#### 1.11.5 数据存储

**Redis（主存储，在线查询路径）**

| Key | 内容 | TTL |
|-----|------|-----|
| `ei:docs-heat:v1:ranking:8h` | 8H 窗口 TopN JSON 数组 | 8 天 |
| `ei:docs-heat:v1:ranking:1d` | 1D 窗口 TopN JSON 数组 | 8 天 |
| `ei:docs-heat:v1:ranking:7d` | 7D 窗口 TopN JSON 数组 | 8 天 |
| `ei:docs-heat:v1:latest` | 最近运行状态（runId/status/startedAt/completedAt/error） | 不过期 |
| `ei:app-config:v1` | EI 通用配置缓存 | 不过期 |

**Mongo `ei_doc_commit_facts`（事实表，防 Redis 重启丢数据）**

```typescript
{
  commitSha: string,       // 索引
  docPath: string,         // 索引
  committedAt: Date,       // 索引（窗口查询）
  author: string,
  // 复合唯一索引: (commitSha, docPath)
}
```

- 每次 schedule 扫描 commit 后先写 facts 表（upsert by sha+path）。
- Redis 重启后从 facts 表按窗口聚合重算并回填 Redis。
- facts 表保留 30 天，超期由定时任务清理。

**Mongo `ei_app_configs`（通用配置持久化）**

```typescript
{
  configId: "default",
  docsHeat: {
    weights: [
      { pattern: "docs/features/**", weight: 1.5, label: "功能文档" },
      { pattern: "docs/dailylog/**", weight: 1.2, label: "每日进度" },
      { pattern: "docs/plan/**",     weight: 0.8, label: "计划文档" },
      { pattern: "docs/issue/**",    weight: 1.0, label: "修复记录" },
      { pattern: "docs/**",          weight: 1.0, label: "其他文档" },
    ],
    excludes: [],
    defaultWeight: 1.0,
    topN: 20,
    updatedAt: Date,
    updatedBy: string,
  },
  // 后续扩展其他 EI 配置段
  updatedAt: Date,
}
```

- 启动时加载顺序：Redis -> Mongo -> 代码内置默认值。
- PUT 操作同时写 Mongo + Redis。

#### 1.11.6 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ei/docs-heat/refresh` | 执行一次扫描+计算 |
| GET | `/ei/docs-heat/ranking` | 读 TopN（`?window=8h|1d|7d&topN=20`） |
| GET | `/ei/docs-heat/latest` | 最近运行状态 |
| GET | `/ei/config` | 读 EI 通用配置（`?section=docsHeat`） |
| PUT | `/ei/config/docs-heat` | 更新文档热度配置段 |

#### 1.11.7 扫描与计算流程

1. Schedule 触发 -> Agent Tool `docs-heat-run` -> EI API `POST /ei/docs-heat/refresh`。
2. EI 执行 `git log --since=7d --name-only --pretty=format:<sha>|<ts>|<author>`（按最大窗口一次扫描）。
3. 解析 commit，过滤 `docs/**/*.md` 文件。
4. 写入 Mongo `ei_doc_commit_facts`（upsert by sha+path）。
5. 从 facts 按 8H/1D/7D 三窗口聚合。
6. 读取 `ei_app_configs.docsHeat` 权重配置。
7. 计算 `heatScore`，排序取 TopN。
8. 写入 Redis ranking + latest。
9. 返回 summary。

**Redis 降级读取**：
```
GET ranking -> Redis 有值 -> 返回
           -> Redis 为空 -> 从 Mongo facts 聚合重算 -> 写回 Redis -> 返回
```

#### 1.11.8 Schedule 编排接入

- 新增 Agent MCP 工具：`builtin.sys-mg.mcp.rd-intelligence.docs-heat-run`。
- 新增系统 schedule：`system-docs-heat`（独立于现有 `system-engineering-statistics`）。
- 建议默认 cron：每 2 小时执行一次。
- 前端"触发统计"按钮调用：`POST /orchestration/schedules/system/docs-heat/trigger`。

#### 1.11.9 约束

- 不引入/透传 `organizationId`。
- 前端保留在主应用 `frontend/` 内，不新增独立前端工程。
- 本期不实现 LLM 摘要、不写入 CTO 记忆、不生成 Context Pack。

### 1.12 消息中心联动（本轮新增）

- 消息中心能力归属 legacy 主 backend（`backend/src/modules/message-center`），不落在 EI 独立服务中。
- EI 仅负责在统计完成后通过 Hook 调用 legacy：`POST /api/message-center/hooks/engineering-statistics`。
- 前端消息入口位于主站 Header 右上角，支持最近消息抽屉与完整消息中心页。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `plan/OPENCODE_SERVE_INTERACTION_MASTER_PLAN.md` | OpenCode 执行到分析的总体规划 |
| `plan/EI_BACKEND_MODULE_RELOCATION_REFACTOR_PLAN.md` | EI 模块迁移与资源化 API 重构计划 |
| `plan/EI_MODULES_FLATTEN_TO_SRC_PLAN.md` | EI controllers/services/dto 上移至 `src` 并统一去除 `ei-` 文件名前缀 |
| `plan/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发会话页 EI 项目同步改造计划 |
| `plan/OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连改造计划 |
| `plan/ENGINEERING_INTELLIGENCE_REQUIREMENT_MANAGEMENT_PLAN.md` | 研发智能需求管理（Issue 协作）计划 |
| `plan/CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO Agent 日常研发工作流改造计划 |
| `plan/CTO_DAILY_REQUIREMENT_TRIAGE_SCHEDULE_SEED_PLAN.md` | CTO 每日需求整理分发定时 seed 计划 |
| `plan/EI_DOCS_HEAT_PLAN.md` | 文档热度统计功能开发计划 |

### 技术文档 (docs/technical/)

| 文件 | 说明 |
|------|------|
| `technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md` | 数据分层、同步契约、补偿策略 |
| `technical/EI_API_RESOURCE_RESTRUCTURE_DESIGN.md` | EI 资源化接口与 Controller/Service 拆分设计 |
| `technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md` | 多环境同步、节点治理与冲突处理 |

### 开发讨论文档 (docs/development/)

| 文件 | 说明 |
|------|------|
| `development/OPENCODE_RD_WORKFLOW_DISCUSSION_TOPICS.md` | 研发流程议题与待决策项 |
| `development/OPENCODE_TODO_ROUND1_EXECUTION_PLAN.md` | OpenCode Round1 EI 同步与分析实现总结 |
| `development/RD_MANAGEMENT_EI_PROJECT_SYNC_PLAN.md` | 研发会话页 EI 项目同步实现与排障总结 |
| `development/OPENCODE_SDK_REMOVAL_API_DIRECT_CALL_PLAN.md` | OpenCode SDK 移除与 API 直连实现总结 |
| `development/CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO Agent 日常研发工作流改造开发沉淀 |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `api/engineering-intelligence-api.md` | EI 现有接口与后续 OpenCode 扩展入口 |

---

## 3. 相关代码文件

### 后端服务（规划影响）

| 路径 | 功能 |
|------|------|
| `backend/apps/ei/src/` | EI 服务主模块（同步接收、分析计算、查询接口） |
| `backend/apps/agents/src/modules/runtime/` | Runtime 事件事实来源与同步触发链路 |
| `backend/apps/agents/src/modules/tools/` | 工程统计 MCP 工具定义与执行入口 |
| `backend/src/modules/orchestration/` | 需求关联编排、回写与任务验证逻辑 |
| `backend/apps/ei/src/app.module.ts` | EI 应用装配入口（controllers/providers 直接在 AppModule 注册） |
| `backend/apps/ei/src/services/ei.service.ts` | EI 核心领域服务（聚合同步、统计、需求等核心逻辑） |
| `backend/apps/ei/src/controllers/` | EI 控制器目录（含 `tasks/projects/opencode/repositories/opencode-sync/statistics/requirements`） |
| `backend/apps/ei/src/services/` | EI 服务目录（含 `management` 核心服务与资源服务、OpenCode 客户端服务） |
| `backend/apps/ei/src/dto/` | EI DTO 目录（需求、统计、管理与聚合导出） |
| `backend/src/shared/schemas/ei-project.schema.ts` | `ei_projects` 集合模型（同步来源、OpenCode 项目标识） |

### 前端入口（规划影响）

| 路径 | 功能 |
|------|------|
| `frontend/src/pages/` | 主前端中的工程智能页面与分析展示入口 |
| `backend/apps/ei/src/schemas/ei-doc-commit-fact.schema.ts` | 文档 commit 事实表模型（docs-heat） |
| `backend/apps/ei/src/schemas/ei-app-config.schema.ts` | EI 通用配置表模型 |
| `backend/apps/ei/src/services/docs-heat.service.ts` | 文档热度统计核心服务 |
| `backend/apps/ei/src/controllers/docs-heat.controller.ts` | 文档热度 API 控制器 |
| `backend/apps/ei/src/controllers/config.controller.ts` | EI 通用配置 API 控制器 |
