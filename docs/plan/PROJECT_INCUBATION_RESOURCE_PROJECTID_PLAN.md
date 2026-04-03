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

### Phase 1: 后端接口层适配（projectId 流通）✅

#### 1.1 Agent 模块 ✅
- [x] Agent 共享类型 `Agent` 接口增加 `projectId` 属性
- [x] Agent 列表查询支持 `projectId` 过滤（全局 Agent 查 projectId 为空，项目 Agent 按 projectId 查）
- [x] Agent 详情接口返回 `projectId` 字段（通过 schema 自动返回）
- [x] `AgentClientService` HTTP 客户端支持 `projectId` 过滤参数透传

#### 1.2 编排模块 ✅
- [x] `CreatePlanFromPromptDto` 增加 `projectId` 入参
- [x] Plan 列表查询增加 `projectId` 过滤（Service + Controller）
- [x] Run 创建时自动从 Plan 继承 `projectId`（executePlanRun + incremental planning）
- [x] Task 创建时自动从 Plan 继承 `projectId`（addTaskToPlan + duplicateTask + incremental planning）
- [x] Schedule 创建/更新 DTO 增加 `projectId` 入参
- [x] Schedule 列表查询增加 `projectId` 过滤

#### 1.3 会议模块 ✅
- [x] Meeting 创建 DTO 增加 `projectId` 入参
- [x] Meeting 列表查询增加 `projectId` 过滤

#### 1.4 需求模块 ✅
- [x] EiRequirement 创建时支持传入 `projectId`（与 `localProjectId` 并存，逐步统一）
- [x] EiRequirement 列表查询增加 `projectId` 过滤

### Phase 2: 孵化项目详情接口（聚合查询）✅

- [x] `GET /ei/incubation-projects/:id/agents` -- 查询项目专属 Agent 列表（通过 AgentClientService HTTP 调用）
- [x] `GET /ei/incubation-projects/:id/plans` -- 查询项目关联的编排计划
- [x] `GET /ei/incubation-projects/:id/requirements` -- 查询项目关联的需求
- [x] `GET /ei/incubation-projects/:id/schedules` -- 查询项目关联的定时调度
- [x] `GET /ei/incubation-projects/:id/meetings` -- 查询项目关联的会议
- [x] `GET /ei/incubation-projects/:id/stats` -- 项目概览统计（Agent 数量、Plan 数量、运行次数、需求状态分布等）

#### Phase 2 新增文件
| 文件 | 说明 |
|------|------|
| `backend/apps/ei/src/services/incubation-project-aggregation.service.ts` | 聚合查询 Service |

#### Phase 2 数据访问方式
| 数据 | 访问方式 | 说明 |
|------|---------|------|
| Agents | AgentClientService HTTP | EI → Agents 服务的 `/api/agents?projectId=xxx` |
| Plans / Runs / Tasks / Schedules / Meetings | Mongoose 直接查询 | EI app.module.ts 注册 shared schema，共享 MongoDB 直接查询 |
| Requirements | Mongoose 直接查询 | EI 自有 schema |

### Phase 3: 前端 - 项目管理页扩展

#### 3.1 项目列表页改造
- [ ] 项目管理页顶部增加 Tab 切换：「本地项目」/「孵化项目」
- [ ] 孵化项目列表展示：名称、目标、状态、Agent 数量、Plan 数量、创建时间
- [ ] 孵化项目创建弹窗：名称（必填）、描述、目标、起止时间
- [ ] 孵化项目编辑/删除操作

#### 3.2 孵化项目详情页
- [ ] 项目概览卡片（名称、目标、状态、起止时间、统计数据）
- [ ] 项目专属 Agent 列表 Tab（展示项目内所有 Agent，标识负责人 = leadership 角色）
- [ ] 项目 Plan 列表 Tab（展示项目内所有编排计划及运行状态）
- [ ] 项目需求列表 Tab（展示项目关联的需求）
- [ ] 项目定时调度 Tab（展示项目内的 Schedule）

#### 3.3 项目上下文联动
- [ ] Agent 创建弹窗增加「所属项目」选择器（可选，为空则创建全局 Agent）
- [ ] Plan 创建弹窗增加「所属项目」选择器
- [ ] 从孵化项目详情页内创建 Agent / Plan 时自动填充 projectId
- [ ] 前端 Agent 列表页增加项目筛选器（全局 / 某项目）

### Phase 4: 项目级能力增强（后续迭代）

#### 4.1 项目级知识沉淀
- [ ] 项目 Agent 的 Memo 天然按项目隔离（通过 agentId 推导）
- [ ] 考虑项目级别的跨 Agent 知识共享机制（项目内 Agent 间的 Memo 可见性策略）

#### 4.2 项目生命周期管理
- [ ] 项目归档时的资源处理策略（Agent 停用、Schedule 暂停、进行中 Plan 处理）
- [ ] 项目复制/模板化（从已完成项目快速创建相似结构的新项目）

#### 4.3 项目与 Scheduler 集成
- [ ] 支持在孵化项目内创建周期性调度（如每日数据采集、每周竞品报告）
- [ ] 调度执行结果自动关联回项目

#### 4.4 项目子分类（按需）
- [ ] 根据实际孵化场景补充 `category` 字段（web3_data / competitor_analysis / rd_project 等）
- [ ] 不同分类可绑定不同的默认 Agent 角色模板和 Plan 模板

#### 4.5 EiRequirement 字段统一
- [ ] 新代码统一使用 `projectId`
- [ ] 现有 `localProjectId` 数据迁移至 `projectId`
- [ ] 迁移完成后废弃 `localProjectId`

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

## 7. 推荐执行顺序

```
Phase 1（接口层适配）→ Phase 2（聚合查询）→ Phase 3（前端）→ Phase 4（能力增强）
```

- Phase 1 和 Phase 2 可并行推进，Phase 1 优先做 Agent + Plan 的 projectId 流通
- Phase 3 依赖 Phase 1/2 的接口就绪
- Phase 4 为后续迭代，按实际孵化场景按需推进
