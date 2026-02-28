# Agents/Tools Migration Execution Log

## 1) 工作流程（按执行顺序）

1. 代码盘点与边界确认：确认实际目录为 `backend/apps/*` + `backend/src/*`，识别 `apps/agents` 对 `src/modules/agents|tools` 的直接依赖。
2. 边界决策固化：明确 `agents` 服务仅承载 Agent + Tools，`meeting/chat` 保持业务域（legacy）。
3. 迁移计划落盘：创建 `docs/plan/AGENTS_TOOLS_MIGRATION_PLAN.md`，写入范围、阶段、风险与回滚。
4. 代码迁移执行：将 `agents/tools` 模块迁移到 `backend/apps/agents/src/modules/` 并修正引用。
5. 路由边界调整：Gateway 仅将 `/api/agents/**`、`/api/tools/**` 分流到 agents，其余保持 legacy。
6. 文档同步：更新微服务迁移文档与架构文档中的边界和路由说明。
7. 建议落地（第一批）：在 legacy 新增 `AgentClientService`/`ToolClientService`，并替换 `organization`、`employees`、`hr` 调用点。
8. 可观测性增强：Gateway 新增 `x-request-id` 透传与延迟日志。
9. 构建验证：加载 nvm 后执行 `build:agents`、`build:gateway`、`build`（legacy）并通过。

## 2) 已阅读文件清单

- `AGENTS.md`
- `README.md`
- `docs/plan/AGENTS_TOOLS_MIGRATION_PLAN.md`
- `docs/architecture/MICROSERVICES_MIGRATION.md`
- `docs/architecture/ARCHITECTURE.md`
- `backend/package.json`
- `backend/nest-cli.json`
- `backend/tsconfig.json`
- `backend/apps/agents/tsconfig.app.json`
- `backend/apps/legacy/tsconfig.app.json`
- `backend/apps/agents/src/main.ts`
- `backend/apps/agents/src/app.module.ts`
- `backend/apps/agents/src/controllers/stream.controller.ts`
- `backend/apps/agents/src/security/internal-context.middleware.ts`
- `backend/apps/gateway/src/app.module.ts`
- `backend/apps/gateway/src/gateway.controller.ts`
- `backend/apps/gateway/src/gateway-proxy.service.ts`
- `backend/src/app.module.ts`
- `backend/src/modules/agents/agent.module.ts`
- `backend/src/modules/agents/agent.service.ts`
- `backend/src/modules/agents/agent.controller.ts`
- `backend/src/modules/tools/tool.module.ts`
- `backend/src/modules/tools/tool.service.ts`
- `backend/src/modules/tools/tool.controller.ts`
- `backend/src/modules/tools/composio.service.ts`
- `backend/src/modules/tasks/task.module.ts`
- `backend/src/modules/chat/chat.module.ts`
- `backend/src/modules/meetings/meeting.module.ts`
- `backend/src/modules/hr/hr.module.ts`
- `backend/src/modules/hr/hr.service.ts`
- `backend/src/modules/organization/organization.module.ts`
- `backend/src/modules/organization/organization.service.ts`
- `backend/src/modules/governance/governance.service.ts`
- `backend/src/modules/employees/employee.service.ts`
- `backend/libs/auth/src/index.ts`
- `backend/libs/auth/src/context-signature.util.ts`
- `backend/libs/contracts/src/index.ts`
- `backend/libs/contracts/src/user-context.ts`

## 3) 已编辑文件与摘要

- `AGENTS.md`：新增 Node/pnpm 命令前必须加载 nvm 的协议。
- `docs/plan/AGENTS_TOOLS_MIGRATION_PLAN.md`：创建并持续更新迁移进度。
- `docs/architecture/MICROSERVICES_MIGRATION.md`：更新 agents 承载范围、增加 legacy 防腐层说明。
- `docs/architecture/ARCHITECTURE.md`：更新 gateway 路由到 `/api/agents` + `/api/tools`。
- `backend/apps/agents/src/app.module.ts`：切换本地 AgentModule，移除非本轮边界模块导入。
- `backend/apps/agents/src/controllers/stream.controller.ts`：改为引用本地 `AgentService`。
- `backend/apps/gateway/src/gateway-proxy.service.ts`：调整分流范围；新增 requestId 透传与延迟日志。
- `backend/apps/agents/src/modules/agents/agent.controller.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/agents/agent.module.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/agents/agent.service.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/tools/tool.controller.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/tools/tool.module.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/tools/tool.service.ts`：新增（迁移）。
- `backend/apps/agents/src/modules/tools/composio.service.ts`：新增（迁移）。
- `backend/src/modules/agents/agent-client.service.ts`：新增 legacy->agents 防腐层客户端。
- `backend/src/modules/tools/tool-client.service.ts`：新增 legacy->agents tools 客户端。
- `backend/src/modules/agents/agent.module.ts`：注册并导出 `AgentClientService`。
- `backend/src/modules/tools/tool.module.ts`：注册并导出 `ToolClientService`。
- `backend/src/modules/organization/organization.service.ts`：调用切换到 `AgentClientService`。
- `backend/src/modules/employees/employee.service.ts`：调用切换到 `AgentClientService`，并清理未使用导入。
- `backend/src/modules/hr/hr.service.ts`：调用切换到 `ToolClientService`。
- `backend/src/modules/governance/governance.service.ts`：移除未使用 `AgentService` 依赖。

