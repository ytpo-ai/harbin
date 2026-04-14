# Requirement: ORCHESTRATION_PROJECT_CTX_REQ-003_AGENT_PROJECT_LOOKUP

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-003 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN](../plan/ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-15 |
| 最后更新 | 2026-04-15 |

## 2. 需求描述

### 2.1 背景

agents app 当前完全不访问 `ei_projects` 数据。plan 的 `projectId` 虽然可以通过 `sessionContext` 传递到 agents app，但 worker 端无法将其解析为具体的项目信息（`localPath`、`opencodeEndpointRef`、`opencodeProjectPath`）。

### 2.2 目标

1. 在主应用的 `orchestration-execution-engine.service.ts` 中查询 `ei_projects`，将项目绑定信息打包到 `sessionContext` 中传递给 agents app
2. `agent-task.worker.ts` 从 `sessionContext` 提取 `projectId` 和 `projectBinding`，注入到 `AgentContext` 中

### 2.3 验收条件

- [ ] `orchestration-execution-engine.service.ts` 在执行任务时查询 `ei_projects`（通过 `projectId`），获取 `localPath`、`opencodeEndpointRef`、`opencodeProjectPath`
- [ ] 将 `projectBinding` 打包到 `sessionContext` 传递给 `createAsyncAgentTask`
- [ ] `AgentContext` 类型增加 `projectBinding?: { projectId?: string; localPath?: string; opencodeEndpointRef?: string; opencodeProjectPath?: string }` 字段
- [ ] `agent-task.worker.ts` 从 `task.sessionContext` 提取 `projectBinding` 并注入 `AgentContext`
- [ ] 无 `projectId` 的 plan 执行不受影响（向后兼容）

## 3. 技术方案摘要

### 设计选择

采用 **"主应用查询、序列化传递"** 方案，而非让 agents app 直接访问 `ei_projects`：
- 主应用已有 `ei_projects` schema 注入
- 避免在 agents app 中新增 MongoDB model 依赖
- `sessionContext` 已是 JSON 可序列化的传输通道

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | 增加 `resolveProjectBinding(projectId)` 方法，查询 `ei_projects` 并序列化绑定信息；在 `executeTaskNode` / `executeRunTaskNode` 的 `sessionContext` 中增加 `projectId` + `projectBinding` |
| `backend/apps/agents/src/modules/agents/agent.types.ts` | `AgentContext` 增加 `projectBinding?` 字段 |
| `backend/apps/agents/src/modules/agent-tasks/agent-task.worker.ts` | 从 `task.sessionContext` 提取 `projectBinding` 注入 `AgentContext` |

### 影响范围

- **后端（主应用）**：orchestration-execution-engine 需要注入 `ei_projects` model
- **后端（agents app）**：agent.types、agent-task.worker
- **前端**：无
- **数据库**：无 schema 变更
- **API**：sessionContext 传输格式扩展

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

## 5. 备注

`projectBinding` 是一个轻量级 DTO，只包含执行时需要的字段。查询结果可考虑在 plan 级别缓存，避免每个 task 重复查询。
