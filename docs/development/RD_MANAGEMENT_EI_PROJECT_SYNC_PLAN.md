# RD Management EI Project Sync Development Summary

## 1. 背景

本次研发会话页改造目标是统一“Agent -> OpenCode 项目 -> EI 项目”的同步主链路，避免前端手工建项目导致数据源不一致。

## 2. 主要实现

### 2.1 数据模型与约束

- 复用 `rdproject` 结构，集合名调整为 `ei_projects`。
- 新增同步字段：`opencodeProjectId`、`syncedFromAgentId`、`createdBySync`。
- 增加幂等索引：
  - `syncedFromAgentId + opencodeProjectPath`
  - `syncedFromAgentId + opencodeProjectId`
- 后端禁止手工创建 EI 项目，仅允许同步链路创建。

### 2.2 同步接口

- 新增 `POST /rd-management/agents/:agentId/opencode/projects/sync`。
- 按 Agent 配置解析 `execution.projectDirectory / projectPath / projectDirectories` 作为同步范围。
- 同步返回 `created/updated/skipped` 统计，并回传 `endpointRef` 便于排障。

### 2.3 OpenCode 访问兼容

- 同步按 Agent 的 `execution.endpointRef` 拉取项目，不再固定走默认 endpoint。
- 修复 scope 匹配规则，避免根路径 `/`（global）误匹配。
- 为 SDK 空结果场景补充 HTTP fallback：
  - 项目：`GET /project`
  - 会话：`GET /session`、`GET /session?directory=...`
  - 会话详情：`GET /session/:id`

### 2.4 会话同步修复

- 按 `directory` 拉取会话，避免把 global 会话写入项目元数据。
- 增加 `GET /rd-management/opencode/sessions?directory=...`。

### 2.5 前端交互收敛

- 移除前端“创建 Session”入口。
- 顶部统一为：Agent 选择 + EI Project 选择 + 同步按钮。
- 移除“本地绑定 EI 项目”入口。
- 会话列表改为按当前项目路径请求；空 sessionId 时不再发错误请求。

## 3. 问题与修复记录

- 问题1：同步只出 `global`
  - 原因：scope 反向 `startsWith` 造成 `/` 误匹配。
  - 修复：仅允许“项目路径命中 scope”。

- 问题2：同一 Agent 在接口可见但同步结果为空
  - 原因：endpoint 来源与运行环境变量不一致。
  - 修复：优先使用 agent `endpointRef`，并回传 `endpointRef` 供验证。

- 问题3：`/opencode/sessions` 返回空
  - 原因：SDK `session.list` 在当前实例返回空。
  - 修复：新增 HTTP fallback 到 `/session`。

- 问题4：`/opencode/sessions/:id` 返回 404
  - 原因：SDK `session.get` 未命中。
  - 修复：新增 HTTP fallback 到 `/session/:id`。

## 4. 影响文件

- 后端：
  - `backend/src/modules/rd-management/rd-management.controller.ts`
  - `backend/src/modules/rd-management/rd-management.service.ts`
  - `backend/src/modules/rd-management/rd-management.module.ts`
  - `backend/src/modules/rd-management/opencode.service.ts`
  - `backend/src/modules/rd-management/dto/index.ts`
  - `backend/src/shared/schemas/rd-project.schema.ts`
- 前端：
  - `frontend/src/pages/RdConversation.tsx`
  - `frontend/src/services/rdConversationService.ts`

## 5. 验证结果

- `npm run build:backend` 通过。
- `npm run build:frontend` 通过。
- 核心接口验证：
  - `POST /rd-management/agents/:agentId/opencode/projects/sync`
  - `GET /rd-management/projects?syncedFromAgentId=...`
  - `GET /rd-management/opencode/sessions?directory=...`
  - `GET /rd-management/opencode/sessions/:id`
