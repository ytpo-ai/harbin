# CTO 每日需求整理分发定时 Seed 计划

## 1. 需求理解

- 新增系统内置计划编排定时服务 seed。
- 每天早上 10 点由 CTO 治理 Agent 自动执行需求整理与分发。
- 写入现有 `system-schedules` seed 链路，支持幂等补种。

## 2. 执行步骤

1. 梳理现有 `system-schedule-seed` 结构与系统计划命名规范，确定新增 seed 的接入点。
2. 在 `system-schedule-seed` 中新增 CTO 每日需求整理分发 seed 定义（含 name/planKey/cron/timezone/target/input）。
3. 将新 seed 纳入 `SystemSeedName` 与默认执行序列，确保执行 `seed:manual --only=system-schedules` 时可自动写入。
4. 采用幂等策略：已存在时更新关键字段（planId、schedule、target、input），不存在时创建。
5. 本地执行手动 seed 验证，确认定时计划可被正确创建/更新。
6. 更新相关文档（功能文档、dailylog）以沉淀变更。

## 3. 关键影响点

- 后端：`backend/scripts/system-schedule-seed.ts`。
- 调度：`orchestration_schedules` 内置计划新增 1 条 cron 任务。
- 需求治理：通过 CTO Prompt 驱动需求整理与分发闭环。
- 文档：`docs/feature/ORCHETRATION_SCHEDULER.md`、`docs/feature/ENGINEERING_INTELLIGENCE.md`、`docs/dailylog/day/2026-03-15.md`。

## 4. 风险与依赖

- Agent 身份依赖：默认使用 `executive-lead` 作为治理 Agent 执行者。
- 触发时区依赖：默认 `Asia/Shanghai`；若部署时区不同需通过环境变量覆盖。
- 分发策略依赖 prompt 约束与现有 requirement MCP 工具可用性。
