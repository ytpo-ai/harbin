# Requirement: ORCHESTRATION_PROJECT_CTX_REQ-005_TASK_CONTEXT_REPO

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-005 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN](../plan/ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-15 |
| 最后更新 | 2026-04-15 |

## 2. 需求描述

### 2.1 背景

1. `planTaskContext`（`plan.metadata.taskContext`）当前不会自动包含 `projectId` 和 `localProjectPath`，这些信息需要 planner 在 phaseInitialize 时通过 tool call 手工写入
2. `repo_read` 工具使用进程级 `AGENT_WORKSPACE_ROOT` 确定工作目录，无法根据编排任务的项目上下文切换到正确的项目目录

### 2.2 目标

1. plan 执行创建 run 时，自动将 `projectId` 和 `localProjectPath` 注入 `run.metadata.taskContext`
2. `repo_read` 工具支持从 `ToolExecutionContext` 获取 `localProjectPath` 作为工作目录

### 2.3 验收条件

- [ ] `plan-execution.service.ts` 创建 run 时自动将 `projectId` 和 `localProjectPath` 合入 `run.metadata.taskContext`
- [ ] `engineering-repo-tool-handler.service.ts` 的 `resolveWorkspaceRoot` 支持从 `executionContext.localProjectPath` 获取工作目录
- [ ] `tool-execution-dispatcher.service.ts` 对 repo_read 的 dispatch 传递 `executionContext`
- [ ] 优先级：`executionContext.localProjectPath` > `AGENT_WORKSPACE_ROOT` > `cwd` 探测
- [ ] 无 `localProjectPath` 时行为完全不变

## 3. 技术方案摘要

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/src/modules/orchestration/services/plan-execution.service.ts` | 创建 run 时从 `ei_projects` 查询 `localPath`，自动写入 `run.metadata.taskContext` |
| `backend/apps/agents/src/modules/tools/builtin/engineering-repo-tool-handler.service.ts` | `resolveWorkspaceRoot` 增加 `executionContext.localProjectPath` 优先级；`executeRepoRead` 接受 `executionContext` 参数 |
| `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts` | `TOOL_ID__ENGINEERING_REPO_READ` dispatch 时传递 `executionContext` |

### 影响范围

- **后端（主应用）**：plan-execution.service
- **后端（agents app）**：repo tool handler、tool dispatcher
- **前端**：无
- **数据库**：无 schema 变更（`taskContext` 已是 `Record<string, any>`）
- **API**：无

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

## 5. 备注

- `planTaskContext` 的自动注入是**补充性**的，确保 LLM 在 prompt 层面也能看到正确的项目信息
- `repo_read` 的 `localProjectPath` 优先级低于 `AGENT_WORKSPACE_ROOT`，需要评估是否应该反转（项目绑定优先于进程全局配置）——建议项目绑定优先
