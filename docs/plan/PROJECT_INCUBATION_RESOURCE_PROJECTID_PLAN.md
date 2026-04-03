# 项目孵化 - 资源 projectId 属性补充计划

> 状态：待执行
> 创建时间：2026-04-03

## 1. 背景

当前系统已具备 Agent 集群协作、任务编排、研发智能等核心能力，但各资源之间缺少项目维度的关联。里程碑2 要求实现**项目化孵化**能力，核心前提是在关键资源上补充 `projectId` 属性，使资源能够按项目隔离和聚合。

### 设计原则

1. **项目 = EI 模块的 RdProject**（`ei_projects` 集合），不新建独立项目实体
2. **每个项目拥有独立的 Agent 集群**，项目 Agent 全新创建，与全局 Agent 并存
3. **项目负责人由 Agent 担任**（leadership 级别），通过 `RdProject.managerAgentId` 指定
4. **agents 服务保持纯粹**：仅 Agent 本体加 `projectId`，Agent 衍生数据（session、memo、run、message 等）通过 `agentId` 推导项目归属，不侵入 agents 内部业务逻辑

## 2. 变更清单

### 2.1 P0 - 核心资源（必须）

| # | 资源 | Schema 文件 | 集合 | 变更内容 |
|---|------|------------|------|---------|
| 1 | **Agent** | `backend/apps/agents/src/schemas/agent.schema.ts` | `agents` | 新增 `projectId?: string`，可选字段，为空表示全局 Agent |
| 2 | **OrchestrationPlan** | `backend/src/shared/schemas/orchestration-plan.schema.ts` | `orchestration_plans` | 新增 `projectId?: string` |
| 3 | **EiRequirement** | `backend/apps/ei/src/schemas/ei-requirement.schema.ts` | `ei_requirements` | 新增 `projectId?: string`，与现有 `localProjectId` 并存，逐步统一 |
| 4 | **RdProject** | `backend/src/shared/schemas/ei-project.schema.ts` | `ei_projects` | 新增 `managerAgentId?: string`（项目负责人 Agent） |

### 2.2 P1 - 冗余字段（方便查询聚合）

| # | 资源 | Schema 文件 | 集合 | 变更内容 |
|---|------|------------|------|---------|
| 5 | **OrchestrationRun** | `backend/src/shared/schemas/orchestration-run.schema.ts` | `orchestration_runs` | 新增 `projectId?: string` |
| 6 | **OrchestrationTask** | `backend/src/shared/schemas/orchestration-task.schema.ts` | `orchestration_tasks` | 新增 `projectId?: string` |
| 7 | **Schedule** | `backend/src/shared/schemas/schedule.schema.ts` | `orchestration_schedules` | 新增 `projectId?: string` |
| 8 | **Meeting** | `backend/src/shared/schemas/meeting.schema.ts` | `meetings` | 新增 `projectId?: string` |

### 2.3 不加 projectId 的资源（通过 agentId 推导）

| 资源 | 集合 | 推导路径 |
|------|------|---------|
| AgentSession | `agent_sessions` | `agentId` → `agent.projectId` |
| AgentMemo | `agent_memos` | `agentId` → `agent.projectId` |
| AgentRun | `agent_runs` | `agentId` → `agent.projectId` |
| AgentMessage | `agent_messages` | `sessionId` → `agentId` → `agent.projectId` |
| AgentTask | `agent_tasks` | `agentId` → `agent.projectId` |
| AgentRunScore | `agent_run_scores` | `agentId` → `agent.projectId` |
| 其他 agents 域内数据 | — | 保持 agents 服务纯粹 |

## 3. 执行步骤

### Step 1: Schema 变更（P0）

1. `Agent` schema 新增 `projectId` 字段 + 索引
2. `OrchestrationPlan` schema 新增 `projectId` 字段 + 索引
3. `EiRequirement` schema 新增 `projectId` 字段 + 索引
4. `RdProject` schema 新增 `managerAgentId` 字段

### Step 2: Schema 变更（P1）

5. `OrchestrationRun` schema 新增 `projectId` 字段 + 索引
6. `OrchestrationTask` schema 新增 `projectId` 字段 + 索引
7. `Schedule` schema 新增 `projectId` 字段 + 索引
8. `Meeting` schema 新增 `projectId` 字段 + 索引

### Step 3: DTO / 接口层适配

9. 相关 DTO（创建/更新/查询）增加 `projectId` 入参
10. 列表查询接口支持 `projectId` 过滤
11. P1 资源在创建时从上层（如 Plan）自动继承 `projectId`

### Step 4: EiRequirement 字段统一

12. 新代码统一使用 `projectId`
13. 现有 `localProjectId` 保留兼容，后续迁移

## 4. 索引规划

| 集合 | 新增索引 | 用途 |
|------|---------|------|
| `agents` | `{ projectId: 1, isActive: 1 }` | 按项目查活跃 Agent |
| `orchestration_plans` | `{ projectId: 1, createdAt: -1 }` | 按项目查计划列表 |
| `orchestration_runs` | `{ projectId: 1, startedAt: -1 }` | 按项目查运行历史 |
| `orchestration_tasks` | `{ projectId: 1, status: 1 }` | 按项目统计任务 |
| `orchestration_schedules` | `{ projectId: 1, enabled: 1 }` | 按项目查调度 |
| `meetings` | `{ projectId: 1, createdAt: -1 }` | 按项目查会议 |
| `ei_requirements` | `{ projectId: 1, status: 1, updatedAt: -1 }` | 按项目查需求（复用现有 localProjectId 索引模式） |

## 5. 关键约束

- `projectId` 在所有资源上均为**可选字段**，为空表示全局/非项目资源
- Agent 的 `projectId` 一旦设置，其所有衍生数据自动归属该项目
- P1 资源的 `projectId` 为冗余字段，创建时从上层继承，不依赖运行时 lookup
- 不修改 agents 服务内部逻辑，仅在 schema 层面增加字段

## 6. 影响点

- **后端**: Schema 变更 + DTO 扩展 + 查询过滤
- **前端**: 列表页增加项目筛选（后续 plan）
- **API**: 创建/查询接口增加 `projectId` 参数
- **数据库**: 新增索引，历史数据 `projectId` 为空（兼容）
