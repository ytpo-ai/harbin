# Plan: 编排计划项目上下文贯穿

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| 状态 | done |
| 优先级 | high |
| 创建日期 | 2026-04-15 |

## 2. 背景

当前编排计划（Orchestration Plan）支持在创建时绑定 `projectId`（指向 `ei_projects`），该 `projectId` 会正确继承到 task、run 等 MongoDB 文档。但在**实际执行任务时，`projectId` 及其关联的项目信息（`localPath`、`opencodeEndpointRef`、`opencodeProjectPath`）完全不会传递到 agent 执行环境**，导致：

1. **`collaborationContext`** 不包含 `projectId`，agent 无法感知当前任务属于哪个项目
2. **`requirement.create`** 等工具的 `projectId` / `localProjectId` 参数完全依赖 LLM 从 prompt 文本中提取，极度脆弱
3. **`repo_read`** 工具始终使用进程级 `AGENT_WORKSPACE_ROOT`，无法读取计划绑定项目的代码
4. **OpenCode 执行通道**使用 agent 静态配置的 `endpoint`/`projectDirectory`，不会切换到项目绑定的 OpenCode 实例
5. **Agent OpenCode session** 的 `directory` 不随项目切换，开发任务在错误的项目目录中执行

## 3. 目标

实现 **"plan.projectId → agent 执行环境"** 的完整上下文贯穿，使得：
- agent 在执行编排任务时，能感知并使用 plan 绑定项目的正确上下文
- 工具（`requirement.create`、`repo_read` 等）能自动获取正确的 `projectId` 和 `localProjectPath`
- OpenCode 执行通道能动态使用项目绑定的 OpenCode 实例和目录

## 4. 执行步骤

1. [x] REQ-001: `CollaborationContext` 增加项目上下文字段，orchestration-execution-engine 在构建 context 时注入 `projectId` + 项目信息
2. [x] REQ-002: `ToolExecutionContext` 增加项目上下文，`requirement.create` 等工具实现 `projectId` 自动注入
3. [x] REQ-003: agents app 增加 `ei_projects` 查询能力，agent-task.worker 从 sessionContext 提取 projectId 并解析项目的 OpenCode 绑定信息
4. [x] REQ-004: OpenCode session 的 `endpoint` 和 `projectDirectory` 支持根据项目绑定动态覆盖
5. [x] REQ-005: `planTaskContext` 自动注入 `projectId` 和 `localProjectPath`，`repo_read` 支持从 context 获取工作目录

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | CollaborationContext 增加项目上下文 + orchestration-engine 注入 | [链接](../requirement/ORCHESTRATION_PROJECT_CTX_REQ-001_COLLAB_CONTEXT.md) | draft |
| REQ-002 | ToolExecutionContext 增加项目上下文 + 工具自动注入 | [链接](../requirement/ORCHESTRATION_PROJECT_CTX_REQ-002_TOOL_CONTEXT.md) | draft |
| REQ-003 | agents app 增加 ei_projects 查询 + worker 解析项目 OpenCode 绑定 | [链接](../requirement/ORCHESTRATION_PROJECT_CTX_REQ-003_AGENT_PROJECT_LOOKUP.md) | draft |
| REQ-004 | OpenCode session endpoint/directory 动态覆盖 | [链接](../requirement/ORCHESTRATION_PROJECT_CTX_REQ-004_OPENCODE_DYNAMIC_OVERRIDE.md) | draft |
| REQ-005 | planTaskContext 自动注入 + repo_read 工作目录适配 | [链接](../requirement/ORCHESTRATION_PROJECT_CTX_REQ-005_TASK_CONTEXT_REPO.md) | draft |

## 6. 关键影响点

- **后端（主应用）**：`collaboration-context.types.ts`、`collaboration-context.factory.ts`、`orchestration-context.service.ts`、`orchestration-execution-engine.service.ts`、`plan-execution.service.ts`
- **后端（agents app）**：`agent.types.ts`、`agent-task.worker.ts`、`agent-executor.helpers.ts`、`tool-execution-context.type.ts`、`tool-execution-dispatcher.service.ts`、`engineering-requirement-tool-handler.service.ts`、`engineering-repo-tool-handler.service.ts`、OpenCode executor engines
- **数据库**：无 schema 变更（所需字段已存在于 `ei_projects` 和 `orchestration_plans`）
- **API**：`sessionContext` 传输增加 `projectId` + `projectBinding` 字段
- **前端**：无变更

## 7. 风险与依赖

- **跨模块依赖**：agents app 当前不访问 `ei_projects`，需要新增查询路径（内部 API 或共享 schema 注入）
- **优先级冲突**：agent 静态配置的 `endpoint` / `projectDirectory` 与项目绑定的值冲突时需要明确优先级规则
- **向后兼容**：无 `projectId` 的旧 plan 执行不受影响（所有新增字段均为 optional）
- **OpenCode session 复用**：切换 endpoint/directory 后现有 session 可能失效，需要确认 session 隔离策略

## 8. 备注

该 plan 解决的核心问题是：编排计划选择了特定项目后，执行时 agent 实际运行在正确的项目上下文中——包括正确的代码目录、正确的 OpenCode 实例、正确的 projectId 传递。

### 数据流改造目标

```
plan.projectId
  ├─→ task.projectId (已有 ✓)
  ├─→ run.projectId  (已有 ✓)
  └─→ agent 执行环境 (本次改造)
       ├─→ collaborationContext.projectId         → REQ-001
       ├─→ collaborationContext.projectBinding     → REQ-001
       ├─→ toolExecutionContext.projectId          → REQ-002
       ├─→ requirement.create 自动注入 projectId  → REQ-002
       ├─→ sessionContext.projectId                → REQ-003
       ├─→ AgentContext.projectBinding             → REQ-003
       ├─→ OpenCode endpoint 动态覆盖             → REQ-004
       ├─→ OpenCode directory 动态覆盖            → REQ-004
       ├─→ planTaskContext 自动注入 projectId      → REQ-005
       └─→ repo_read 使用正确的工作目录            → REQ-005
```
