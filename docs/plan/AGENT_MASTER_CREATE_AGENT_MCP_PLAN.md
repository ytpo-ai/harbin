# Agent Master Create Agent MCP Plan

## Goal
在现有 MCP 工具体系中新增 Agent 创建能力，并完成 agent toolkit 命名统一：
- 新增 `create-agent` MCP 工具用于创建 Agent
- 将 `agent-admin` toolkit 命名升级为 `agent-master`
- 默认按 provider 选择默认 API Key（provider 未传时使用 `default` 策略）

## Scope
- Backend tools registry（新增 create-agent、迁移 list-agents 到 agent-master）
- Backend tools execution（ToolService 创建执行逻辑与默认 api-key 解析）
- Agent MCP profile seeds（旧 tool id 同步到新 tool id）
- 测试（ToolService 单测）
- 文档（feature/api 更新）

## Steps
1. 梳理并统一 `agent-admin` 相关 tool id，定义新 canonical id：`builtin.sys-mg.internal.agent-master.*`。
2. 在 `ToolService.initializeBuiltinTools` 注册 `list-agents`（新 id）与 `create-agent`，并补齐参数 schema。
3. 在 `ToolService` 增加 `createAgentByMcp` 执行逻辑：参数清洗、model 回填、调用 `/agents` 创建。
4. 增加默认 API Key 解析逻辑：优先 `apiKeyId` 显式传入；否则按 provider 选择 `isDefault=true && isActive=true` key。
5. 更新 `AgentService` MCP profile seed 中引用的 agent list tool id 为 `agent-master`。
6. 补充单测覆盖 create-agent 与默认 provider/api-key 行为，并同步更新功能/API 文档。

## Impacts
- Backend: `backend/apps/agents/src/modules/tools/`, `backend/apps/agents/src/modules/agents/`
- Data model: 复用 `api_keys` 默认 key 选择规则
- Docs: `docs/feature/AGENT_TOOL.md`, `docs/api/agents-api.md`

## Risks/Dependencies
- 历史 Agent/Profile 可能仍引用 `agent-admin` 旧 id，需要保留执行兼容，避免运行时失效。
- `provider=default` 为策略值而非模型 provider，需显式回退到模型 provider 后再查默认 key。
- 创建 Agent 仍依赖 role 有效性校验，若 roleId 不存在将由后端创建接口返回错误。

## Follow-up (Role Code Compatibility)
1. `create-agent` 入参 `roleId` 兼容 role `code`：优先按 id 查询，失败后按 code 解析并转换为 id。
2. 解析逻辑依赖 `/roles` 列表接口，按 `status=active` 获取候选并做唯一匹配。
3. 当 code/id 均无效时，返回包含可用 role 样例的错误提示，减少重复排查。
4. 同步更新测试与 API 文档，明确 `roleId` 字段支持 id/code（推荐 id）。
