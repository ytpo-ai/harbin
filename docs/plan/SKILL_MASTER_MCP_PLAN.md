# Skill Master MCP Plan

## Goal
新增 `skill-master` toolkit，并提供 Skill MCP 工具能力：
- 列出当前系统 skill 列表，支持按 `title` 模糊检索
- 创建一个 skill

## Scope
- Backend tools registry（builtin tool + toolkit 注册）
- Backend tools execution（ToolService 内置实现）
- Skills domain service（查询/创建复用与入参兼容）
- 测试（ToolService 单测）
- 文档（feature/api 相关更新）

## Steps
1. 梳理当前 tools/skills 模块边界，确定 `skill-master` 的 canonical tool id、namespace、executionChannel 与 toolkit 映射。
2. 在 `ToolService.initializeBuiltinTools` 中注册两个内置工具（list/create），并完成 toolkit 元数据对齐。
3. 在 `ToolService` 注入 `SkillService`，实现 `list-skills` 执行逻辑（title 模糊检索 + limit 限流 + 返回摘要字段）。
4. 在 `ToolService` 实现 `create-skill` 执行逻辑（参数校验、与 SkillService 复用、结构化返回）。
5. 补充/更新 `ToolService` 单测，覆盖 list/create 成功与关键失败场景。
6. 运行 lint/test 验证实现，并更新功能文档/API 文档中的工具清单与行为说明。

## Impacts
- Backend: `modules/tools`, `modules/skills`
- API/MCP: tools registry 与工具执行入口
- Docs: `docs/feature/AGENT_TOOL.md`、`docs/api/agents-api.md`

## Risks/Dependencies
- `title` 为调用侧术语，Skill 实体为 `name` 字段，需做明确映射避免语义歧义。
- 模糊检索走正则时需做 regex escape，避免异常或性能退化。
- `create-skill` 需要最小必填字段（`name/title` 与 `description`），缺失时应给出清晰错误信息。
