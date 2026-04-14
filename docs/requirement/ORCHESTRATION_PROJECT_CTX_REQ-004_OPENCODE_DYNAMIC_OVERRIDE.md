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

让 OpenCode 执行通道在编排任务执行时，能根据 plan 绑定项目的 `opencodeProjectPath` 动态覆盖 `projectDirectory`。

> **关于 endpoint**：由于全局项目由全局 agent 执行、孵化项目由孵化项目 agent 执行，agent 自身 `config.execution.endpoint` 已天然匹配其服务的项目 OpenCode 实例，因此 **不需要** 从 projectBinding 动态覆盖 endpoint。

### 2.3 验收条件

- [ ] OpenCode executor engine 中 `projectDirectory` / `directory` 支持从 `projectBinding.opencodeProjectPath` 获取，优先级：agent config > project binding > 无
- [ ] 无 `projectBinding` 时行为完全不变（向后兼容）

## 3. 技术方案摘要

### endpoint 优先级（改造后）

```
agent.config.execution.projectDirectory  → agent_config (最高)
projectBinding.opencodeProjectPath       → project_binding  ← 新增
无                                        → 无
```

> endpoint 优先级不变，agent config endpoint 仍然决定使用哪个 OpenCode 实例。

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/apps/agents/src/modules/agents/executor-engines/opencode-streaming-agent-executor.engine.ts` | `projectDirectory` 读取增加 `projectBinding.opencodeProjectPath` fallback |
| `backend/apps/agents/src/modules/agents/executor-engines/opencode-agent-executor.engine.ts` | 同上 |

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
