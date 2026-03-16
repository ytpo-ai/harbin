# 需求管理工具与 Manual Seed 修复计划

## 1. 需求理解

- 用户反馈 `需求管理` 工具未落库，且 `backend/scripts/manual-seed.ts` 未覆盖相关 seed。
- 同时存在 `manual-seed.ts` 导入问题，需要一并修复并验证脚本可执行。

## 2. 执行步骤

1. 梳理需求管理工具定义与 seed 入口（`builtin-tool-catalog` / `ToolService.seedBuiltinTools` / `manual-seed.ts`），确认缺口位置。
2. 修复 `backend/scripts/manual-seed.ts` 导入实现，确保在当前 ts-node 运行链路下稳定加载 Agents/Legacy 模块与 seed 方法。
3. 确认并补齐 `manual-seed.ts` 对需求管理工具写入链路（通过 `builtin-tools` seed 分支触发）。
4. 运行 `seed:manual` 做 dry-run 与真实写入验证，确认数据库出现 requirement MCP 工具且支持幂等更新。
5. 更新必要文档记录本次修复影响与验证结果。

## 3. 关键影响点

- 后端脚本：`backend/scripts/manual-seed.ts`
- 工具注册：`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
- 工具落库：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 文档：`docs/plan/REQUIREMENT_TOOL_MANUAL_SEED_FIX_PLAN.md`

## 4. 风险与依赖

- 依赖本地 Mongo/Redis 与 Agents/Legacy Nest AppContext 初始化成功。
- 若工具 ID 与历史数据冲突，可能出现更新覆盖或重复键异常。
- 若导入修复方式与现有 ts-node 运行时不兼容，需同步调整 seed 脚本加载策略。
