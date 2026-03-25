# 运维脚本工具化重构计划（Seed + Maintenance）

## 1. 需求理解

当前 `backend/scripts/` 下散落着 seed、migration、cleanup 三类脚本，缺乏统一组织：
- Seed 脚本已有 `manual-seed.ts` 统一入口，但与 migration/cleanup 混在同一目录
- 日常数据维护能力不足：仅有 `cleanup-agents-runtime-data.ts` 清理少量运行时数据
- 缺少 Redis 缓存全局审查与清理能力
- 缺少数据库备份与恢复工具

目标是将运维脚本分为两层：
1. **Seed 层**：系统首次启动时预置必要数据（已有，重组织目录）
2. **Maintenance 层**：日常数据维护（新建），覆盖运行时清理、Redis 清理、数据库备份/恢复

## 2. 目标目录结构

```
backend/scripts/
├── seed/                              # 第一层：初始化预置数据
│   ├── seed-runner.ts                 # 统一入口（从 manual-seed.ts 迁移）
│   ├── builtin-tool-seed.ts           # 内置工具 seed（从 ToolService 迁出）
│   ├── mcp-profile-seed.ts
│   ├── role-seed.ts
│   ├── system-schedule-seed.ts
│   └── seed-skill-planning-rules.ts
│
├── maintenance/                       # 第二层：日常数据维护
│   ├── maintenance-runner.ts          # 统一入口
│   ├── cleanup-runtime.ts             # 清理运行时数据（session/message/part/run/task/log 等）
│   ├── cleanup-redis.ts              # 审查并清理 Redis 缓存
│   ├── backup-db.ts                   # 备份 MongoDB 到文件
│   └── restore-db.ts                 # 从文件恢复 MongoDB
│
├── migrate/                           # 历史迁移脚本（归档，不再新增）
│   ├── migrate-role-tier.ts
│   ├── migrate-schema-collection-governance.ts
│   ├── migrate-inner-message-collections.ts
│   ├── migrate-agent-profile-permissions.ts
│   ├── migrate-skill-content-to-db.ts
│   └── backfill-tool-prompts.ts
│
└── shared/                            # 公共工具
    └── env-loader.ts                  # 环境变量加载 + MongoDB/Redis URL 构建
```

## 3. 执行步骤

### 步骤 1：抽取 `scripts/shared/env-loader.ts`

从 `cleanup-agents-runtime-data.ts` 和 `mcp-profile-seed.ts` 中抽取重复逻辑：
- `loadEnvFromFile(filePath)` — 读取 `.env` 文件并注入 `process.env`
- `bootstrapEnv()` — 按优先级加载 `.env` / `.env.development` / `.env.local`
- `getMongoUri()` — 读取 `MONGODB_URI` 并提供默认值
- `getRedisUrl()` — 从环境变量构建 Redis URL（支持 `REDIS_URL` 直传和 host/port 拼接）

### 步骤 2：创建 `scripts/seed/builtin-tool-seed.ts`（工具 seed 迁移）

将 `ToolService.seedBuiltinTools()` / `initializeBuiltinTools()` 的完整逻辑迁移到脚本层，脚本自包含所有依赖函数，与 ToolService 独立维护。

**迁移范围：**

| 来源（ToolService 私有方法） | 目标（脚本内独立实现） |
|------|------|
| `initializeBuiltinTools()` | 主编排函数 `seedBuiltinTools()` |
| `parseToolIdentity()` | 脚本内 `parseToolIdentity()` |
| `buildBuiltinToolMetadata()` | 脚本内 `buildBuiltinToolMetadata()` |
| `upsertToolkit()` | 脚本内 `upsertToolkit()` |
| `alignStoredToolMetadata()` | 脚本内 `alignStoredToolMetadata()` |
| `syncToolkitsFromTools()` | 脚本内 `syncToolkitsFromTools()` |
| `getToolkitDisplayName()` | 脚本内 `getToolkitDisplayName()` |
| `inferToolkitAuthStrategy()` | 脚本内 `inferToolkitAuthStrategy()` |
| `inferToolkitFromToolId()` | 脚本内 `inferToolkitFromToolId()` |
| `inferResourceAndAction()` | 脚本内 `inferResourceAndAction()` |

**数据源引用（保持 import 不复制）：**
- `BUILTIN_TOOLS` — 从 `apps/agents/src/modules/tools/builtin-tool-catalog.ts` import
- `VIRTUAL_TOOL_IDS` / `DEPRECATED_TOOL_IDS` — 从 `apps/agents/src/modules/tools/builtin-tool-definitions.ts` import
- `IMPLEMENTED_TOOL_IDS` — 从 `builtin-tool-catalog.ts` import

**脚本架构（与 mcp-profile-seed.ts 一致）：**
- 直连 mongoose，不启动 NestJS 上下文
- 使用 `shared/env-loader` 加载环境变量
- 支持 `sync` / `append` 两种模式
- 支持 `--dry-run`
- 导出 `seedBuiltinTools(mode)` 供 `seed-runner.ts` 调用

