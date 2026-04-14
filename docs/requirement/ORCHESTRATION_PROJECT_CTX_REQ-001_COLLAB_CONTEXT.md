# Requirement: ORCHESTRATION_PROJECT_CTX_REQ-001_COLLAB_CONTEXT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN](../plan/ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-15 |
| 最后更新 | 2026-04-15 |

## 2. 需求描述

### 2.1 背景

`OrchestrationCollaborationContext` 当前不包含任何项目相关字段。当 plan 绑定了特定项目时，agent 在执行任务过程中无法从 `collaborationContext` 获知当前任务属于哪个项目。

### 2.2 目标

在 `OrchestrationCollaborationContext` 类型和 `CollaborationContextFactory.orchestration()` 工厂中增加项目上下文字段，并在 `orchestration-execution-engine.service.ts` 构建 context 时注入 plan 的 `projectId` 及关联的项目信息。

### 2.3 验收条件

- [ ] `OrchestrationCollaborationContext` 类型增加 `projectId?`、`projectBinding?` 字段
- [ ] `CollaborationContextFactory.orchestration()` 接受并传递 `projectId`、`projectBinding`
- [ ] `orchestration-context.service.ts` 的 `buildOrchestrationCollaborationContext` 增加 `projectId` 参数
- [ ] `orchestration-execution-engine.service.ts` 在 `executeTaskNode` 和 `executeRunTaskNode` 中从 plan/task 获取 `projectId` 并传入 context
- [ ] `sessionContext` 中增加 `projectId` 和 `projectBinding` 字段传递给 agents app

## 3. 技术方案摘要

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/libs/contracts/src/collaboration-context.types.ts` | `OrchestrationCollaborationContext` 增加 `projectId?: string` 和 `projectBinding?: { localPath?: string; opencodeEndpointRef?: string; opencodeProjectPath?: string }` |
| `backend/libs/contracts/src/collaboration-context.factory.ts` | `orchestration()` 参数增加 `projectId?`、`projectBinding?` |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | `buildOrchestrationCollaborationContext` options 增加 `projectId?` 和 `projectBinding?` |
| `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | `executeTaskNode` / `executeRunTaskNode` 从 plan/task 读取 `projectId`，查 `ei_projects` 获取绑定信息，传入 collaborationContext 和 sessionContext |

### 影响范围

- **后端**：contracts lib、orchestration 模块
- **前端**：无
- **数据库**：无 schema 变更
- **API**：sessionContext 传输格式扩展

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

`projectBinding` 采用扁平结构嵌入 `collaborationContext`，确保 agent 侧的 `CollaborationContextBuilder` 能正确序列化为系统消息。
