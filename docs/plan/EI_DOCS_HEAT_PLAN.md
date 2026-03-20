# EI 文档热度统计开发计划

## 1. 背景与目标

- 在 `工程统计` 页面新增 `文档热度` Tab，通过扫描 `docs/` 下文档的 Git commit 记录统计写入频率和热度排名。
- 使 CTO 能直观了解当前研发集中在哪个方向、哪些功能正在密集开发。
- 统计触发完全复用现有 Orchestration Schedule 机制，不引入新的执行框架。
- 运行态结果存 Redis（快），原始 commit 事实存 Mongo（防 Redis 重启丢数据）。
- 目录权重支持页面配置，配置存储复用通用 `ei_app_configs` 表（后续其他 EI 配置共用）。

## 2. 执行步骤

### 步骤 1：后端 - Mongo Schema 与基础服务

- 新建 `ei_doc_commit_facts` Schema（commitSha + docPath 复合唯一索引，committedAt 索引）。
- 新建 `ei_app_configs` Schema（configId 唯一索引，docsHeat 字段存储权重配置）。
- 在 `app.module.ts` 注册两个新 Schema。
- 实现 `EiAppConfigService`：
  - `getConfig()` / `getDocsHeatConfig()`：Redis -> Mongo -> 代码默认值的三级加载。
  - `updateDocsHeatConfig(dto)`：同时写 Mongo（`$set docsHeat`）+ Redis。

**影响**: 后端（EI） / 数据库

### 步骤 2：后端 - 文档热度核心服务

- 新建 `DocsHeatService`：
  - `refresh(dto)`：执行一次完整扫描+计算。
    1. 通过 GitHub API 或本地 git log 获取最近 7 天 commit（按最大窗口一次扫描）。
    2. 过滤 `docs/**/*.md` 文件。
    3. 写入 `ei_doc_commit_facts`（upsert by sha+path）。
    4. 从 facts 按 8H/1D/7D 三窗口聚合 writeCount。
    5. 读取权重配置，计算 heatScore。
    6. 写入 Redis ranking（三个 key）+ latest 状态。
  - `getRanking(window, topN)`：
    1. 读 Redis ranking。
    2. Redis 为空时从 Mongo facts 重算并回填。
  - `getLatest()`：读 Redis latest 运行状态。

**影响**: 后端（EI）

### 步骤 3：后端 - API 控制器

- 新建 `DocsHeatController`：
  - `POST /ei/docs-heat/refresh`
  - `GET /ei/docs-heat/ranking?window=8h|1d|7d&topN=20`
  - `GET /ei/docs-heat/latest`
- 新建 `EiConfigController`：
  - `GET /ei/config?section=docsHeat`
  - `PUT /ei/config/docs-heat`
- DTO 定义：`RefreshDocsHeatDto` / `DocsHeatRankingQueryDto` / `UpdateDocsHeatConfigDto`。

**影响**: 后端（EI） / API

### 步骤 4：后端 - Agent MCP 工具注册

- 在 `builtin-tool-catalog.ts` 新增工具定义：
  - `builtin.sys-mg.mcp.rd-intelligence.docs-heat-run`
  - 参数：`topN?` / `triggeredBy?`
- 在 `tool.service.ts` 的 `executeToolImplementation` 新增 case 分发。
- 在 `internal-api-client.service.ts` 新增 `postDocsHeatRefresh()` 方法。

**影响**: 后端（Agents）

### 步骤 5：后端 - 系统 Schedule 种子

- 在 `system-schedule-seed.ts` 新增 `system-docs-heat` schedule 种子：
  - cron：每 2 小时执行一次。
  - target：研发智能相关 Agent。
  - input.payload.toolId：`docs-heat-run`。
- 新增 schedule 系统端点：
  - `GET /orchestration/schedules/system/docs-heat`
  - `POST /orchestration/schedules/system/docs-heat/trigger`

**影响**: 后端（Orchestration） / 配置

### 步骤 6：前端 - 工程统计页 Tab 改造

- 在 `EngineeringStatistics.tsx` 增加 Tab 状态：`activeTab: 'projectStats' | 'docsHeat'`。
- `docsHeat` Tab 组件：
  - 时间窗口切换按钮组（8H / 1D / 7D）。
  - "触发统计"按钮（调 schedule trigger）。
  - 上次统计时间 + 状态指示。
  - TopN 排行表格（rank / path / writeCount / writeFreq / lastWrittenAt / heatScore）。
  - Top 1-3 行高亮样式。
- 新增前端 service 方法：
  - `getDocsHeatRanking(window, topN)`
  - `getDocsHeatLatest()`
  - `triggerDocsHeat()`
  - `getEiConfig(section?)`
  - `updateDocsHeatConfig(payload)`

**影响**: 前端

### 步骤 7：前端 - 权重配置交互

- "权重配置"齿轮按钮，点击打开抽屉/弹窗。
- 配置内容：
  - 权重列表：每行 `目录 pattern / 标签 / 权重滑块(0.1~3.0)`。
  - 支持增删行。
  - 排除路径输入。
  - 默认 TopN 数量。
  - 显示"上次修改时间 / 修改人"。
- 保存调 `PUT /ei/config/docs-heat`。

**影响**: 前端

### 步骤 8：文档更新与验证

- 更新 `docs/api/engineering-intelligence-api.md`（新增 5 个接口）。
- 更新 `docs/dailylog/` 当日日志。
- 验证：
  - 前端 Tab 切换、窗口切换、排行展示正常。
  - Schedule 触发后数据正确刷新。
  - Redis 清空后从 Mongo 重算恢复正常。
  - 权重配置变更后下次统计结果体现新权重。

**影响**: 文档

## 3. 关键影响点

| 层面 | 影响范围 |
|------|---------|
| 后端（EI） | 新增 2 个 Schema、2 个 Service、2 个 Controller、DTO |
| 后端（Agents） | 新增 1 个 MCP 工具定义 + 执行分发 + API client 方法 |
| 后端（Orchestration） | 新增 1 个系统 schedule 种子 + 系统端点 |
| 前端 | 工程统计页 Tab 改造 + 热度排行组件 + 权重配置抽屉 |
| 数据库 | 新增 `ei_doc_commit_facts` + `ei_app_configs` 两个集合 |
| Redis | 新增 4 个 key（3 ranking + 1 latest） |
| 文档 | feature / api / dailylog |

## 4. 风险与依赖

| 风险 | 应对 |
|------|------|
| Redis 重启丢失排行数据 | Mongo facts 表兜底，API 层自动检测并重算回填 |
| Git 仓库 commit 量大导致扫描慢 | 按最大窗口 7D 限制扫描范围；commit facts 幂等避免重复处理 |
| facts 表长期膨胀 | 保留 30 天，定时清理 |
| GitHub API rate limit | 优先使用本地 git log；GitHub 模式下做速率控制 |
| Schedule 并发执行 | 复用现有 scheduler 的 runLock 机制 |

## 5. 完成标准

- [ ] `工程统计` 页面可切换到 `文档热度` Tab 并展示 TopN 排行。
- [ ] 支持 8H / 1D / 7D 窗口切换，结果正确反映不同时间范围。
- [ ] "触发统计"按钮走 Schedule 链路触发，运行状态可查。
- [ ] 目录权重可在页面配置，配置变更在下次统计生效。
- [ ] Redis 清空后自动从 Mongo 重算恢复，不丢数据。
- [ ] MCP 工具可被 Agent 调用触发统计。
- [ ] 不引入/透传 `organizationId`。
- [ ] 相关文档（feature / api / dailylog）按规范更新。
