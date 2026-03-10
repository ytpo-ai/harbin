# Memo MCP Append 提示词字段修复计划

## 1. 需求理解

- 当前工具列表中，`memo_mcp_append` 实际存在提示词配置，但条目显示为“无提示词”。
- 工具修改页未正确加载并回填提示词字段，导致编辑时看不到已有 prompt。
- 目标是打通工具列表展示与编辑页回填两条链路，确保提示词字段读取一致。

## 2. 执行步骤

1. 梳理 tools 列表/详情接口与前端类型定义，确认 `prompt` 字段在不同工具来源下的返回结构。
2. 排查工具列表“有提示词/无提示词”判断逻辑，修正字段读取优先级与空值判断。
3. 排查工具修改页表单初始化逻辑，补齐对后端实际返回 prompt 字段的兼容回填。
4. 统一前端工具实体的 prompt 解析入口，避免列表与编辑页各自读取导致不一致。
5. 增加最小回归校验（类型/单测或关键逻辑断言），覆盖 `memo_mcp_append` 场景。
6. 同步更新相关功能文档，记录本次字段修复与兼容策略。

## 3. 影响点

- 前端：`frontend/src/pages/Tools.tsx`
- 前端：`frontend/src/services/toolService.ts`
- 后端（如需）：`backend/apps/agents/src/modules/tools/tool.service.ts`
- 文档：`docs/feature/AGENT_TOOL.md`

## 4. 风险与依赖

- 工具返回结构可能存在历史兼容字段（`prompt/config.prompt/metadata.prompt`），需避免修复后影响其他工具。
- 若后端 registry 与列表接口返回结构不一致，需要做归一处理，防止某个入口仍显示“无提示词”。
