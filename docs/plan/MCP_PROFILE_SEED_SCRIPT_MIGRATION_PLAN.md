# MCP Profile Seed Script Migration Plan

## 背景

- 当前 MCP Profile 的 seed 数据与写库逻辑位于 `agent-mcp-profile.service.ts`，属于运行时 service 职责。
- 目标是将 seed 完全迁移到 `backend/scripts`，让 service 仅保留运行时读写与权限推导能力。
- 用户额外要求删除 `resetToolPermissionSetsBySystemRoles` 功能。

## 执行步骤

1. 在 `backend/scripts` 新增 MCP Profile seed 数据与执行逻辑，支持 `sync/append`。
2. 调整 `manual-seed.ts` 中 `mcp-profiles` 的执行入口，改为调用脚本实现，不再走 `AgentService`。
3. 从 `agent-mcp-profile.service.ts` 中移除 seed 常量与 `ensureMcpProfileSeeds` 实现。
4. 从 `agent.service.ts`、`agent-role.service.ts`、`agent.controller.ts` 中移除 `resetToolPermissionSetsBySystemRoles` 相关 API 与方法。
5. 扫描并清理引用，确保不存在编译期残留调用。
6. 更新功能文档与 guide 缓存文档，记录 seed 职责边界变更。
7. 运行最小验证（lint/typecheck 或针对性脚本 dry-run）确认迁移后可用。

## 影响范围

- 后端：Agent 模块（MCP Profile service/role/service/controller）
- 脚本：`manual-seed` 与新增 seed 脚本
- 文档：`docs/feature/AGENT_MCP.md`、`docs/guide/`、`docs/dailylog/day/`

## 风险与注意事项

- 迁移后必须保证 seed 数据只有一份来源，避免 scripts 与 service 双写漂移。
- 删除 reset API 会影响依赖该接口的管理端或运维流程，需要同步文档说明。
