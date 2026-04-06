# SCRIPTS_GUIDE

## 目标

- 将 `backend/scripts` 拆分为 `seed` / `maintenance` / `migrate` / `shared`。
- 让内置工具 seed 脱离 `ToolService` 运行时上下文，支持纯脚本化执行。
- 统一 seed 入口与命名，降低运维入口复杂度。

## Seed 入口结构

- 统一入口：`backend/scripts/seed/seed-runner.ts`
- 兼容别名：`backend/scripts/seed/runner.ts`（仅转发到新入口）
- 子模块：
  - `mcp-profile-seed.ts`（转发到 `mcp-profile.ts`）
  - `role-seed.ts`（转发到 `role.ts`）
  - `system-schedule-seed.ts`（转发到 `system-schedule.ts`）
  - `builtin-tool-seed.ts`（真正的脚本化实现）

## Builtin Tool Seed 边界

- 文件：`backend/scripts/seed/builtin-tool-seed.ts`
- 数据源（只 import，不复制）：
  - `BUILTIN_TOOLS`
  - `IMPLEMENTED_TOOL_IDS`
  - 工具 ID 清理列表（脚本内 `TOOL_IDS_TO_PURGE_ON_SYNC`）
- 直连集合：
  - `agent_tools`
  - `agent_toolkits`
- 不依赖 Nest app context，直接 `mongoose.connect()`。

## seed-runner 执行策略

- `builtin-tools` 由脚本层 `seedBuiltinTools(mode, { dryRun })` 执行。
- 仅当选中 `model-management-agent` / `default-model-registry` 时才初始化 `AgentsAppModule`。
- legacy 侧（`system-schedules` / `meeting-monitor` / `docs-heat` / `agent-roles`）按需初始化 `AppModule`。
- `dry-run` 场景下：
  - `mcp-profiles`、`builtin-tools` 会走脚本层 dry-run。
  - 依赖 Nest 写入的任务输出 skip 日志，不执行写操作。
  - `hr-agent-role-master` 输出 skip 日志（该任务依赖 Mongo 读写上下文）。

## NPM 命令入口

- `backend/package.json` 中 `seed:manual` 已切换到：
  - `scripts/seed/seed-runner.ts`

## 脚本命令清单（可直接执行）

- 以下命令默认在 `backend/` 目录执行。

### Seed

- 全量执行：`npm run seed:manual -- --all`
- 指定任务：`npm run seed:manual -- --only=mcp-profiles,builtin-tools`
- 追加模式：`npm run seed:manual -- --only=hr-agent-role-master --mode=append`
- 预演模式：`npm run seed:manual -- --only=builtin-tools --dry-run`

### Maintenance

- 统一入口：`npm run maintain -- --task=<cleanup-runtime|cleanup-redis|cleanup-ended-meetings|backup|restore>`
- 清理运行时（预演）：`npm run maintain:cleanup-runtime`
- 清理运行时（执行）：`npm run maintain -- --task=cleanup-runtime --execute --confirm=DELETE_RUNTIME_DATA`
- 清理 Redis（预演）：`npm run maintain:cleanup-redis`
- 清理 Redis（执行）：`npm run maintain -- --task=cleanup-redis --execute --confirm=FLUSH_REDIS_CACHE`
- 删除已结束会议（预演）：`npm run maintain:cleanup-ended-meetings`
- 删除已结束会议（执行）：`npm run maintain -- --task=cleanup-ended-meetings --execute --confirm=DELETE_ENDED_MEETINGS`
- 删除已结束会议（按结束时长）：`npm run maintain -- --task=cleanup-ended-meetings --older-than-hours=168 --execute --confirm=DELETE_ENDED_MEETINGS`
- Mongo 备份：`npm run maintain:backup -- --gzip`
- Mongo 恢复：`npm run maintain:restore -- --from=./backups/<backup-dir> --drop --confirm=RESTORE_DATABASE`

### MongoDB Database Tools 安装（backup/restore 前置）

- macOS（Homebrew）：
  - `brew tap mongodb/brew`
  - `brew install mongodb-database-tools`
- Ubuntu：
  - `sudo apt-get update`
  - `sudo apt-get install -y mongodb-database-tools`
- 安装后验证：
  - `which mongodump`
  - `mongodump --version`
  - `which mongorestore`
  - `mongorestore --version`

### Migrate

- 技能内容迁移：`npm run migrate:skill-content -- --dry-run`
- 工具 prompt 回填：`npm run migrate:tool-prompts -- --dry-run`
- AgentProfile 权限迁移：`npm run migrate:agent-profile-permissions -- --dry-run`
- 集合治理迁移：`npm run migrate:schema-collection-governance -- --dry-run`

### 安全执行建议

- 先执行 `--dry-run`，确认输出后再执行写操作。
- 清理/恢复类命令必须带确认参数：
  - cleanup runtime：`--confirm=DELETE_RUNTIME_DATA`
  - cleanup redis：`--confirm=FLUSH_REDIS_CACHE`
  - cleanup ended meetings：`--confirm=DELETE_ENDED_MEETINGS`
  - restore db：`--confirm=RESTORE_DATABASE`

## Maintenance 入口约束

- 统一入口：`backend/scripts/maintenance/maintenance-runner.ts`
- 任务路由：`cleanup-runtime` / `cleanup-redis` / `cleanup-ended-meetings` / `backup` / `restore`
- 模块加载：runner 内采用 `require()`（CommonJS）加载子任务，避免 `ts-node` 动态 `import()` 在无扩展名场景下解析失败。
- 运维直达命令：
  - `cleanup:agents-runtime`
  - `maintain:cleanup-runtime`
- 上述命令直接调用 `maintenance-runner.ts --task=cleanup-runtime`，确保 `npm run ... -- --execute --confirm=...` 参数可完整透传。
