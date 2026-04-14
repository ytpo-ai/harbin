# Requirement: ORCHESTRATION_PROJECT_CTX_REQ-004_OPENCODE_DYNAMIC_OVERRIDE

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-004 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN](../plan/ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-15 |
| 最后更新 | 2026-04-15 |

## 2. 需求描述

### 2.1 背景

当前 agent 的 OpenCode endpoint 和 projectDirectory 完全由 `agent.config.execution` 静态配置决定。当 plan 绑定了特定项目（该项目有自己的 OpenCode 实例绑定 `opencodeEndpointRef` 和项目路径 `opencodeProjectPath`）时，agent 仍然使用自己的静态配置执行，导致开发任务在错误的 OpenCode 实例和错误的项目目录中运行。

### 2.2 目标

让 OpenCode 执行通道在编排任务执行时，能根据 plan 绑定项目的 OpenCode 信息动态覆盖 endpoint 和 projectDirectory。

### 2.3 验收条件

- [ ] `agent-task.worker.ts` 中 `opencodeRuntime` 的构建支持从 `projectBinding` 获取 `opencodeEndpointRef` 作为 endpoint 候选
- [ ] `resolveOpenCodeRuntimeOptions()` 增加 `project_binding_endpoint` 优先级层：位于 agent config 之后、serve runtime 之前
- [ ] OpenCode executor engine 中 `projectDirectory` / `directory` 支持从 `projectBinding.opencodeProjectPath` 获取，优先级：agent config > project binding > 无
- [ ] 无 `projectBinding` 时行为完全不变（向后兼容）
- [ ] 日志中记录 endpoint/directory 的实际来源（source tag），便于调试

## 3. 技术方案摘要

### endpoint 优先级（改造后）

```
agent.config.execution.endpoint          → agent_config_endpoint (最高)
agent.config.execution.endpointRef       → agent_config_endpoint_ref
projectBinding.opencodeEndpointRef       → project_binding_endpoint  ← 新增
context.opencodeRuntime.endpoint         → runtime_endpoint (serve router)
context.opencodeRuntime.endpointRef      → runtime_endpoint_ref
OPENCODE_SERVER_URL                      → env_default (最低)
```

### projectDirectory 优先级（改造后）

```
agent.config.execution.projectDirectory  → agent_config (最高)
projectBinding.opencodeProjectPath       → project_binding  ← 新增
无                                        → 无
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts` | `resolveOpenCodeRuntimeOptions` 增加 `projectBinding` 参数和对应优先级层 |
| `backend/apps/agents/src/modules/agents/executor-engines/opencode-streaming-agent-executor.engine.ts` | `projectDirectory` 读取增加 `projectBinding.opencodeProjectPath` fallback |
| `backend/apps/agents/src/modules/agents/executor-engines/opencode-agent-executor.engine.ts` | 同上 |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | `opencodeRuntime` 构建时合并 `projectBinding.opencodeEndpointRef` |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | `prepareExecution` / `resolveExecutionRoute` 传递 `projectBinding` |

### 影响范围

- **后端（agents app）**：executor helpers、executor engines、worker、executor service
- **前端**：无
- **数据库**：无
- **API**：无（projectBinding 在 REQ-003 中已通过 sessionContext 传递）

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

## 5. 备注

- agent config 的 endpoint 优先级最高，确保管理员显式指定的端点不被项目绑定覆盖
- 如果 agent 没有配置 endpoint/endpointRef，项目绑定的 `opencodeEndpointRef` 才生效
- session 隔离：不同 projectDirectory 的 session 天然隔离（OpenCode 按 directory 区分 session），无需额外处理
