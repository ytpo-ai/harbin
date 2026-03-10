# AGENT_MASTER_CREATE_AGENT_MCP 开发总结

## 1. 实施结果

- 已新增 Agent Master MCP 创建工具：`builtin.sys-mg.internal.agent-master.create-agent`。
- 已将 Agent 列表工具主 ID 升级为 `builtin.sys-mg.internal.agent-master.list-agents`。
- 已保留旧 ID `builtin.sys-mg.internal.agent-admin.list-agents` 执行兼容，避免历史配置失效。
- 创建流程支持默认 API Key 策略：未传 `apiKeyId` 时按 provider 选取默认 key。
- `create-agent` 已兼容 role code 入参：可传 role `id` 或 role `code`。

## 2. 代码改动

### 2.1 Tools 模块

- `backend/apps/agents/src/modules/tools/tool.service.ts`
  - 新增常量：`AGENT_LIST_TOOL_ID`、`LEGACY_AGENT_LIST_TOOL_ID`、`AGENT_CREATE_TOOL_ID`。
  - 内置工具注册新增 `agent-master.create-agent`。
  - 执行分发新增 `createAgentByMcp`，并为旧 `agent-admin.list-agents` 保留兼容分支。
  - 新增默认 key 解析：`resolveDefaultApiKeyId`（`provider + isDefault + isActive`）。
  - 新增参数规范化：`normalizeStringArray`。
  - 新增角色解析：`resolveRoleIdForCreate`（先按 id，再按 code 解析并映射到 role id）。

- `backend/apps/agents/src/modules/tools/tool.module.ts`
  - 注入 `ApiKey` schema，供 ToolService 查询默认 API Key。

### 2.2 Agent 模块

- `backend/apps/agents/src/modules/agents/agent.service.ts`
  - MCP profile seeds 中 Agent 列表工具 ID 更新为 `agent-master.list-agents`。

### 2.3 Seed 脚本

- `backend/scripts/manual-seed.ts`
  - 将动态 `import()` 改为 `require()` 条件加载，修复 `ts-node` 在 NodeNext 环境下的模块解析失败。

### 2.4 测试

- `backend/apps/agents/src/modules/tools/tool.service.spec.ts`
  - 新增 `agent master create agent mcp` 用例：
    - provider 默认 key 回退创建成功
    - 缺少 `name` 的报错校验

## 3. 文档同步

- `docs/plan/AGENT_MASTER_CREATE_AGENT_MCP_PLAN.md`
- `docs/feature/AGENT_MCP.md`
- `docs/feature/AGENT_TOOL.md`
- `docs/api/agents-api.md`
- `docs/technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md`

## 4. 验证

- 执行：`npm test -- apps/agents/src/modules/tools/tool.service.spec.ts -t "agent master create agent mcp"`
- 结果：通过（2 passed）

- 执行：`npm run seed:manual -- --only=builtin-tools,mcp-profiles --dry-run`
- 结果：通过（脚本可正常解析并执行）

## 5. 风险与后续建议

- 旧 `agent-admin` id 仍建议在后续版本逐步下线，并补充迁移脚本/公告。
- 若 provider 对应默认 key 缺失，当前回退系统默认策略；建议在管理端增加可观测提示。
