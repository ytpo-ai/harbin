# MCP_PROFILE_SEED_BOUNDARY

## 目标

- 将 MCP Profile seed 与运行时 service 解耦。
- `apps/agents` 中的 service 仅负责运行时读写、归一化与权限派生。
- seed 统一由 `backend/scripts` 承担，避免职责混杂。

## 当前职责边界

- 脚本侧：`backend/scripts/mcp-profile-seed.ts`
  - 持有 MCP Profile 默认 seed 数据（单一来源）。
  - 支持 `sync` / `append` 两种落库模式。
  - 在写入时根据 `tools.requiredPermissions` 计算 `permissionsDerived`。
- 脚本入口：`backend/scripts/manual-seed.ts`
  - `--only=mcp-profiles` 时直接调用 `seedMcpProfiles(mode)`。
- 运行时：`backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts`
  - 不再包含 seed 常量与 seed 写库逻辑。
  - 仅保留 Profile 查询、更新、工具权限派生、legacy tool id 归一化。

## 删除能力

- 已移除工具权限集重置接口链路：
  - `POST /agents/tool-permission-sets/reset-system-roles`
  - 相关后端方法与前端调用入口同步删除。

## 验证建议

- 通过 `npm run seed:manual -- --only=mcp-profiles --mode=sync` 校验落库。
- 通过 `npm run seed:manual -- --only=mcp-profiles --mode=append` 校验追加模式。
