# 项目孵化（Project Incubation）

## 1. 功能设计

### 1.1 目标

- 在研发智能（EI）中新增“孵化项目”概念，用 `projectId` 将 Agent、计划、需求、调度、会议等资源串联为同一项目上下文。
- 将孵化项目与本地项目（`ei_projects`）解耦：孵化项目使用独立集合 `incubation_projects`，避免语义混淆与数据耦合。
- 保持 Agents 服务职责纯粹：仅 Agent 本体持有 `projectId`，Agent 衍生数据通过 `agentId` 链路推导项目归属。
- 前端在主应用 `frontend/` 内完成项目管理能力扩展，不新增独立前端工程。

### 1.2 数据结构

#### 孵化项目主模型

- 集合：`incubation_projects`
- 关键字段：
  - `name`（必填）
  - `description`（可选）
  - `goal`（可选）
  - `status`：`active | paused | completed | archived`
  - `createdBy`（创建者 employeeId）
  - `startDate` / `endDate`
  - `metadata`
- 索引：`{ status: 1, createdAt: -1 }`、`{ createdBy: 1 }`
- 模板初始化字段：
  - `isTemplateInitialized`：是否已将模板目录初始化到绑定本地项目（默认 `false`）

#### projectId 归属策略

- 直接持有 `projectId` 的核心资源：
  - `agents`
  - `orchestration_plans`
  - `orchestration_runs`
  - `orchestration_tasks`
  - `orchestration_schedules`
  - `meetings`
  - `ei_requirements`
- 不新增 `projectId` 的衍生资源：
  - `agent_sessions` / `agent_memos` / `agent_runs` / `agent_messages` / `agent_tasks` / `agent_run_scores`
  - 均通过 `agentId -> agent.projectId` 推导归属。

### 1.3 核心逻辑

#### 后端能力

- 提供孵化项目 CRUD：`/ei/incubation-projects`
- 提供模板初始化能力：
  - `POST /ei/incubation-projects/:id/initialize-template`
  - 行为：将 `data/template/` 复制到孵化项目绑定的本地项目目录（仅复制缺失文件，不覆盖已有文件）
  - 前置条件：孵化项目需且仅需绑定一个本地项目，且本地目录可写
- 提供项目聚合查询：
  - `GET /ei/incubation-projects/:id/agents`
  - `GET /ei/incubation-projects/:id/plans`
  - `GET /ei/incubation-projects/:id/requirements`
  - `GET /ei/incubation-projects/:id/schedules`
  - `GET /ei/incubation-projects/:id/meetings`
  - `GET /ei/incubation-projects/:id/discussions`
  - `GET /ei/incubation-projects/:id/stats`
- 聚合统计中，Agent 数量通过 `AgentClientService` 跨服务查询；其余资源在 EI 内通过 shared schema 直接聚合查询。

#### 前端能力

- `项目管理` 页支持 Tab 切换：`本地项目` / `孵化项目`
- 孵化项目提供列表、搜索、状态筛选、分页、创建、编辑、删除。
- 孵化项目列表新增模板初始化状态展示与“初始化模板”按钮（未初始化时可触发）。
- 新增孵化项目详情页（`/ei/incubation/:id`）：展示概览统计与 `Agent/计划/调度/需求/讨论空间/数据看板` 分栏。
- Agent 创建弹窗与 Agent 列表支持按孵化项目关联/筛选，满足“全局 Agent 与项目 Agent 共存”模型。

### 1.4 关键约束

- `projectId` 为可选字段：为空表示全局资源。
- 负责人不在孵化项目表冗余存储，按 `agents(projectId + tier=leadership)`推导。
- 禁止新增或透传 `organizationId`。

---

## 2. 需求追溯

| Plan | Requirement | Development | Fix |
|------|------------|-------------|-----|
| [PROJECT_MANAGEMENT_LOCAL_PROJECT_PATH_UPDATE_PLAN](../plan/PROJECT_MANAGEMENT_LOCAL_PROJECT_PATH_UPDATE_PLAN.MD) | [PROJECT_INCUBATION_REQ-001_LOCAL_PROJECT_PATH_UPDATE](../requirement/PROJECT_INCUBATION_REQ-001_LOCAL_PROJECT_PATH_UPDATE.md) | [开发记录](../development/PROJECT_INCUBATION_REQ-001_DEVELOPMENT.md) | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-012 孵化项目与讨论空间聚合打通](../requirement/DISCUSSION_SPACE_REQ-012_INCUBATION_DISCUSSION_LINK.md) | [开发记录](../development/DISCUSSION_SPACE_REQ-012_DEVELOPMENT.md) | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-014 数据采集框架](../requirement/DISCUSSION_SPACE_REQ-014_DATA_COLLECTION_FRAMEWORK.md) | [开发记录](../development/DISCUSSION_SPACE_REQ-014_DEVELOPMENT.md) | — |
| [INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) | [REQ-015 数据讨论闭环协作](../requirement/DISCUSSION_SPACE_REQ-015_DATA_DISCUSSION_CLOSED_LOOP.md) | 待创建 | — |

## 3. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `docs/plan/PROJECT_INCUBATION_RESOURCE_PROJECTID_PLAN.md` | 项目孵化总体设计、分阶段实现与索引规划 |
| `docs/plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md` | 讨论空间行业观察协作闭环 Plan（Phase 0-4） |

### API 文档 (docs/api/)

| 文件 | 说明 |
|------|------|
| `docs/api/engineering-intelligence-api.md` | EI 模块对外接口总览（可继续补充孵化项目接口细节） |

---

## 4. 相关代码文件

### 后端代码

- `backend/apps/ei/src/schemas/incubation-project.schema.ts`
- `backend/apps/ei/src/dto/incubation-project.dto.ts`
- `backend/apps/ei/src/services/incubation-projects.service.ts`
- `backend/apps/ei/src/services/incubation-project-aggregation.service.ts`
- `backend/apps/ei/src/controllers/incubation-projects.controller.ts`
- `backend/apps/agents/src/schemas/agent.schema.ts`
- `backend/src/shared/schemas/orchestration-plan.schema.ts`
- `backend/src/shared/schemas/orchestration-run.schema.ts`
- `backend/src/shared/schemas/orchestration-task.schema.ts`
- `backend/src/shared/schemas/schedule.schema.ts`
- `backend/src/shared/schemas/meeting.schema.ts`
- `backend/apps/ei/src/schemas/ei-requirement.schema.ts`
- `backend/apps/ei/src/schemas/ei-data-source.schema.ts`
- `backend/apps/ei/src/schemas/ei-data-record.schema.ts`
- `backend/apps/ei/src/controllers/data-sources.controller.ts`
- `backend/apps/ei/src/controllers/data-records.controller.ts`
- `backend/apps/ei/src/services/ei-data-sources.service.ts`
- `backend/apps/ei/src/services/ei-data-records.service.ts`
- `backend/apps/agents/src/modules/tools/builtin/data-collection-tool-handler.service.ts`
- `backend/apps/agents/src/modules/tools/builtin-tool-definitions.ts`
- `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`

### 前端代码

- `frontend/src/pages/ProjectManagement.tsx`
- `frontend/src/pages/IncubationProjectDetail.tsx`
- `frontend/src/services/incubationProjectService.ts`
- `frontend/src/components/agents/CreateAgentModal.tsx`
- `frontend/src/pages/Agents.tsx`
- `frontend/src/components/agents/AgentListHeader.tsx`
- `frontend/src/App.tsx`
- `frontend/src/pages/DataDashboard.tsx`
- `frontend/src/services/dataCollectionService.ts`
