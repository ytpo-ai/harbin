# 会议上下文去噪与 Prompt Registry 能力建设开发总结

## 背景与目标

- 按 `docs/plan/MEETING_CONTEXT_OPTIMIZE_PLAN.md` 落地 Step2/Step3。
- 在不改变会议与计划编排主链路的前提下，让系统 Prompt 从“硬编码”升级为“可发布、可回滚、可审计”的运行时能力。

## 本次实现范围

### 1) Prompt Registry Resolver（Step2）

- 模板实体：`backend/src/shared/schemas/prompt-template.schema.ts`
  - 字段：`scene`、`role`、`version`、`status`、`content`、`updatedBy`、`updatedAt`
- Resolver：`backend/src/modules/prompt-registry/prompt-resolver.service.ts`
  - 解析优先级：`session override > DB(published) > Redis cache > code default`
  - Redis 缓存键：`prompt-registry:scene:{scene}:role:{role}:published`
  - 提供发布后缓存刷新能力：`refreshPublishedCache(scene, role)`

### 2) 会议场景接入 Resolver（Step2）

- 文件：`backend/apps/agents/src/modules/agents/agent.service.ts`
- 改造点：
  - 会议执行策略 system block 改为通过 Resolver 获取。
  - 支持 `teamContext.promptOverrides` 作为会话级覆盖来源。
  - system fingerprint snapshot 新增模板来源与版本信息，便于排障。

### 3) 计划编排场景接入 Resolver（Step2）

- 文件：`backend/src/modules/orchestration/planner.service.ts`
- 改造点：
  - Planner task decomposition prompt 改为模板解析。
  - 支持变量渲染：`{{prompt}}`、`{{mode}}`、`{{requirementScope}}`。
  - 模板缺少关键占位符时自动补齐兜底行，保证兼容旧模板内容。

### 4) Prompt 管理能力与发布链路（Step3）

- **归属修正**：Prompt Registry 管理能力归属 agents（非 legacy）。
- 后端（agents app）：
  - `backend/apps/agents/src/modules/prompt-registry/prompt-registry.controller.ts`
  - `backend/apps/agents/src/modules/prompt-registry/prompt-registry-admin.service.ts`
  - `backend/apps/agents/src/modules/prompt-registry/prompt-registry-admin.module.ts`
  - `backend/src/shared/schemas/prompt-template-audit.schema.ts`
- API 能力：
  - 模板列表、草稿保存、发布、回滚、版本对比（diff）、生效查询、审计查询。
  - 审计记录包含：操作者、时间、动作、版本、摘要。
- 网关转发：`/api/prompt-registry` 路由转发到 agents 服务（`backend/apps/gateway/src/gateway-proxy.service.ts`）。
- 前端管理页：
  - `frontend/src/pages/PromptRegistry.tsx`
  - `frontend/src/services/promptRegistryService.ts`
  - 路由与导航接入：`frontend/src/App.tsx`、`frontend/src/components/Layout.tsx`

## 验证结果

- 后端测试通过：
  - `npm test -- test/prompt-resolver.service.spec.ts test/prompt-registry-admin.service.spec.ts apps/agents/src/modules/agents/agent.service.spec.ts`
- 后端构建通过：
  - `npm run build:agents`
  - `npm run build`
  - `npm run build:gateway`
- 前端构建通过：
  - `cd frontend && npm run build`

## 风险与后续建议

- 当前 diff 为行级集合对比（统计与预览），后续可升级为更完整的有序 diff。
- 发布前校验（变量合法性/敏感词/格式规则）与 ReleaseGuard 仍需在 Step4 完成。
- 监控项（重复注入率、空响应次数、回执完整率、闭环轮次）建议在 Step4 同步落地。

## 关联文档

- 规划文档：`docs/plan/MEETING_CONTEXT_OPTIMIZE_PLAN.md`
- 功能文档：`docs/feature/ORCHETRATION_TASK.md`
- API 文档：`docs/api/prompt-registry-api.md`