**对 seed-runner.ts 的影响：**
- `builtin-tools` 分支改为调用 `seedBuiltinTools(mode)`，不再需要启动 `AgentsAppModule`
- 如果 `builtin-tools` 是 selectedSeeds 中唯一需要 AgentsAppModule 的 seed，可跳过 `NestFactory.createApplicationContext(AgentsAppModule)`

**对 ToolService 的影响：**
- `seedBuiltinTools()` 和 `initializeBuiltinTools()` **保留不动**，不删除不修改
- 两份逻辑独立维护；脚本层作为运维入口，ToolService 方法作为历史保留（后续可按需清理）

### 步骤 3：迁移其他 seed 脚本到 `scripts/seed/`

- `manual-seed.ts` → `seed/seed-runner.ts`（移动 + 修正内部相对路径）
- `mcp-profile-seed.ts`、`role-seed.ts`、`system-schedule-seed.ts`、`seed-skill-planning-rules.ts` → `seed/` 目录
- 更新 `seed-runner.ts` 内部 `localRequire` 路径引用
- 所有 seed 脚本改用 `shared/env-loader` 代替内联环境加载

### 步骤 4：归档 migration 脚本到 `scripts/migrate/`

- 移动 6 个 migrate/backfill 脚本到 `migrate/` 子目录
- 仅更新 `package.json` 中的路径，不改脚本代码逻辑

### 步骤 5：创建 `maintenance/cleanup-runtime.ts`

从现有 `cleanup-agents-runtime-data.ts` 演化，扩大清理范围。

**清理的 MongoDB 集合（运行时产生的临时数据）：**

| 集合 | 说明 |
|------|------|
| `agent_sessions` | Agent 会话 |
| `agent_messages` | Agent 消息 |
| `agent_parts` | Agent 消息分片 |
| `agent_runs` | Agent 运行记录 |
| `agent_tasks` | Agent 任务 |
| `agent_action_logs` | Agent 行为日志 |
| `agent_tool_executions` | 工具执行记录 |
| `agent_events_outbox` | 事件发件箱 |
| `orchestration_plan_sessions` | 编排计划会话 |
| `orchestration_tasks` | 编排任务 |

**清理的 Redis key patterns：**
- `agent-task:queue`
- `agent-task-events:*`

**安全机制：**
- 默认 `--dry-run`，仅报告待清理数量
- 执行需要 `--execute --confirm=DELETE_RUNTIME_DATA`
- 输出清理前后统计

### 步骤 6：创建 `maintenance/cleanup-redis.ts`

全局审查并清理 Redis 缓存。

**核心逻辑：**
1. 使用 `SCAN` 遍历所有 key（避免 `KEYS *` 阻塞）
2. 按前缀分类统计 key 数量与内存占用
3. 已知业务前缀分类：

| 前缀模式 | 来源 | 说明 |
|----------|------|------|
| `agent-task:*` | agent-executor | 任务队列 |
| `agent-task-events:*` | agent-executor | 任务事件流 |
| `inner:subscription:*` | inner-message | 内部消息订阅索引 |
| `inner:event:def:*` | inner-message | 事件定义缓存 |
| `skill:*` | skill-service | 技能缓存 |
| `ctx-fp:*` | context-fingerprint | 上下文指纹缓存 |
| `docs-heat:*` | docs-heat | 文档热度排行缓存 |
| `ei-config:*` | ei-app-config | EI 应用配置缓存 |
| `meeting:*` | meeting-service | 会议状态缓存 |

4. 支持参数：
   - `--dry-run`（默认）：仅输出统计报告
   - `--execute --confirm=FLUSH_REDIS_CACHE`：执行清理
   - `--keep=<prefix1,prefix2>`：保留指定前缀（白名单）
   - `--only=<prefix1,prefix2>`：仅清理指定前缀

### 步骤 7：创建 `maintenance/backup-db.ts`

使用 `mongodump` 备份 MongoDB。

**功能：**
- 从环境变量读取 MongoDB 连接信息
- 默认输出到 `backend/backups/<dbname>_<YYYYMMDD_HHmmss>/`
- 支持参数：
  - `--output=<dir>`：自定义输出路径
  - `--gzip`：启用 gzip 压缩
  - `--collections=<col1,col2>`：仅备份指定集合
- 执行前检测 `mongodump` 命令是否可用，不可用时给出安装提示
- 输出备份摘要（集合数、文档数、文件大小、耗时）

### 步骤 8：创建 `maintenance/restore-db.ts`

使用 `mongorestore` 恢复 MongoDB。

**功能：**
- 必须指定 `--from=<backup-dir>`
- 支持参数：
  - `--drop`：恢复前清空目标集合（默认增量恢复）
  - `--collections=<col1,col2>`：仅恢复指定集合
  - `--confirm=RESTORE_DATABASE`：安全确认（必须提供）
- 执行前检测 `mongorestore` 命令是否可用
- 输出恢复摘要

### 步骤 9：创建 `maintenance/maintenance-runner.ts`

统一入口，支持选择子任务。

