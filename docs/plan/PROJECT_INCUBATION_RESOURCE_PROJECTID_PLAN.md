# 项目孵化 - 资源 projectId 属性补充 & 孵化项目管理

> 状态：执行中
> 创建时间：2026-04-03

## 1. 背景

当前系统已具备 Agent 集群协作、任务编排、研发智能等核心能力，但各资源之间缺少项目维度的关联。里程碑2 要求实现**项目化孵化**能力，核心前提是在关键资源上补充 `projectId` 属性，并新建独立的孵化项目管理能力。

### 设计原则

1. **孵化项目独立建表**（`incubation_projects`），与本地项目（`ei_projects`）分离，各自干净
2. **每个项目拥有独立的 Agent 集群**，项目 Agent 全新创建，与全局 Agent 并存
3. **项目负责人通过 Agent 的角色（leadership）+ projectId 推导**，不在项目表上冗余 managerAgentId
4. **agents 服务保持纯粹**：仅 Agent 本体加 `projectId`，Agent 衍生数据（session、memo、run、message 等）通过 `agentId` 推导项目归属，不侵入 agents 内部业务逻辑

## 2. 已完成 - Schema projectId 变更

### 2.1 P0 - 核心资源

| # | 资源 | Schema 文件 | 集合 | 变更内容 | 状态 |
|---|------|------------|------|---------|------|
| 1 | **Agent** | `backend/apps/agents/src/schemas/agent.schema.ts` | `agents` | 新增 `projectId?: string` + 索引 | ✅ |
| 2 | **OrchestrationPlan** | `backend/src/shared/schemas/orchestration-plan.schema.ts` | `orchestration_plans` | 新增 `projectId?: string` + 索引 | ✅ |
| 3 | **EiRequirement** | `backend/apps/ei/src/schemas/ei-requirement.schema.ts` | `ei_requirements` | 新增 `projectId?: string` + 索引 | ✅ |

### 2.2 P1 - 冗余字段

| # | 资源 | Schema 文件 | 集合 | 变更内容 | 状态 |
|---|------|------------|------|---------|------|
| 4 | **OrchestrationRun** | `backend/src/shared/schemas/orchestration-run.schema.ts` | `orchestration_runs` | 新增 `projectId?: string` + 索引 | ✅ |
| 5 | **OrchestrationTask** | `backend/src/shared/schemas/orchestration-task.schema.ts` | `orchestration_tasks` | 新增 `projectId?: string` + 索引 | ✅ |
| 6 | **Schedule** | `backend/src/shared/schemas/schedule.schema.ts` | `orchestration_schedules` | 新增 `projectId?: string` + 索引 | ✅ |
| 7 | **Meeting** | `backend/src/shared/schemas/meeting.schema.ts` | `meetings` | 新增 `projectId?: string` + 索引 | ✅ |

### 2.3 不加 projectId 的资源（通过 agentId 推导）

| 资源 | 集合 | 推导路径 |
|------|------|---------|
| AgentSession | `agent_sessions` | `agentId` → `agent.projectId` |
| AgentMemo | `agent_memos` | `agentId` → `agent.projectId` |
| AgentRun | `agent_runs` | `agentId` → `agent.projectId` |
| AgentMessage | `agent_messages` | `sessionId` → `agentId` → `agent.projectId` |
| AgentTask | `agent_tasks` | `agentId` → `agent.projectId` |
| AgentRunScore | `agent_run_scores` | `agentId` → `agent.projectId` |

## 3. 已完成 - 孵化项目独立建表

### 3.1 数据模型

独立集合 `incubation_projects`，与 `ei_projects`（本地项目/代码仓库管理）完全分离。

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string (required) | 项目名称 |
| `description` | string | 项目描述 |
| `goal` | string | 项目目标 |
| `status` | enum: active/paused/completed/archived | 项目状态 |
| `createdBy` | string | 创建者 Employee ID |
| `startDate` | Date | 开始时间 |
| `endDate` | Date | 结束时间 |
| `metadata` | object | 扩展元数据 |

项目负责人 Agent：通过 `agents` 集合中 `projectId = 本项目ID` 且 `tier = 'leadership'` 的 Agent 确定。

### 3.2 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/ei/incubation-projects` | 创建孵化项目 |
| GET | `/ei/incubation-projects` | 孵化项目列表（支持 status 过滤） |
| GET | `/ei/incubation-projects/:id` | 孵化项目详情 |
| PUT | `/ei/incubation-projects/:id` | 更新孵化项目 |
| DELETE | `/ei/incubation-projects/:id` | 删除孵化项目 |

### 3.3 新增文件

| 文件 | 说明 |
|------|------|
| `backend/apps/ei/src/schemas/incubation-project.schema.ts` | Schema 定义 |
| `backend/apps/ei/src/dto/incubation-project.dto.ts` | DTO（创建/更新/查询） |
| `backend/apps/ei/src/services/incubation-projects.service.ts` | Service（CRUD） |
| `backend/apps/ei/src/controllers/incubation-projects.controller.ts` | Controller（API 路由） |

## 4. 待完成

### Step 1: DTO / 接口层适配

- 各资源创建/查询 DTO 增加 `projectId` 入参
- 列表查询接口支持 `projectId` 过滤
- P1 资源创建时从上层（如 Plan）自动继承 `projectId`

### Step 2: 前端项目管理页扩展

- 项目管理页支持"本地项目"和"孵化项目"两种视图
- 孵化项目创建/编辑表单
- 孵化项目详情页（项目专属 Agent 列表、关联 Plan/需求等）

## 5. 索引规划

| 集合 | 新增索引 | 用途 |
|------|---------|------|
| `agents` | `{ projectId: 1, isActive: 1 }` | 按项目查活跃 Agent |
| `orchestration_plans` | `{ projectId: 1, createdAt: -1 }` | 按项目查计划列表 |
| `orchestration_runs` | `{ projectId: 1, startedAt: -1 }` | 按项目查运行历史 |
| `orchestration_tasks` | `{ projectId: 1, status: 1 }` | 按项目统计任务 |
| `orchestration_schedules` | `{ projectId: 1, enabled: 1 }` | 按项目查调度 |
| `meetings` | `{ projectId: 1, createdAt: -1 }` | 按项目查会议 |
| `ei_requirements` | `{ projectId: 1, status: 1, updatedAt: -1 }` | 按项目查需求 |
| `incubation_projects` | `{ status: 1, createdAt: -1 }` | 按状态查项目列表 |

## 6. 关键约束

- `projectId` 在所有资源上均为**可选字段**，为空表示全局/非项目资源
- Agent 的 `projectId` 一旦设置，其所有衍生数据自动归属该项目
- P1 资源的 `projectId` 为冗余字段，创建时从上层继承，不依赖运行时 lookup
- 不修改 agents 服务内部逻辑，仅在 schema 层面增加字段
- 孵化项目与本地项目（`ei_projects`）完全独立，互不影响
