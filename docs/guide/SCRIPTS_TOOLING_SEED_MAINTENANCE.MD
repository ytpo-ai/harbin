# SCRIPTS_TOOLING_SEED_MAINTENANCE

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
  - `VIRTUAL_TOOL_IDS`
  - `DEPRECATED_TOOL_IDS`
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

## NPM 命令入口

- `backend/package.json` 中 `seed:manual` 已切换到：
  - `scripts/seed/seed-runner.ts`

## Maintenance 入口约束

- 统一入口：`backend/scripts/maintenance/maintenance-runner.ts`
- 任务路由：`cleanup-runtime` / `cleanup-redis` / `backup` / `restore`
- 模块加载：runner 内采用 `require()`（CommonJS）加载子任务，避免 `ts-node` 动态 `import()` 在无扩展名场景下解析失败。
- 运维直达命令：
  - `cleanup:agents-runtime`
  - `maintain:cleanup-runtime`
- 上述命令直接调用 `maintenance-runner.ts --task=cleanup-runtime`，确保 `npm run ... -- --execute --confirm=...` 参数可完整透传。
