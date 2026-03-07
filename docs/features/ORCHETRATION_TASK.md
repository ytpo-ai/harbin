# 任务编排（Orchestration）

## 1. 功能设计

### 1.1 目标

- 提供基于自然语言需求自动拆解、执行、管理任务的能力
- 支持多种执行模式：顺序（sequential）、并行（parallel）、混合（hybrid）
- 实现任务的智能分配：根据任务类型自动分配给合适的 Agent 或员工处理
- 支持任务依赖管理、外部动作验证、人工审核节点
- 提供任务执行的可观测性（运行日志、状态跟踪）

### 1.2 数据结构

核心集合位于 `backend/src/shared/schemas/`：

| 集合 | Schema 文件 | 说明 |
|------|-------------|------|
| `orchestration_plans` | `orchestration-plan.schema.ts` | 计划主表，包含策略、统计、状态 |
| `orchestration_tasks` | `orchestration-task.schema.ts` | 任务表，包含分配、执行结果、依赖关系 |
| `plan_sessions` | `plan-session.schema.ts` | 会话聚合视图（任务状态快照） |

#### OrchestrationPlan 状态

- `draft`：草稿
- `planned`：已规划
- `running`：执行中
- `paused`：暂停（等待人工）
- `completed`：已完成
- `failed`：失败

#### OrchestrationTask 状态

- `pending`：待分配
- `assigned`：已分配
- `in_progress`：执行中
- `blocked`：阻塞
- `waiting_human`：等待人工处理
- `completed`：已完成
- `failed`：失败
- `cancelled`：已取消

### 1.3 核心逻辑

#### 计划创建流程

1. 用户输入自然语言需求（prompt）
2. Planner 服务调用 Agent 进行任务拆解（3-8 个子任务）
3. 生成 OrchestrationPlan 记录
4. 为每个子任务生成 OrchestrationTask 记录
5. 解析任务依赖关系
6. 智能选择执行者（Agent/Employee）

#### 执行模式

- **sequential**：按依赖顺序串行执行
- **parallel**：无依赖任务并行执行，有依赖按序执行
- **hybrid**：优先并行，必要时降级为顺序

#### 任务执行流程

1. 检查前置依赖是否全部完成
2. 根据 assignment 执行：
   - `agent`：调用 Agent 执行任务
   - `employee`：标记为 waiting_human，等待人工完成
   - `unassigned`：标记失败或等待人工
3. 任务完成后更新 Plan 统计

#### 智能分配策略

- **邮件任务**：优先分配具有邮件工具的 Agent，否则分配给员工
- **调研任务**：优先分配具有 websearch/webfetch 工具的 Agent
- **关键词匹配**：计算 Agent/Employee 与任务描述的关键词匹配度
- **兜底策略**：无匹配时使用第一个活跃 Agent

#### 外部动作验证

- 检测任务是否为外部动作（如发送邮件）
- 要求 Agent 输出包含可验证的证明（EMAIL_SEND_PROOF）
- 缺少证明时自动转为人工审核

#### 研究任务验证

- 检测任务是否为研究类任务（city_population、generic_research）
- 要求输出包含 RESEARCH_EXECUTION_PROOF
- 验证输出结构化格式（JSON/表格/列表）及内容完整性

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行主计划 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理主计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行开发沉淀 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理开发沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md` | 会议编排执行技术设计（中文） |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | MCP Profile 治理技术设计（中文） |
| `api/agents-api.md` | 包含 orchestration_* 工具定义与调用方式 |

---

## 3. 相关代码文件

### 后端 Orchestration 模块 (backend/src/modules/orchestration/)

| 文件 | 功能 |
|------|------|
| `orchestration.module.ts` | 模块装配与依赖注入 |
| `orchestration.controller.ts` | REST API 控制器 |
| `orchestration.service.ts` | 核心业务逻辑（计划管理、任务执行，智能分配） |
| `planner.service.ts` | 任务拆解服务（Agent 拆解 + 启发式兜底） |

> 注意：原有的 `session-manager.service.ts` 已移除，会话管理已迁移到 `apps/agents` 侧的 AgentSession。

### 后端 Schema (backend/src/shared/schemas/)

| 文件 | 功能 |
|------|------|
| `orchestration-plan.schema.ts` | 计划数据模型 |
| `orchestration-task.schema.ts` | 任务数据模型 |
| `plan-session.schema.ts` | 会话聚合视图模型 |

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `services/orchestrationService.ts` | API 调用服务与类型定义 |

### Agent 集成 (backend/apps/agents/src/modules/agents/)

| 文件 | 功能 |
|------|------|
| `agent.service.ts` | orchestration_* 工具注册与意图识别 |

---

## 4. API 接口清单

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/orchestration/plans/from-prompt` | 从自然语言创建计划 |
| GET | `/orchestration/plans` | 获取计划列表 |
| GET | `/orchestration/plans/:id` | 获取计划详情（含任务与 PlanSession） |
| DELETE | `/orchestration/plans/:id` | 删除计划 |
| GET | `/orchestration/plans/:id/tasks` | 获取计划下的任务列表 |
| POST | `/orchestration/plans/:id/run` | 执行计划 |
| POST | `/orchestration/tasks/:id/reassign` | 重新分配任务 |
| POST | `/orchestration/tasks/:id/complete-human` | 人工完成任务 |
| POST | `/orchestration/tasks/:id/retry` | 重试失败任务 |
| POST | `/orchestration/tasks/:id/draft` | 更新任务草稿 |
| POST | `/orchestration/tasks/:id/debug-run` | 调试任务步骤 |

> 注意：`/orchestration/sessions` 相关接口已废弃，会话管理已迁移到 `apps/agents` 侧的 AgentSession。

---

## 5. 相关文档索引

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行主计划 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理主计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行开发沉淀 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理开发沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md` | 会议编排执行技术设计（中文） |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | MCP Profile 治理技术设计（中文） |
| `api/agents-api.md` | 包含 orchestration_* 工具定义与调用方式 |
