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
| `orchestration_tasks` | `orchestration-task.schema.ts` | 任务表，包含分配、执行结果、依赖关系与触发模式 (`mode=plan|schedule`) |
| `plan_sessions` | `orchestration-plan-session.schema.ts` | 会话聚合视图（任务状态快照） |

补充字段：

- `orchestration_tasks.requirementId?: ObjectId`：用于将编排任务与 EI 需求建立闭环关联。

#### OrchestrationPlan 状态

- `draft`：草稿
- `drafting`：编排中（任务流式生成）
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
2. 先创建 OrchestrationPlan 占位记录（`status=drafting`）并立即返回 `planId`
3. 后台异步调用 Planner 进行任务拆解（3-8 个子任务）
4. 每生成一个子任务即落库并更新 PlanSession/统计
5. 逐条推送计划事件（任务生成中/已生成）给前端
6. 全部任务生成后切换为 `planned`，失败则置为 `failed`

#### 计划管理约束

- 删除计划前会检查是否存在关联定时服务（`planId` 绑定的 schedule），存在则禁止删除。
- 计划编排列表与计划详情均提供删除入口；点击删除先二次确认，若计划已绑定 schedule 则提示“已绑定定时服务，无法删除”。
- 计划详情页面使用独立路由 `/orchestration/plans/:id`，支持从计划列表或定时服务列表跳转。
- 计划详情页点击“重新编排”先弹出 Planner 选择框，确认后按所选 Planner 覆盖当前任务结构并重排；执行中按钮显示 loading 并禁用重复触发。
- 重新编排接口改为异步受理：开始时先清空旧任务并将计划状态置为 `drafting`，随后通过 `plan.status.changed/plan.task.generated/plan.completed/plan.failed` 事件流式返回新任务，前端以 SSE 实时刷新任务列表并在断线时轮询兜底。
- 计划详情页支持一键复制任务清单为 Markdown（含计划信息、Prompt、任务列表、依赖/执行者/结果），复制成功提示“已复制到剪贴板”。
- 创建计划后前端自动跳转 `/orchestration/plans/:id`，并在详情页显示“任务生成中”；任务按 `plan.task.generated` 事件逐条展示，体验接近 step 流式输出。

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
4. 若计划关联 `requirementId`，计划启动/完成会触发需求状态 best-effort 回写。
5. 任务消息联动：发布任务生命周期事件（`task.created/task.status.changed/task.completed/task.exception/task.failed`），订阅方通过 Redis 消息分发链路接收通知；Agent 间协作沟通使用独立直发消息链路。

#### Agent 执行链路（异步化）

- Orchestration 在执行 `agent` 任务时改为提交 `Agent Task` 异步任务（`POST /agents/tasks`），不再同步阻塞等待 `executeTaskDetailed`。
- 编排侧优先通过 Agent Task SSE 事件流（`GET /agents/tasks/:taskId/events`）等待终态，异常时回退到状态查询（`GET /agents/tasks/:taskId`）轮询。
- 该改造避免计划编排请求被长耗时模型推理拖住，从链路层消除同步等待导致的 504 风险。

#### Orchestration 服务拆分（Plan D）

- `OrchestrationService` 聚焦流程编排，领域逻辑下沉到子服务：
  - `TaskClassificationService`
  - `TaskOutputValidationService`
  - `ExecutorSelectionService`
- 计划创建与重规划复用共享任务创建流程，减少重复实现。

#### 任务调试 MCP

- 新增 `orchestration_debug_task`（`builtin.sys-mg.mcp.orchestration.debug-task`）供 Agent 在会议编排上下文中直接调试单个任务。
- MCP 工具调用后会透传到 `POST /orchestration/tasks/:id/debug-run`，支持带草稿修改（`title/description`）与 `resetResult`。
- 返回结构包含执行状态、错误信息、最近日志与建议下一步动作，便于 Agent 自主继续编排。

#### 智能分配策略（能力路由 + Planner 锁定）

