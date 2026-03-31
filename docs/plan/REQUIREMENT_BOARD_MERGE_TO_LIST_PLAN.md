# Requirement Board 合并到 List 工具计划

## 1. 需求理解

- 目标是将 `builtin.sys-mg.mcp.requirement.board` 的看板能力并入 `builtin.sys-mg.mcp.requirement.list`，并删除独立 `board` 工具入口。
- 变更应避免影响现有 `requirement.list` 与 `requirement.get` 的调用稳定性。

## 2. 执行步骤

1. 梳理 `requirement` 工具链路（catalog、dispatcher、handler、常量与 seed）中 `board/list/get` 的注册与分发现状。
2. 在 `requirement.list` 上增加看板视图参数，并复用原 `board` 聚合逻辑，确保返回结构兼容。
3. 删除 `builtin.sys-mg.mcp.requirement.board` 的工具定义与执行分发入口。
4. 同步更新 `agent.constants` 与 seed 侧 requirement 工具映射，移除 `board` 导出并保持引用不报错。
5. 更新/补充测试，覆盖 list 普通查询、list 看板视图与 board 工具不可用场景。
6. 更新功能文档中 requirement 工具说明，明确以 `list` 承载看板视图能力。

## 3. 关键影响点

- 工具目录与元数据：`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
- 工具执行分发：`backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts`
- requirement 处理器：`backend/apps/agents/src/modules/tools/builtin/requirement-tool-handler.service.ts`
- 工具 ID 常量：`backend/apps/agents/src/modules/agents/agent.constants.ts`
- seed 映射：`backend/scripts/seed/mcp-profile.ts`
- 功能文档：`docs/feature/ENGINEERING_INTELLIGENCE.md`

## 4. 风险与依赖

- 若外部脚本仍硬编码调用 `builtin.sys-mg.mcp.requirement.board`，删除后会失败；需要通过文档与工具定义尽快统一。
- `list` 新增视图参数后，需保证默认行为不变，避免影响现有依赖方。
- 依赖 EI requirement board/list API 行为稳定，避免合并后出现字段不一致。

## 5. 追加需求（requirement mutate 收敛）

- 将 `builtin.sys-mg.mcp.requirement.assign` 与 `builtin.sys-mg.mcp.requirement.comment` 合并为统一工具 `builtin.sys-mg.mcp.requirement.update`。
- 保留 `builtin.sys-mg.mcp.requirement.update-status` 作为独立工具，兼容现有状态回写链路。

### 5.1 执行步骤

1. 在 requirement handler 新增 `mutateRequirement(action=update_status|assign|comment)` 统一入口，并复用现有 assign/comment/status 行为。
2. 在工具目录新增 `requirement.update`，删除 `requirement.assign` 与 `requirement.comment` 两个工具定义。
3. 在执行分发中新增 mutate 分支，移除 assign/comment 分支；`update-status` 保持不变。
4. 更新 `agent.constants` 与 `scripts/seed/mcp-profile.ts` 的 requirement 工具集合，移除 assign/comment，增加 mutate。
5. 补充单测覆盖 mutate 的 assign/comment 路径，并验证旧工具 ID 不再被分发。
