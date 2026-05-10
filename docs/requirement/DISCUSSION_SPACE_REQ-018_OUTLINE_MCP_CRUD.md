# Requirement: DISCUSSION_SPACE_REQ-018_OUTLINE_MCP_CRUD

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-018 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_MCP_CRUD_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_MCP_CRUD_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | in-review |
| 创建日期 | 2026-05-02 |
| 最后更新 | 2026-05-02 |

## 2. 需求描述

### 2.1 背景

项目 Owner 执行讨论大纲补充时，受通用 runtime 工具策略影响，容易偏离“直接产出章节条目”目标并进入工具权限阻塞分支。需要以 MCP 工具动作明确业务边界，稳定输出可入库大纲补充结果。

### 2.2 目标

1. 新增讨论大纲 MCP 工具，统一支持大纲 CRUD 与章节补充。
2. `enrich_section` 在 Owner 场景下稳定返回结构化知识条目 JSON。
3. 统一错误与降级语义，避免返回无关 blocked/澄清内容。
4. 复用 Discussion 模块现有能力，降低变更面。

### 2.3 验收条件

- [x] MCP 工具支持 `get_outline/create_section/update_section/delete_section/reorder_section/enrich_section/clear_enrichments`。
- [x] `enrich_section` 返回结构必须包含可入库条目（或明确 fallback reason），不得输出 tool_call/blocked 回执作为业务结果。
- [x] 项目 Owner 具备该工具可执行权限，且受 `projectId + spaceId` 边界约束。
- [x] 工具调用失败能返回标准错误码与可追踪日志字段（spaceId/sectionId/agentId/action/reason）。
- [x] 单测覆盖动作路由、权限拒绝、结果验收与 fallback 分支。

## 3. 技术方案摘要

在 agents tools 层新增 discussion-outline MCP handler，通过 dispatcher 路由到 Discussion Outline 业务服务方法；对 enrich 结果增加结构验收层，拒绝语义偏离结果并触发统一降级路径。

### 影响范围

- **后端**：`backend/apps/agents/src/modules/tools/`、`backend/src/modules/discussions/services/discussion-outline.service.ts`
- **前端**：无直接变更
- **数据库**：无 schema 变更
- **API**：新增工具动作入口（通过 `tools execute` 分发）

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-018_DEVELOPMENT.md) | 已完成 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 本需求不新增专用 Agent。
- 本需求不引入 `organizationId`。
