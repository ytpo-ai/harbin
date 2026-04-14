# Requirement: ORCHESTRATION_PROJECT_CTX_REQ-002_TOOL_CONTEXT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 所属 Plan | [ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN](../plan/ORCHESTRATION_PROJECT_CONTEXT_PASSTHROUGH_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-15 |
| 最后更新 | 2026-04-15 |

## 2. 需求描述

### 2.1 背景

`ToolExecutionContext` 当前不包含 `projectId`，导致 `requirement.create` 等工具只能依赖 LLM 在 tool call 参数中显式传入 `projectId`，这非常脆弱且容易遗漏。对比 `updateRequirementStatus` 已经从 `collaborationContext.planId` 自动注入 `planId`，`createRequirement` 缺少类似的 `projectId` 自动注入逻辑。

### 2.2 目标

在 `ToolExecutionContext` 中增加项目上下文字段，使 `requirement.create` 等工具能自动从 context 获取 `projectId`，无需完全依赖 LLM 传参。

### 2.3 验收条件

- [ ] `ToolExecutionContext` 增加 `projectId?: string` 和 `localProjectPath?: string` 字段
- [ ] `tool-execution.service.ts` 构建 `ToolExecutionContext` 时从 `collaborationContext` 提取 `projectId`
- [ ] `engineering-requirement-tool-handler.service.ts` 的 `createRequirement` 方法增加 `projectId` 的 context fallback 逻辑：LLM 参数优先，缺失时从 `executionContext.projectId` 自动填充
- [ ] `tool-execution-dispatcher.service.ts` 确保将 `executionContext` 传递给所有需要 `projectId` 的工具

## 3. 技术方案摘要

### 改动文件

| 文件 | 改动 |
|------|------|
| `backend/apps/agents/src/modules/tools/tool-execution-context.type.ts` | 增加 `projectId?: string`、`localProjectPath?: string` |
| `backend/apps/agents/src/modules/tools/tool-execution.service.ts` | 构建 context 时从 `collaborationContext` 提取项目信息 |
| `backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts` | `createRequirement` 增加 `projectId` context fallback |
| `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts` | 确认 `executionContext` 传递完整性 |

### 影响范围

- **后端（agents app）**：工具上下文、需求工具
- **前端**：无
- **数据库**：无
- **API**：无

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

## 5. 备注

自动注入遵循 "LLM 显式参数 > context 自动填充 > 空" 的优先级，与 `planId` 的注入模式保持一致。