## 4) 迁移文件清单（source -> target）

- `backend/src/modules/agents/agent.controller.ts` -> `backend/apps/agents/src/modules/agents/agent.controller.ts`
- `backend/src/modules/agents/agent.module.ts` -> `backend/apps/agents/src/modules/agents/agent.module.ts`
- `backend/src/modules/agents/agent.service.ts` -> `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/src/modules/tools/tool.controller.ts` -> `backend/apps/agents/src/modules/tools/tool.controller.ts`
- `backend/src/modules/tools/tool.module.ts` -> `backend/apps/agents/src/modules/tools/tool.module.ts`
- `backend/src/modules/tools/tool.service.ts` -> `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/src/modules/tools/composio.service.ts` -> `backend/apps/agents/src/modules/tools/composio.service.ts`

说明：当前采用“迁移 + 并行保留”策略，legacy 源文件暂不删除，确保可灰度与可回滚。

## 5) 按阶段验收清单（命令 / 预期结果 / 回滚动作）

### 阶段 A：边界收敛与计划落地

- 命令
  - `test -f docs/plan/AGENTS_TOOLS_MIGRATION_PLAN.md && echo OK`
  - `grep -n "api/tools" docs/architecture/MICROSERVICES_MIGRATION.md`
  - `grep -n "meeting/chat" docs/plan/AGENTS_TOOLS_MIGRATION_PLAN.md`
- 预期结果
  - 计划文件存在，且文档明确 `meeting/chat` 不迁移、`/api/tools` 走 agents。
- 回滚动作
  - 回滚文档变更到迁移前版本。

### 阶段 B：Agents/Tools 模块迁移

- 命令
  - `ls backend/apps/agents/src/modules/agents`
  - `ls backend/apps/agents/src/modules/tools`
  - `grep -R "src/modules/agents" backend/apps/agents/src || true`
  - `grep -R "src/modules/tools" backend/apps/agents/src || true`
- 预期结果
  - `apps/agents` 存在本地 `agents/tools`，且不再穿透引用 legacy `agents/tools`。
- 回滚动作
  - 暂时恢复 `apps/agents` 对 legacy 模块的旧引用。

### 阶段 C：Gateway 路由边界调整

- 命令
  - `grep -n "startsWith('/api/agents')" backend/apps/gateway/src/gateway-proxy.service.ts`
  - `grep -n "startsWith('/api/tools')" backend/apps/gateway/src/gateway-proxy.service.ts`
  - `grep -n "startsWith('/api/tasks')" backend/apps/gateway/src/gateway-proxy.service.ts || true`
- 预期结果
  - 仅 `/api/agents`、`/api/tools` 分流到 agents。
- 回滚动作
  - 恢复旧分流规则。

### 阶段 D：legacy 防腐层接入（第一批）

- 命令
  - `ls backend/src/modules/agents/agent-client.service.ts`
  - `ls backend/src/modules/tools/tool-client.service.ts`
  - `grep -n "AgentClientService" backend/src/modules/organization/organization.service.ts`
  - `grep -n "AgentClientService" backend/src/modules/employees/employee.service.ts`
  - `grep -n "ToolClientService" backend/src/modules/hr/hr.service.ts`
- 预期结果
  - client 存在且第一批调用点切换完成。
- 回滚动作
  - 将这些模块改回本地 service 注入，client 先保留不启用。

### 阶段 E：可观测性增强

- 命令
  - `grep -n "x-request-id" backend/apps/gateway/src/gateway-proxy.service.ts`
  - `grep -n "latency" backend/apps/gateway/src/gateway-proxy.service.ts`
- 预期结果
  - 透传 `x-request-id`，日志含 requestId 与延迟。
- 回滚动作
  - 删除 requestId/latency 增强逻辑，恢复旧日志。

### 阶段 F：构建验收

- 命令（先加载 nvm）
  - `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pnpm run build:agents`
  - `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pnpm run build:gateway`
  - `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && pnpm run build`
- 预期结果
  - `agents`、`gateway`、`legacy` 三个构建均通过。
- 回滚动作
  - 按失败点回退最近变更（优先路由/注入/路径调整）。

### 阶段 G：接口冒烟（联调环境）

- 命令
  - `curl -i http://localhost:3100/api/health`
  - `curl -i http://localhost:3100/api/agents`
  - `curl -i http://localhost:3100/api/tools`
  - `curl -i http://localhost:3100/api/meetings`
- 预期结果
  - `agents/tools` 正常经 gateway 转发到 agents。
  - `meetings` 正常经 gateway 转发到 legacy。
- 回滚动作
  - agents 异常：先回滚 gateway 分流；
  - legacy 异常：回滚第一批 client 接入点。
