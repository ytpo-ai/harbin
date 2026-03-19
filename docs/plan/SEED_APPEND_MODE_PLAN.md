# seed:manual append 模式改造计划

## 背景

- 当前 `seed:manual` 默认是同步模式，会更新既有内置工具元数据与角色 MCP Profile 字段。
- 需求是新增“append 模式”：仅向数据库追加新的工具或 profile，并为已有记录只做最小增量追加。

## 实施步骤

1. 为 `seed:manual` 增加 `--mode=append|sync` 参数（默认 `sync`），并把 mode 透传到对应 seed 执行函数。
2. 为 `builtin-tools` seed 增加 append 分支：只插入不存在的工具，不删除 deprecated/virtual，不覆盖既有工具字段。
3. 为 `mcp-profiles` seed 增加 append 分支：仅新建缺失 profile；已有 profile 只对 `tools` 做 `$addToSet`，不覆盖 `permissionsManual/exposed/description`。
4. 保持默认 `sync` 语义不变，确保历史流程兼容。
5. 更新功能文档与当日日志，补充 append 模式使用方式与行为边界。

## 关键影响点

- `backend/scripts/manual-seed.ts`
- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/agents/agent-mcp-profile.service.ts`
- `docs/feature/AGENT_TOOL.md`
- `docs/dailylog/day/2026-03-17.md`

## 风险与约束

- append 模式不会自动修复历史脏数据；仅追加，不做对齐。
- 仅在明确需要低扰动时使用 append；常规环境仍建议使用 sync 进行基线一致性维护。
