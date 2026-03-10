# Seed 手动触发统一改造开发总结

## 背景

- 线上存在启动自动 seed 行为，导致用户已删除的系统对象（如 `Model Management Agent`）在服务重启后被自动恢复。
- 目标是将现有 seed 统一改为手动触发，避免启动副作用，并保留幂等补齐能力。

## 本次改动

1. 新增统一手动 seed 脚本：`backend/scripts/manual-seed.ts`
   - 支持 `--all`
   - 支持 `--only=<seed1,seed2>`
   - 支持 `--dry-run`
   - 支持 `--force`（当前仅输出标记，保留后续扩展）

2. 移除启动自动 seed 入口
   - `AgentService` 构造函数不再自动执行系统 seed
   - `ToolService` 构造函数不再自动初始化内置工具
   - `ModelManagementService` 不再 `onModuleInit` 自动写入默认模型
   - `SchedulerService` 启动不再自动创建 `system-meeting-monitor`
   - agents `main.ts` 不再启动期自动初始化默认模型 provider

3. 提供显式手动 seed 方法
   - `AgentService.seedMcpProfileSeeds()`
   - `AgentService.seedModelManagementAgent()`
   - `ToolService.seedBuiltinTools()`
   - `ModelManagementService.seedDefaultModels()`
   - `SchedulerService.seedMeetingMonitorSchedule()`

4. 新增命令
   - `backend/package.json` 增加：`npm run seed:manual -- --all`

5. 文档同步
   - `docs/feature/MEETING_CHAT.md` 中 Meeting Monitor 说明改为“手动 seed”。

## 结果

- 服务重启后不再自动补齐上述系统 seed 数据。
- 可通过统一脚本按需初始化或修复系统 seed。
- `Model Management Agent` 删除后不会在重启时自动恢复，仅在手动 seed 时恢复。

## 验证

- `npm run build:agents` 通过。
- `npm run build`（legacy）通过。
- `npm run seed:manual -- --all --dry-run` 可正确输出 seed 选择结果。