- **策略模式**：支持 `default` 与 `lock_to_planner` 两种分配策略。
- **锁定策略**：当 Prompt 命中强约束信号（如 `all tasks assigned to me`、`assignmentPolicy=lock_to_planner`）时，所有 plan task 直接分配给 `plannerAgentId`。
- **能力路由评分**：默认策略下基于 4 维评分选择执行者：角色匹配（40）+ 工具覆盖（30）+ 能力标签匹配（20）+ 关键词相关性（10）。
- **角色语义**：执行者选择会结合 `Agent.roleId` 与 `AgentRole.capabilities/tools`，不再仅依赖任务文本关键词。
- **工具硬门槛**：当任务声明 `requiredTools` 时，候选执行者必须覆盖必需工具，否则返回 `unassigned` 并给出缺失工具说明。
- **兜底策略**：无候选达到阈值时保留回退逻辑（优先员工可执行场景，否则回退首个活跃 Agent 或 `unassigned`）。

#### 外部动作验证

- 检测任务是否为外部动作（如发送邮件）
- 要求 Agent 输出包含可验证的证明（EMAIL_SEND_PROOF）
- 缺少证明时自动转为人工审核

#### 研究任务验证

- 检测任务是否为研究类任务（city_population、generic_research）
- 要求输出包含 RESEARCH_EXECUTION_PROOF
- 验证输出结构化格式（JSON/表格/列表）及内容完整性

#### 开发任务验证（warning 级）

- 新增 `CODE_EXECUTION_PROOF` 校验分支。
- 检查 build/test/lint 执行证据、成功信号、代码变更证据。
- 缺失证据只写入 `runLogs.warn`，不阻断任务完成。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行主计划 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理主计划 |
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化计划 |
| `ORCHESTRATION_OPTIMIZATION_PLAN.md` | 计划编排与定时服务优化 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造计划 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md` | 编排与调度去重复/职责边界重构计划 |
| `ORCHESTRATION_EXECUTOR_SELECTION_SKILL_ACTIVATION_PLAN.md` | 执行者能力路由重构 + Skill 渐进激活修复方案 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行开发沉淀 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理开发沉淀 |
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化开发沉淀 |
| `ORCHESTRATION_OPTIMIZATION_DEVELOPMENT_SUMMARY.md` | 计划编排与定时服务优化开发沉淀 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造开发沉淀 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md` | Plan D 开发沉淀 |

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
| `orchestration.service.ts` | 核心流程编排（计划管理、任务执行编排） |
| `planner.service.ts` | 任务拆解服务（Agent 拆解 + 启发式兜底） |
| `services/task-classification.service.ts` | 任务分类能力 |
| `services/task-output-validation.service.ts` | 输出质量与证明校验能力 |
| `services/executor-selection.service.ts` | 执行者选择与能力匹配 |

> 注意：原有的 `session-manager.service.ts` 已移除，会话管理已迁移到 `apps/agents` 侧的 AgentSession。

### 后端 Schema (backend/src/shared/schemas/)

| 文件 | 功能 |
|------|------|
| `orchestration-plan.schema.ts` | 计划数据模型 |
| `orchestration-task.schema.ts` | 任务数据模型 |
| `orchestration-plan-session.schema.ts` | 会话聚合视图模型 |

### 前端 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `services/orchestrationService.ts` | API 调用服务与类型定义 |
| `pages/PlanDetail.tsx` | 计划详情独立页面 |

### Agent 集成 (backend/apps/agents/src/modules/agents/)

| 文件 | 功能 |
|------|------|
| `agent.service.ts` | orchestration_* 工具注册与意图识别 |

### 消息协作集成 (backend/src/modules/inner-message/)

| 文件 | 功能 |
|------|------|
| `inner-message.service.ts` | 消息落库、订阅匹配、分发入队 |
| `inner-message-dispatcher.service.ts` | Redis 分发消费者与重试/死信处理 |

---

## 4. API 接口清单

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/orchestration/plans/from-prompt` | 从自然语言创建计划 |
| GET | `/orchestration/plans/:id/events` | 订阅计划事件流（SSE） |
| PATCH | `/orchestration/plans/:id` | 更新计划基础信息（标题/提示词/策略/元数据） |
| POST | `/orchestration/plans/:id/replan` | 覆盖当前计划任务并基于当前 prompt 重新编排 |
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
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行开发沉淀 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理开发沉淀 |
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化开发沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md` | 会议编排执行技术设计（中文） |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | MCP Profile 治理技术设计（中文） |
| `api/agents-api.md` | 包含 orchestration_* 工具定义与调用方式 |
