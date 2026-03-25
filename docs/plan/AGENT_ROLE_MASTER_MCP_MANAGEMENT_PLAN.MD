# Agent Role Master MCP 管理能力落盘计划

## 1. 需求目标

- 新增 `agent-role-master` MCP 管理工具，使被授权的指定 Agent 能管理 `agent_role`。
- 管理范围覆盖：角色查询、创建、更新、删除。
- 管理能力必须受现有权限体系约束（最小权限原则）。

## 2. 执行步骤（Plan）

1. 在 Tools 常量层新增 `agent-role-master` 工具 ID，统一命名与复用。
2. 在内置工具目录注册 4 个 MCP 工具（`list/create/update/delete`），补齐参数契约与 `requiredPermissions`。
3. 在 `tool.service.ts` 增加工具分发与执行处理，复用 `AgentRole` 服务层逻辑，统一错误信息。
4. 将 `agent-role-master` 纳入系统管理工具识别分支，保持与 `agent-master` 同级治理。
5. 补充/更新单测，覆盖关键路径（参数校验、成功调用、写操作约束）。
6. 更新功能文档与接口说明，补充“如何让指定 Agent 获得 role 管理能力”的配置指引。

## 3. 关键影响点

- 后端：`apps/agents` 的 Tools 模块（tool 常量、目录、分发执行）。
- 权限：`requiredPermissions` 与现有 JWT/scope/tool-permission 校验链路。
- Agent 可用性：需通过 MCP Profile 白名单 + Agent 实例授权双重配置后才可使用。
- 测试：`tool.service` 相关单测。
- 文档：`docs/feature/AGENT_MCP.md`、`docs/feature/AGENT_TOOL.md`、必要时 `docs/api/agents-api.md`。

## 4. 风险与依赖

- 风险1：权限粒度不足导致越权调用。
  - 对策：读写权限拆分（`agent_role_registry_read`/`agent_role_registry_write`）并绑定到工具级权限。
- 风险2：仅配置 Agent.tools 未同步 profile 白名单导致分配失败。
  - 对策：文档明确要求“先 profile、后 agent”两步配置。
- 依赖：现有 `AgentRoleService` CRUD 能力与 Tools 执行鉴权链路保持可用。

## 5. 验收标准

- 可通过 MCP 调用完成 role 的 list/create/update/delete。
- 未授权 Agent 调用会被现有权限机制拦截。
- 相关文档完成更新，可指导指定 Agent 开通此能力。
