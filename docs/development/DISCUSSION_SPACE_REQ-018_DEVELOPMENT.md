# Development: DISCUSSION_SPACE_REQ-018_DEVELOPMENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 关联 Requirement | [REQ-018](../requirement/DISCUSSION_SPACE_REQ-018_OUTLINE_MCP_CRUD.md) |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 所属 Plan | [DISCUSSION_SPACE_OUTLINE_MCP_CRUD_PLAN](../plan/DISCUSSION_SPACE_OUTLINE_MCP_CRUD_PLAN.md) |
| OpenCode Session | — |
| 开发日期 | 2026-05-02 |
| 状态 | 已完成 |

## 2. 实现摘要

- 在 agents 内新增 `discussion-outline.manage` MCP 工具，统一承接讨论大纲 CRUD、章节补充与清空补充动作。
- 新增 `DiscussionOutlineToolHandler`，通过 `InternalApiClient.callDiscussionApi` 复用现有 Discussion Outline API，并输出统一 envelope（`ok/action/data/error/trace`）。
- 对 `enrich_section` 增加严格结果验收：必须返回结构化条目或明确 `fallbackReason`，拒绝空业务结果。
- 新增 `projectId + spaceId` 边界校验与结构化错误码，补充日志字段（spaceId/sectionId/agentId/action/reason）。

## 3. 代码改动点

### 后端

| 文件 | 改动说明 |
|------|----------|
| `backend/apps/agents/src/modules/tools/builtin/discussion-outline-tool-handler.service.ts` | 新增讨论大纲 MCP handler，封装动作路由、边界校验、enrich 验收和统一返回结构 |
| `backend/apps/agents/src/modules/tools/builtin/discussion-outline-tool-handler.service.spec.ts` | 新增单测，覆盖成功、跨项目拒绝、fallback 分支、验收拒绝分支 |
| `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts` | 新增工具 ID：`builtin.engineering.mcp.discussion-outline.manage` |
| `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` | 注册工具定义、参数契约与提示词 |
| `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts` | 新增工具分发逻辑 |
| `backend/apps/agents/src/modules/tools/tool-execution-dispatcher.service.spec.ts` | 新增 dispatcher 路由单测 |
| `backend/apps/agents/src/modules/tools/internal-api-client.service.ts` | 新增 Discussion API 内部调用方法 |
| `backend/apps/agents/src/modules/tools/builtin/index.ts` | 导出新 handler |
| `backend/apps/agents/src/modules/tools/tool.module.ts` | 注册新 handler 到 module providers/exports |

### 前端

| 文件 | 改动说明 |
|------|----------|
| — | 无 |

### 数据库 / Schema

| 变更 | 说明 |
|------|------|
| — | 无 Schema 变更 |

## 4. 验证结果

- [x] 单元测试通过
- [x] Lint / TypeCheck 通过（本次执行了 ESLint 定向检查）
- [x] 功能验证通过
- 验证说明：
  - `pnpm test -- tool-execution-dispatcher.service.spec.ts discussion-outline-tool-handler.service.spec.ts`
  - `pnpm exec eslint apps/agents/src/modules/tools/builtin/discussion-outline-tool-handler.service.ts apps/agents/src/modules/tools/builtin/discussion-outline-tool-handler.service.spec.ts apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts apps/agents/src/modules/tools/tool-execution-dispatcher.service.spec.ts apps/agents/src/modules/tools/builtin-tool-catalog.ts apps/agents/src/modules/tools/builtin-tool-definitions.ts apps/agents/src/modules/tools/internal-api-client.service.ts apps/agents/src/modules/tools/builtin/index.ts apps/agents/src/modules/tools/tool.module.ts`

## 5. 踩坑记录

- enrich 结果在 runtime 异常时可能为空结构；为避免把阻塞/澄清文本当业务结果，最终在 handler 层统一增加“结构化 entries 或 fallbackReason”双通道验收。

## 6. 关联 Fix

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |
