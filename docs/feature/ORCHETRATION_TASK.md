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
- `production`：生产锁定（可运行，不可编辑，需解锁后才可修改）

> 说明：Plan 状态仅表示“编排容器状态”，执行过程与终态统一沉淀在 Run（`orchestration_runs.status`）中，不再复用 Plan 状态表达运行结果。

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

- 删除计划不再依赖 schedule 的 `planId` 绑定检查（Scheduler 已改为 Agent 消息投递模型）。
- 计划编排列表与计划详情均提供删除入口；点击删除先二次确认。
- 计划详情页面使用独立路由 `/orchestration/plans/:id`，支持从计划列表或定时服务列表跳转。
- 计划详情页点击“重新编排”先弹出 Planner 选择框，确认后按所选 Planner 覆盖当前任务结构并重排；执行中按钮显示 loading 并禁用重复触发。
- 重新编排接口改为异步受理：开始时先清空旧任务并将计划状态置为 `drafting`，随后通过 `plan.status.changed/plan.task.generated/plan.completed/plan.failed` 事件流式返回新任务，前端以 SSE 实时刷新任务列表并在断线时轮询兜底。
- 计划详情页支持一键复制任务清单为 Markdown（含计划信息、Prompt、任务列表、依赖/执行者/结果），复制成功提示“已复制到剪贴板”。
- 创建计划后前端自动跳转 `/orchestration/plans/:id`，并在详情页显示“任务生成中”；任务按 `plan.task.generated` 事件逐条展示，体验接近 step 流式输出。
- 计划详情页支持人工编辑任务：添加任务、删除任务、复制任务、上下移动重排、批量保存标题/描述/优先级/依赖关系变更。
- 计划详情页支持「发布生产 / 解锁编辑」：
  - `POST /orchestration/plans/:id/publish` 将计划切换为 `production` 并锁定编辑；
  - `POST /orchestration/plans/:id/unlock` 将计划恢复为 `planned` 并开放编辑。
- 计划详情页与计划列表详情抽屉将“任务依赖”收敛为低频操作弹窗：主区仅保留依赖摘要，点击“依赖设置”按钮后在弹窗内多选并确认。
- 计划详情页新增「任务设置 / 执行历史」双 Tab：模板任务编辑与 run 历史查看分区展示。
- 执行历史 Tab 支持最近一次 run 摘要、历史 run 列表（触发来源/状态筛选）和 run 明细抽屉（run + run task）。
- 计划执行支持取消运行：`POST /orchestration/runs/:runId/cancel`，前端在 Header / Run 历史 / Run 明细三处提供取消入口。
- 计划列表页中的详情抽屉任务区同步支持基础人工编辑能力，与计划详情页保持一致的增删改重排入口。
- 计划列表页中的详情抽屉已补齐 run 历史视图（双 Tab、run 列表筛选、run 明细抽屉），与 PlanDetail 信息架构保持一致。

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
- 异步任务会额外透传 `sessionContext.runtimeTaskType/runtimeChannelHint`，供 Agents Runtime 按任务类型在 `opencode/native` 间路由（编码类默认 OpenCode，研究/评审/外部动作默认 native）。

#### Orchestration 服务拆分（Plan D）

- `OrchestrationService` 已瘦身为 Facade：Controller 仍只依赖该入口，方法按领域委派到子 Service。
- 新增 7 个领域 Service（`plan-management`、`task-management`、`plan-execution`、`task-lifecycle`、`plan-stats`、`plan-event-stream`、`orchestration-context`）。
- 新增 `orchestration-execution-engine` 作为统一执行引擎层，承接 task node/run task node 主流程，保持零 API 变更与渐进迁移。
- 已完成第二阶段下沉：`plan-stats/plan-event-stream/orchestration-context` 迁移为独立实现；legacy 中 research/review/email 重复校验方法已删除，统一使用 `TaskOutputValidationService`。
- 已完成第二阶段增量迁移：`plan-management`（list/get/update/delete）、`plan-execution`（run history 查询）、`task-management`（listTasks）改为独立实现。
- 已继续下沉：`task-management` 的任务模板编辑能力（add/remove/update/reorder/batch/duplicate/draft）已独立实现，包含依赖环检测与运行中 plan 编辑保护。
- 已继续下沉：`task-lifecycle` 的运行态操作（`reassignTask/completeHumanTask/retryTask`）已独立实现，`debugTaskStep/executeStandaloneTask` 暂保留 legacy 委派。
- 已继续下沉：`plan-management` 的计划生成管线（`createPlanFromPrompt + generatePlanTasksAsync + replanPlan + replanPlanAsync`）已独立实现，支持异步建计划与重规划。
- 已继续下沉：`plan-execution` 的运行入口（`runPlan/runPlanAsync`）已独立实现，run 查询链路保持独立；当前仅 `executePlanRun` 仍委派 legacy。
- 已继续下沉：`task-lifecycle` 的 debug/standalone 入口（`debugTaskStep/executeStandaloneTask`）迁移到独立服务编排，任务节点执行仍复用 legacy 执行引擎私有实现。
- 已完成执行层入口迁移：`plan-execution` 的 `executePlanRun` 也已独立实现；当前 legacy 主要作为执行引擎私有能力复用层（task node/run node 实际执行）。
- 已新增 `orchestration-execution-engine` 适配层，统一封装 task node/run task node 执行调用，减少子 Service 对 legacy 私有方法的直接依赖。
- 已继续下沉执行引擎内部：`orchestration-execution-engine` 已独立实现 `executeRunTaskNode` 主流程（异步 Agent 任务等待、research/review/external 校验、run task 状态流转）。
- 已完成执行引擎核心下沉：`orchestration-execution-engine` 同步独立实现 `executeTaskNode` 主流程；各子 Service 已不再直接依赖 legacy service。
- `OrchestrationLegacyService` 已从模块运行时 Provider 移除，遗留文件已删除。
- `TaskClassificationService`、`TaskOutputValidationService`、`ExecutorSelectionService`、`PlanningContextService`、`SceneOptimizationService` 保持独立能力服务角色。

#### Planning Context Pipeline（计划编排上下文增强）

- 计划拆解前新增 Context Enrichment 阶段，为 Planner 提供决策所需的结构化上下文：
  - **Agent Discovery Instruction**：不再注入静态 Agent 清单；改为强制 Planner 在每轮决策前调用 `builtin.sys-mg.internal.agent-master.list-agents` 拉取实时列表，并基于工具过滤后再选执行者
  - **Requirement Detail**：通过 EI 服务获取关联需求的标题、描述、优先级、标签
  - **Planning Constraints**：从 Planner Agent 的 enabled skills 中提取 `planningRules` 约束规则和 skill content 中的约束性章节
- Planner Prompt 模板支持 `{{agentManifest}}`、`{{requirementDetail}}`、`{{planningConstraints}}` 变量；其中 `{{agentManifest}}` 现承载执行者发现规则而非静态列表
- 所有 context 提取均为 best-effort，失败不阻断计划创建
- 支持通过环境变量配置 Requirement 详情长度（`PLANNER_REQUIREMENT_DETAIL_MAX_LENGTH`）

#### Skill Planning Rules（技能级计划约束）

- `agent_skills` Schema 新增可选字段 `planningRules: PlanningRule[]`
- 每条 `PlanningRule` 定义：`type`（`task_count | forbidden_task_pattern | required_task_pattern | dependency_rule | description_quality`）+ `rule`（人类可读）+ `validate`（可选的正则或 JSON Schema）
- 约束注入流程：Planning Context Pipeline 从 Planner Agent 的 skills 中提取 planningRules → 格式化为 `{{planningConstraints}}` → 注入 Planner Prompt
- 输出后校验：Planner 返回 JSON 后，`validateAgainstSkillConstraints()` 逐条检查 task 是否违反 `forbidden_task_pattern`，违反的 task 被自动移除；`task_count` 超限的自动截断
- 安全兜底：若所有 task 被校验移除，回退到校验前的原始结果

#### SceneOptimizationRule（场景化后处理 Pipeline）

- 将原有硬编码的 email 依赖优化抽象为 `SceneOptimizationRule` 接口
- 内置两条规则：
  - `builtin:email`：邮件场景 draft → review → send 依赖链优化
  - `builtin:code_dev`：开发场景 design → implement → test 依赖链优化
- 支持运行时通过 `SceneOptimizationService.registerRule()` 动态注册新规则
- Task Description Quality Validator：检查 description 最小长度、文件路径模式覆盖率、禁止纯模板复述
- 所有 magic number 外置为环境变量（`PLANNER_MAX_TASKS`、`PLANNER_MAX_TITLE_LENGTH`、`PLANNER_MAX_DESCRIPTION_LENGTH`、`PLANNER_MIN_DESCRIPTION_LENGTH`、`EXECUTOR_WEIGHT_*`、`EXECUTOR_MIN_SCORE_THRESHOLD`）

#### Prompt Registry（会议/编排 Prompt 可运营）

- 新增 Prompt 模板集合：`prompt_templates`（字段：`scene/role/version/status/content/updatedBy/updatedAt`）。
- 新增 Prompt Resolver 统一解析优先级：`session override > DB(published) > Redis cache > code default`。
- `PlannerService` 已接入 Resolver：计划拆解 Prompt 可通过模板版本管理，不再仅依赖代码硬编码。
- 会议执行策略 Prompt 已接入 Resolver：meeting 场景的 system policy 支持模板化发布与回滚。
- 新增 Prompt 管理接口与前端页面，支持草稿、发布、回滚、版本对比与审计。
- Prompt 管理页新增“系统 Prompt 草稿创建”入口，支持新增 `scene + role` 模板组合。
- Prompt 管理页筛选项改为“基于数据库现有值”的下拉选择（`scene/role/status`），降低手输误筛。
- Prompt 模板新增 `description` 字段，用于标注模板作用与适用场景。
- Prompt 管理页新增“复制”能力：从既有版本回填所有字段，允许全量修改后保存为新草稿。
- Prompt 管理页新增“删除版本”能力：支持删除 `draft/archived`，保护 `published` 版本不可删。
- Prompt 管理页收敛为“列表优先”：版本列表提供图标化快捷操作（编辑/删除/复制/发布），编辑器与日志迁移至详情页。
- 版本列表发布操作支持按状态切换为“发布/取消发布”；详情页移除“回滚当前版本”按钮，仅保留编辑与发布。

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
- **增量编排二次校验**：`IncrementalPlanningService` 在 Planner 选定 agent 后会再次执行工具匹配校验，支持 `PLANNER_AGENT_SELECTION_MODE=trust|verify|override` 三档。
- **失败任务重设计**：增量编排支持 `action=redesign`，可在原失败任务上重分配执行者并重跑，避免失败后不断追加新任务。
- **双熔断计数器**：编排状态新增 `generationState.totalFailures` 与 `generationConfig.maxTotalFailures`，防止“中间伪成功”反复重置熔断。

#### 外部动作验证

- 检测任务是否为外部动作（如发送邮件）
- 要求 Agent 输出包含可验证的证明（EMAIL_SEND_PROOF）
- 缺少证明时自动转为人工审核

#### 研究任务验证

- 检测任务是否为研究类任务（city_population、generic_research）
- 要求输出包含 RESEARCH_EXECUTION_PROOF
- 验证输出结构化格式（JSON/表格/列表）及内容完整性
- inability 检测升级为正则词库，覆盖“我这边无法 / 当前会话没有 / 没有接入 / 缺少.*工具”等场景

#### 通用执行输出验证

- 所有 taskType 在执行成功前都会执行 `validateGeneralOutput()`。
- 统一拦截空输出、`TASK_INABILITY:`、以及中英文“无法执行/缺少工具”类 inability 信号。

#### 开发任务验证（warn/strict 可配置）

- 新增 `CODE_EXECUTION_PROOF` 校验分支。
- 检查 build/test/lint 执行证据、成功信号、代码变更证据。
- `CODE_VALIDATION_MODE=warn`（默认）：缺失证据写入 `runLogs.warn`，不阻断任务完成。
- `CODE_VALIDATION_MODE=strict`：缺失证据直接标记任务失败。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行主计划 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理主计划 |
| `ORCHESTRATION_TASK_OUTPUT_VALIDATION_FIX_PLAN.md` | Agent 输出校验修复方案（inability 拦截 + strict 模式） |
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化计划 |
| `ORCHESTRATION_OPTIMIZATION_PLAN.md` | 计划编排与定时服务优化 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造计划 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md` | 编排与调度去重复/职责边界重构计划 |
| `ORCHESTRATION_EXECUTOR_SELECTION_SKILL_ACTIVATION_PLAN.md` | 执行者能力路由重构 + Skill 渐进激活修复方案 |
| `MEETING_CONTEXT_OPTIMIZE_PLAN.md` | 会议上下文去噪与 Prompt Registry 能力建设计划 |
| `ORCHESTRATION_PLANNING_QUALITY_OPTIMIZATION_PLAN.md` | 编排计划质量优化方案（Context Pipeline + Skill Constraints + SceneOptimizationRule） |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md` | 会议编排执行开发沉淀 |
| `MCP_PROFILE_GOVERNANCE_MASTER_PLAN.md` | MCP Profile 治理开发沉淀 |
| `ORCHESTRATION_PAGE_OPTIMIZATION_PLAN.md` | 计划编排页面交互优化开发沉淀 |
| `ORCHESTRATION_OPTIMIZATION_DEVELOPMENT_SUMMARY.md` | 计划编排与定时服务优化开发沉淀 |
| `CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md` | CTO 日常研发工作流改造开发沉淀 |
| `AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_D_ORCHESTRATION_SCHEDULER_REFACTOR.md` | Plan D 开发沉淀 |
| `MEETING_CONTEXT_OPTIMIZE_PLAN.md` | Prompt Registry 与会议/编排 Prompt 可运营改造沉淀 |

### 技术/架构文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/MEETING_ORCHESTRATION_EXECUTION_TECHNICAL.md` | 会议编排执行技术设计（中文） |
| `technical/MCP_PROFILE_GOVERNANCE_TECHNICAL.md` | MCP Profile 治理技术设计（中文） |
| `api/agents-api.md` | 包含 orchestration_* 工具定义与调用方式 |
| `api/prompt-registry-api.md` | Prompt 模板管理接口（草稿/发布/回滚/diff/审计） |

---

## 3. 相关代码文件

### 后端 Orchestration 模块 (backend/src/modules/orchestration/)

| 文件 | 功能 |
|------|------|
| `orchestration.module.ts` | 模块装配与依赖注入 |
| `orchestration.controller.ts` | REST API 控制器 |
| `orchestration.service.ts` | Facade 委派层（对外 API 入口） |
| `services/orchestration-legacy.service.ts` | 兼容过渡层，承载原有完整编排实现 |
| `services/plan-management.service.ts` | Plan CRUD 与生命周期委派层 |
| `services/task-management.service.ts` | Task 模板 CRUD 与编辑委派层 |
| `services/plan-execution.service.ts` | 执行引擎与 Run 管理委派层 |
| `services/task-lifecycle.service.ts` | 任务运行时操作委派层 |
| `services/plan-stats.service.ts` | 状态计算与 Session 同步委派层 |
| `services/plan-event-stream.service.ts` | Plan SSE 事件流委派层 |
| `services/orchestration-context.service.ts` | 上下文构建与外部集成委派层 |
| `planner.service.ts` | 任务拆解服务（Agent 拆解 + 启发式兜底） |
| `services/task-classification.service.ts` | 任务分类能力 |
| `services/task-output-validation.service.ts` | 输出质量与证明校验能力 |
| `services/executor-selection.service.ts` | 执行者选择与能力匹配 |
| `services/planning-context.service.ts` | 计划编排上下文增强（Agent Manifest + Requirement Detail + Skill Constraints） |
| `services/scene-optimization.service.ts` | 场景化后处理 Pipeline（SceneOptimizationRule + Quality Validator） |

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
| POST | `/orchestration/plans/:planId/tasks` | 手动新增任务（支持插入位置） |
| PUT | `/orchestration/plans/:planId/tasks/reorder` | 批量重排任务顺序 |
| PUT | `/orchestration/plans/:planId/tasks/batch-update` | 批量更新多个任务 |
| POST | `/orchestration/plans/:planId/tasks/duplicate/:taskId` | 复制指定任务 |
| POST | `/orchestration/plans/:id/run` | 执行计划 |
| GET | `/orchestration/plans/:id/runs` | 获取计划执行历史（run 列表） |
| GET | `/orchestration/plans/:id/runs/latest` | 获取计划最近一次执行摘要 |
| GET | `/orchestration/runs/:runId` | 获取单次 run 详情 |
| GET | `/orchestration/runs/:runId/tasks` | 获取 run 下任务执行明细 |
| POST | `/orchestration/tasks/:id/reassign` | 重新分配任务 |
| POST | `/orchestration/tasks/:id/complete-human` | 人工完成任务 |
| POST | `/orchestration/tasks/:id/retry` | 重试失败任务 |
| POST | `/orchestration/tasks/:id/draft` | 更新任务草稿 |
| PATCH | `/orchestration/tasks/:taskId` | 完整更新任务（标题/描述/优先级/依赖/执行者） |
| DELETE | `/orchestration/tasks/:taskId` | 删除任务并清理下游依赖引用 |
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
