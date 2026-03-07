# MCP Profile 治理主计划（聚合）

## 说明

本主计划聚合以下计划文档，统一 MCP Profile 与 Agent 工具治理：

- `docs/plan/FRONTEND_MCP_PROFILE_MANAGEMENT_PLAN.md`
- `docs/plan/AGENT_TOOL_WHITELIST_MODE_PLAN.md`

并纳入同一主题下的页面结构优化：

- Agent 管理与 MCP Profile 管理 tab 分离

## 目标

1. 让配置来源清晰：类型级策略（MCP Profile）与实例级绑定（Agent.tools）关系可见。
2. 让约束可执行：后端硬校验 `Agent.tools ⊆ MCPProfile.tools(agent.type)`。
3. 让运维可操作：前端可直接查看/编辑 Profile，并快速排障“工具未生效”问题。

## 分阶段执行

### 阶段 A：管理能力补齐

- 前端新增 MCP Profile 列表与编辑入口。
- 接入 profiles 相关 API。
- 修复 profile seed 对历史数据的同步补齐策略。

### 阶段 B：白名单治理

- 后端创建/更新 Agent 时校验工具白名单。
- 前端只展示当前 `agent.type` 可选工具。
- 对历史非法工具给出提示并在保存时收敛。

### 阶段 C：交互结构优化

- Agent 管理与 MCP Profile 管理采用 tab 分离。
- 保持“配置视图”与“实例视图”职责分离，降低误解。

## 验收标准

- 前端可完成 profile 查询与更新。
- 非白名单工具无法通过后端写入。
- 用户可直接在 UI 识别并修复 profile/agent 工具错配。

## 备注

后续新增工具时，优先在本主计划下补充治理步骤（seed、profile、白名单、前端展示）并同步文档。