```bash
# 用法示例
ts-node scripts/maintenance/maintenance-runner.ts --task=cleanup-runtime --dry-run
ts-node scripts/maintenance/maintenance-runner.ts --task=cleanup-redis --keep=skill,inner
ts-node scripts/maintenance/maintenance-runner.ts --task=backup --gzip
ts-node scripts/maintenance/maintenance-runner.ts --task=restore --from=./backups/mait_20260322 --drop --confirm=RESTORE_DATABASE
```

**支持的 task：**
- `cleanup-runtime` — 清理运行时数据
- `cleanup-redis` — 清理 Redis 缓存
- `backup` — 备份数据库
- `restore` — 恢复数据库

### 步骤 10：更新 `package.json` scripts

```jsonc
{
  // — Seed（路径更新）—
  "seed:manual":           "ts-node -r tsconfig-paths/register scripts/seed/seed-runner.ts",
  "seed:system-schedules": "npm run seed:manual -- --only=system-schedules",
  "seed:docs-heat":        "npm run seed:manual -- --only=docs-heat",
  "seed:meeting-monitor":  "npm run seed:manual -- --only=meeting-monitor",

  // — Maintenance（新增）—
  "maintain":               "ts-node -r tsconfig-paths/register scripts/maintenance/maintenance-runner.ts",
  "maintain:cleanup-runtime": "npm run maintain -- --task=cleanup-runtime",
  "maintain:cleanup-redis":   "npm run maintain -- --task=cleanup-redis",
  "maintain:backup":          "npm run maintain -- --task=backup",
  "maintain:restore":         "npm run maintain -- --task=restore",

  // — Cleanup（旧命令保留为别名，指向新路径）—
  "cleanup:agents-runtime": "npm run maintain:cleanup-runtime",

  // — Migration（路径更新）—
  "migrate:skill-content":                "ts-node -r tsconfig-paths/register scripts/migrate/migrate-skill-content-to-db.ts",
  "migrate:tool-prompts":                 "ts-node -r tsconfig-paths/register scripts/migrate/backfill-tool-prompts.ts",
  "migrate:agent-profile-permissions":    "ts-node -r tsconfig-paths/register scripts/migrate/migrate-agent-profile-permissions.ts",
  "migrate:role-tier":                    "ts-node -r tsconfig-paths/register scripts/migrate/migrate-role-tier.ts",
  "migrate:inner-message-collections":    "ts-node -r tsconfig-paths/register scripts/migrate/migrate-inner-message-collections.ts",
  "migrate:schema-collection-governance": "ts-node -r tsconfig-paths/register scripts/migrate/migrate-schema-collection-governance.ts"
}
```

### 步骤 11：清理遗留文件

- 删除 `backend/scripts/ss.json`（空文件）
- 原位置的旧脚本文件在迁移完成后删除

## 4. 关键影响点

| 维度 | 影响 |
|------|------|
| **后端 scripts** | 目录重组为 seed/maintenance/migrate/shared 四个子目录 |
| **package.json** | 更新所有 seed/migrate 路径，新增 maintain 系列命令 |
| **运维流程** | 新增 `npm run maintain:*` 日常维护入口 |
| **API / 前端** | 无变更 |
| **数据库 Schema** | 无变更 |
| **外部依赖** | backup/restore 依赖宿主机安装 MongoDB Database Tools（`mongodump`/`mongorestore`） |

## 5. 风险与依赖

| 风险 | 应对 |
|------|------|
| `mongodump`/`mongorestore` 未安装 | 脚本启动时检测，未安装则打印安装指引并退出 |
| cleanup-runtime 误删生产数据 | 默认 dry-run + 双重确认（`--execute --confirm=...`） |
| cleanup-redis 清理到正在使用的缓存 | 支持 `--keep` 白名单；dry-run 先查看再执行 |
| restore 覆盖线上数据 | 必须提供 `--confirm=RESTORE_DATABASE`；`--drop` 需显式指定 |
| builtin-tool-seed 与 ToolService 逻辑分叉 | 两份独立维护；工具定义数据源（BUILTIN_TOOLS 等常量）保持 import 共用，不复制 |
| seed 脚本移动后相对路径断裂 | 步骤 3 中统一修正 `localRequire` 和 import 的相对路径 |
| 旧命令兼容性 | `cleanup:agents-runtime` 保留为别名指向新入口 |

## 6. 验证清单

- [ ] `npm run seed:manual -- --all --dry-run` 正常输出
- [ ] `npm run seed:manual -- --only=builtin-tools --dry-run` 正常输出（脚本层独立运行，不启动 NestJS）
- [ ] `npm run maintain:cleanup-runtime -- --dry-run` 正常输出各集合统计
- [ ] `npm run maintain:cleanup-redis -- --dry-run` 正常输出 Redis key 分类统计
- [ ] `npm run maintain:backup -- --gzip` 成功生成备份目录
- [ ] `npm run maintain:restore -- --from=<backup> --confirm=RESTORE_DATABASE` 恢复成功
- [ ] 所有 `npm run migrate:*` 命令路径正确可执行
