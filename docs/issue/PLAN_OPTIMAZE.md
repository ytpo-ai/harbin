# 优化系统提示词优化

此文档是我们执行问题交互的追踪文档，目标会随着问题结局而变化，我会在必要时更新。

## 目标
优化系统提示词以及计划执行Prompt的设计，注入时机和注入条件。（以已部分实现，但不彻底）
当前通过计划编排任务继续优化


## 当前需要解决的问题
1. 在计划编排过程，Agent的输出不稳定，导致计划编排失败率较高。 → 
2. 当前Prompt设计不够合理，导致不必要的注入污染上下文。
3. Prompt注入条件和时机需要更完善的设计。

## 测试token
Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbXBsb3llZUlkIjoiMzViODhhODMtOTBjZS00MDMyLWExOGMtMDc5ZDg4Y2ExOWYwIiwiZW1haWwiOiJhZG1pbkBhaS10ZWFtLmNvbSIsImV4cCI6MTc3NTMyNzUxNzQ5OX0.GRUEBP2KtmzcMnx3r1e52vXhLnFFr_9dPAsBIer7eSY

## 必读（先统一认知）

以下是本次任务的主要参考文档，必要时阅读：

1. `docs/guide/TEST_GUIDELINE.MD`


### 过程中几个约束
- 由于已完成的工作文档比较多，只有在必要时才阅读相关文档内容
- 执行过程要慢慢来，更多的交互，询问我的意见，而不是一次性输出最终结果
- 优先 ORCH_STEP_DISPATCHER_ENABLED=true，步骤调度器以步骤调度器的方式触发
- 必要时 可直接自己构造 LLM Conext，通过结构以某Agent的身份提交给LLM provider， 来测试提示词效果，验证设计合理性


## 计划编排修复总共经历了以下几个 session

### 计划编排-fix1：14dor
#### 这个session中主要是发现或者处理以下问题：
1. 初始问题是任务生成不连续，第一个任务后就停掉了，在测试中发现任务生成 走的是 executePlanningUntilDone递归
2. 首步豁免和执行命令指令有部分冲突

#### 追溯文档：
docs/issue/fix/2026-03-28-orchestration-plan-first-step-failure-investigation.md 
这是针对计划编排首步失败的完整追溯分析，包含了问题现象、根因分析和代码链路梳理，非常有助于理解当前问题的症结所在。

#### 总结
这个session没有实际性解决什么问题

### 计划编排-fix2：3.5dor
#### 这个session中主要是发现或者处理以下问题：
1. 计划编排生成下一步过程，并没有实质的执行

#### 追溯文档：
docs/issue/fix/2026-03-28-orchestration-step3-no-response-regression.md

#### 总结
经过测试分析，基本确定是planner task生成过程返回的task json不稳定，经常被解析失败，导致后续执行流程无法继续。

### 计划编排-fix3：23dor
#### 这个session中主要是发现或者处理以下问题：
1. eventSream 返回 planning.* 和前端监听 plan不一致
2. tryBackfillRequirementId 条件判断
3. runtimeTaskType 推断
4. task 生成返回 不标准，无法正确解析

#### 追溯文档：
docs/issue/fix/2026-03-28-orchestration-plan-generation-sse-and-planner-fixes.md 这是针对计划编排过程中发现的 SSE 连接问题和 Planner Agent 输出不稳定问题的修复记录，包含了具体的代码修改和验证结果。


### 计划编排-fix4：7.4dor
#### 这个session中主要是发现或者处理以下问题：
1. 主要解决的是 requirementId 填入问题

#### 追溯文档：
docs/issue/fix/2026-03-28-replan-requirementid-lost-in-planner-context.md

### 计划编排-fix5：13dor
#### 这个session中主要是发现或者处理以下问题：
1. 主要解决的是 skill 注入导致的 planner 输出不稳定问题
3. agent 输出确认收到 之类的确认信息

#### 追溯文档：
7. docs/issue/fix/2026-03-28-planner-skill-injection-causes-confirmation-output.md 
这是针对 Skill 注入策略过于宽泛及注入措辞触发 Agent 确认性输出的完整追溯，
包含了 
- skillActivation 可配置模式的设计实现
- 弃用 planner 强制激活所有 planning/orchestration/guard/planner
- 修改了 prompt 触发 LLM输出确认 语句

### 计划编排-fix6：7.7dor
#### 这个session中主要是发现或者处理以下问题：
1. collaborationContext 规范化及3个调用点

#### 追溯文档：
docs/issue/fix/2026-03-28-collaboration-context-scenario-driven-refactor.md
场景化重构 + JSON 输出双重强制的完整修复记录。

### 计划编排-fix7：20dor
#### 这个session中主要是发现或者处理以下问题：
1. 针对palnner任务生成不准确，改成使用工具执行任务创建和任务执行状态检查

#### 追溯文档：
docs/issue/fix/2026-03-29-development-plan-task-generation-skill-driven.md


### 计划编排-fix8：19dor
#### 这个session中主要是发现或者处理以下问题：
1. submit-task 500

#### 追溯文档：
docs/issue/fix/2026-03-29-planner-planid-hallucination-json-parse-multi-submit.md 
Planner planId 幻觉 + JSON 解析失败 + 多任务批量提交的完整追溯流程，包含 6 个阶段的问题排查过程、三层纵深防御修复方案、4 次计划的验证对比。


## 已完成内容概括

### #10 roleInPlan 交叉赋值修复 + Initialize 三层纵深防御（2026-03-30）

**问题**：计划在 phaseInitialize 阶段就执行了任务生成（submit-task），LLM 混淆 initialize 和 generating 阶段职责。根因有三层叠加：

1. **roleInPlan 交叉赋值 bug**：`initializePlan()` 赋值 `'planner'`，`generateNextTask()` 赋值 `'planner_initialize'`，二者反了。导致 initialize 阶段 submit-task 没有硬拦截（tool handler 检查 `roleInPlan === 'planner_initialize'` 不命中），generating 阶段 submit-task 反而被误拦截。
2. **Initialize 重试复用同一 session**：`PLANNER_SESSION_ISOLATION_MODE=isolated` 生效，但失败重试时 `ensurePlannerSession` 发现 `plannerSessionIds.initialize` 已有值直接复用旧 session，LLM 看到前一轮的工具调用结果和确认文本后误认为 initialize 已完成，跳到 generating 行为。
3. **text-only retry 纠正指令不够精确**：通用的"请输出 tool_call"没有告知 LLM 当前在 phaseInitialize 阶段，LLM retry 后调了 submit-task 而非继续 initialize 工具序列。

**修复摘要**（四项变更，4 个文件）：

**roleInPlan 交叉赋值修复**：
- `planner.service.ts`：`initializePlan()` roleInPlan `'planner'` → `'planner_initialize'`；`generateNextTask()` roleInPlan `'planner_initialize'` → `'planner'`

**Initialize 失败重试 session 隔离**：
- `orchestration-step-dispatcher.service.ts`：`phaseInitialize` 失败分支归档旧 session + 清除 `plannerSessionIds.initialize`，重试时创建全新 session 避免上下文污染

**text-only retry 纠正指令 initialize 特化**：
- `agent-executor.service.ts`：当 `roleInPlan === 'planner_initialize'` 时，纠正指令明确说明"当前是 phaseInitialize 阶段"，要求继续未完成的工具调用序列或输出最终 JSON，严禁 submit-task

**submit-task 拦截消息引导输出 JSON**：
- `orchestration-tool-handler.service.ts`：initialize 阶段 submit-task 被拦截时，错误消息明确告知"你处于 phaseInitialize 阶段，不是 generating 阶段"，给出最终 JSON 的具体格式引导

**initializePlan 纯文本降级提取**：
- `planner.service.ts`：新增 `extractInitializeFieldsFromText()`，当 `tryParseJson` 失败时通过正则从纯文本中提取 `req-xxx` 格式的 requirementId 和标题，配合 default outline 返回，避免直接进入失败重试循环

**防御层次**：
1. **硬拦截层**：roleInPlan 修正后 submit-task 在 initialize 阶段被 tool handler 硬拦截
2. **prompt 引导层**：text-only retry 特化指令 + submit-task 拦截消息 → 引导 LLM 回到正确路径
3. **解析降级层**：即使 LLM 始终不输出 JSON，也能从文本中提取 requirementId，不进入失败循环
4. **session 隔离层**：即使失败重试，也使用干净 session，不受历史上下文污染

---

### #9 Planner Session 隔离 + Skill phaseInitialize 裁剪 + 纯文本 Retry（2026-03-30）

**问题**：Planner 四个阶段（initialize/generating/pre_execute/post_execute）共用一个 agent session，导致上下文污染；同时 rd-workflow skill 的 phaseInitialize 段落通过 system messages 注入到所有阶段，误导 planner 在 generating/pre_execute 阶段执行 requirement.list 等 initialize 指令。

**修复摘要**：

**Session 隔离**（可配置，`PLANNER_SESSION_ISOLATION_MODE=shared|isolated`）：
- `orchestration-step-dispatcher.service.ts`：修复 `phaseInitialize`/`phaseGenerate` 中 `plannerSessionId` 硬编码为 `withPlannerSession()` 调用
- `orchestration-plan.schema.ts`：`plannerSessionIds` 字段注释

**Skill phaseInitialize 段落裁剪**：
- `toolset-context.builder.ts`：新增 `stripPhaseInitializeSectionIfNeeded()`，当 `roleInPlan` 以 `planner` 开头时从 skill 内容中移除 phaseInitialize 段落

**Prompt 阶段隔离声明**（4 个阶段）：
- `planner.service.ts`：generating prompt 加阶段隔离声明 + initialize prompt 加反确认约束
- `orchestration-context.service.ts`：pre_execute / post_execute prompt 加阶段隔离声明

**Planner 纯文本 Retry**：
- `agent-executor.service.ts`：新增 `isPlannerTextOnlyRetryNeeded()`，当 planner 输出纯文本时注入纠正指令 retry 一次

**验证结果**：generating 阶段成功调用 submit-task 生成任务（totalGenerated=1），skill 裁剪生效，retry 机制触发。initialize 阶段 LLM 行为仍不稳定（待跟进 #18）。

**关联文档**：
- Fix: `docs/issue/fix/2026-03-30-planner-session-isolation-and-skill-phase-stripping.md`
- Plan: `docs/plan/PLANNER_SESSION_ISOLATION_MODE_PLAN.md`
- Commit: `f56c325`

---

### #6 Capability-aware routing + post_execute prompt 重构 + pre_execute outline actions（2026-03-29~30）

**问题**：计划 `69c91a02` 和 `69c93a37` 的全链路测试暴露了 3 个编排问题：
1. **P0 — executor 分配不准**：step1(development.plan) 被分配给 Coder-Van（development.exec 能力）而非 Docter-W（development.plan 能力），根因是 fallback routing 缺失 `requiredCapabilities`，且 capability gate 被后续评分维度覆盖
2. **P1 — post_execute 误判 stop**：Planner 在 post_execute 阶段声称"缺少执行结果"返回 stop，实际 executionOutput 已注入 prompt 但 LLM 未正确识别（大段文本边界模糊 + "必须调工具"与 tryParseJson 矛盾）
3. **P2 — pre_execute 需求状态未更新**：rd-workflow 要求 step1 pre_execute 更新需求为 in_progress，但 prompt 未包含动作指令 + JSON-only 约束禁止工具调用 + Planner 照抄 `{{taskContext.xxx}}` 字面量

**修复摘要**：

**Capability routing 重构**：
- `executor-selection.service.ts`：删除 `TASK_TYPE_REQUIRED_CAPABILITIES` 硬编码映射表，改为 taskType 直接匹配 agent capabilities（`[taskType]`），agent 标签从 `development_plan` 统一为 `development.plan`；修复 capability gate 被 B/C/D 评分维度覆盖的 bug（gate 移到维度计算之后）
- `incremental-planning.service.ts`：删除 `resolveRequiredCapabilitiesByTaskType()`，能力推导收敛到 executor-selection 内部
- `dto/index.ts`：submit-task 新增 `executorId` 别名字段（Planner 经常输出 executorId 而非 agentId）

**post_execute prompt 重构**：
- `orchestration-context.service.ts`：`buildPostTaskContext` 重写——executionOutput 使用 `<execution_output>` XML 标签包裹明确边界；任务元信息/执行结果/流程进度/决策规则分为独立 section；决策规则按场景分支表述（未完成→必须 generate_next，全部完成→stop）；去掉"必须调工具"矛盾指令

**pre_execute outline actions 机制**：
- `docs/skill/rd-workflow.md`：outline 输出格式增加 `preExecuteActions` 字段（step1: status→in_progress，step3: status→review），参数要求用 phaseInitialize 获取的实际值填入
- `orchestration-context.service.ts`：`buildPreTaskContext` 新增 `outlineStep` 参数，从 `plan.metadata.outline` 中读取当前 step 的 `preExecuteActions`，直接生成"参数已填好"的工具调用指令注入 prompt；同时注入 taskContext 变量映射表（含禁止传 `{{...}}` 字面量的约束）
- `orchestration-step-dispatcher.service.ts`：`phasePreExecute` 从 plan.metadata.outline 中查找当前 step 条目传给 buildPreTaskContext
- `planner.service.ts`：pre_execute 的 `responseDirective` 从默认 `json-only` 改为 `text`，解除 JSON-only 约束允许 Planner 输出 `<tool_call>`

**Prompt 修复**：
- `planner.service.ts`：修复 prompt 序号重复（两个 `5)` + 重复的纠偏规则）

**测试**：
- `executor-selection.service.spec.ts`：验证 development.plan 正确路由到 plan-capable agent，exec-only agent 被 gate 清零
- `incremental-planning.assignment.spec.ts`：验证 fallback 路径不再传 requiredCapabilities（由 executor-selection 自推导）+ executorId 别名

**验证结果**：
- 计划 `69c94186`（第 2 次）：step1→step2→step3 全部 completed，executor 正确分配（Docter-W 执行 plan/review，Coder-Van 执行 exec），post_execute 正确返回 generate_next
- 计划 `69c9531758554316b08bbd87`（第 6 次）：pre_execute prompt 成功注入 preExecuteActions 指令

**待验证**：
- pre_execute 中 Planner 是否成功执行 requirement.update-status 工具调用（第 6 次计划中 Planner 仍照抄了字面量，但 outline actions 机制已就位）

**关联文档**：
- Skill: `docs/skill/rd-workflow.md` v0.5.0（含 preExecuteActions）

---

### #5 phaseInitialize 落地 + taskContext 通用上下文传播 + rd-workflow v0.5.0（2026-03-29）

**问题**：研发需求流程中 step1（选定需求）依赖首部豁免机制，导致 prompt 分支复杂、requirementId 靠正则提取不稳定、step1 本身是"假任务"不产生研发价值。step2（确认需求范围）在结构化数据流下无存在必要。

**方案**：将需求选择和环境信息采集上移到新增的 `phaseInitialize` 独立阶段，由 Planner 通过工具调用自主完成；引入 `plan.metadata.taskContext` 通用上下文传播机制，实现计划级上下文向任务执行层的自动注入与追溯。

**改动摘要**（跨 2 个 commit：`4a861d7`、`b982829`）：

**Commit 1 — `4a861d7` phaseInitialize 核心落地：**
- `orchestration-plan.schema.ts`：`currentPhase` 新增 `'initialize'` 枚举值；strategy 新增 `skillActivation` 子文档
- `orchestration-step-dispatcher.service.ts`：新增 `phaseInitialize()` + `shouldRunInitialize()` 幂等守卫；idle 分支从直接进 generating 改为先判断是否需要 initialize
- `planner.service.ts`：新增 `initializePlan()` + `buildPhaseInitializePrompt()`；**删除**首步豁免分支（development + 非 development）和 `extractRequirementAnchor` 正则逻辑
- `incremental-planning.service.ts`：新增 `validateTaskContextInjection()` 监督校验；移除 step1 agent 兜底（plannerAgentId fallback）；run 创建时快照 taskContext
- `orchestration-context.service.ts`：新增 `buildPlanTaskContextSection()` + `resolvePlanTaskContextFromMetadata()`；`buildTaskDescription` 自动注入"计划上下文"独立 section
- `orchestration-execution-engine.service.ts`：新增 `loadPlanTaskContext()` + `loadRunTaskContext()`，plan task 和 run task 两条路径均注入 taskContext
- `plan-execution.service.ts`：run 创建时快照 `metadata.taskContext`
- `scene-optimization.service.ts`：移除 `tryBackfillRequirementId` 正则提取逻辑和 planModel 依赖
- `docs/skill/rd-workflow.md`：v0.4.0 → v0.5.0 初版（5步→3步，新增 phaseInitialize 段落）

**Commit 2 — `b982829` Review 修复：**
- `docs/skill/rd-workflow.md`：完整重写——phaseInitialize 新增具体工具调用序列（list-agents → requirement.list → requirement.get → requirement.update-status(assigned)）；每个 step 补充 generate/pre_execute/execute/post_execute 四阶段行为定义
- `planner.service.ts`：`buildPhaseInitializePrompt` 重写——加入显式工具 ID 和参数引导，将"仅返回 JSON"改为兼容工具调用的表述
- `orchestration-context.service.ts`：`buildPostTaskContext` 新增 `outlineStepCount` 参数，步骤数从 `plan.metadata.outline.length` 动态读取，替代硬编码 `3`
- `orchestration-step-dispatcher.service.ts`：`phasePostExecute` 从 plan metadata 读取 outline 长度传入

**核心设计决策**：
- phaseInitialize 是独立新阶段，仅在计划首次启动时执行一次
- taskContext 三层传播：写入（phaseInitialize → plan.metadata）→ 注入（buildTaskDescription → executor prompt）→ 追溯（run.metadata 快照）
- 需求 assigned 状态更新由 planner 在 phaseInitialize 工具调用序列中完成（非系统侧 HTTP 调用）
- rd-workflow 步骤从 5 步缩减为 3 步（移除选定需求 + 确认范围）
- phaseInitialize 行为由 skill 定义，代码不硬编码具体指令

**关联文档**：
- Plan: `docs/plan/ORCHESTRATION_PHASE_INITIALIZE_PLANNER_REQUIREMENT_PLAN.md`
- Skill: `docs/skill/rd-workflow.md` v0.5.0
- Commits: `4a861d7`, `b982829`

---

### #4 Planner planId 幻觉 + JSON 解析失败 + 多任务批量提交（2026-03-29）

**问题**：研发需求计划编排连续失败，三个不同计划分别暴露了三个叠加问题：
1. Planner Agent 调用 `submit-task` 工具时 planId 使用 LLM 幻觉值（`"plan_incremental"`/`"unknown"`），后端 `findById` 触发 CastError → 500
2. LLM 输出的 `<tool_call>` JSON 包含实际换行符（`\n` 非 `\\n`）和多余 `}`，`parseToolCallPayload` 解析失败 → `stripToolCallMarkup` 清空为空字符串 → planner 拿到 `responseLen=0`
3. Agent 在单个 run 中连续 5 次调用 `submit-task` 批量创建全部任务，违反增量编排"每次只生成 1 个"的设计

**修复摘要**（7 项变更，6 个文件）：
- `tool-execution-dispatcher.service.ts` + `orchestration-tool-handler.service.ts`：submit-task/report-task-run-result 从 `executionContext.collaborationContext.planId` 覆写 LLM 传的 planId
- `planner.service.ts`：prompt 中注入真实 planId + 行为约束（禁止确认性文本、单任务约束）
- `incremental-planning.service.ts`：`submitPlannerTaskFromTool`/`reportTaskRunResultFromTool` 增加 `Types.ObjectId.isValid` 校验
- `agent-executor.helpers.ts`：`sanitizeJsonString` 处理换行符 + `parseToolCallPayload` 尾部多余 `}` 修复
- `agent-executor.service.ts`：`tool_call_parse_failed` 诊断日志 + `strip_markup_empty_fallback` 回退 + submit-task 成功后 early return

**验证结果**：计划 `69c8325712cff082b097ff8c` 成功生成 1 个任务（step1），四阶段流转正常（generate → pre_execute → executing → post_execute → idle），`totalGenerated=1, consecutiveFailures=0`。

**关联文档**：
- Fix: `docs/issue/fix/2026-03-29-planner-planid-hallucination-json-parse-multi-submit.md`

---

### #2 Development 计划任务生成偏离 — Skill 驱动改造（2026-03-29）

**问题**：`domainType=development` 计划中，Planner 没有按 rd-workflow 的 step1→step5 生成业务任务，而是生成元规划任务、自己调用业务工具、输出确认文本、重复生成 step1、post-execute 默认 stop 导致编排卡住。

**根因**：sourcePrompt 原文直接注入导致元指令/业务步骤混淆、skill 内容含命令式工具调用指令、planner-executor session 共享、post-execute 缺乏多步流程进度感知、步骤计数与 skill step 序号不匹配。

**修复摘要**：
- `planner.service.ts`：development 模式角色边界 + 步骤引导 + 步骤进度 + 首步引导 + 已完成任务 step 标注
- `orchestration-context.service.ts`：post-execute 多步流程进度提示
- `orchestration-step-dispatcher.service.ts`：planner session 隔离（`orchestrationRunId: 'planner'`）
- `plan-management.service.ts`：generateNext 允许重置 isComplete
- `PlanHeader.tsx`：移除 generationCompleted 禁用条件
- `docs/skill/rd-workflow.md`：v0.4.0 重构（Planner 角色说明、去除命令式工具调用、恢复 pre-execute 需求状态更新）

**关联文档**：
- Fix: `docs/issue/fix/2026-03-29-development-plan-task-generation-skill-driven.md`
- Commit: `11371c4`

---

### #1 CollaborationContext 场景化重构 + JSON 输出双重强制（2026-03-28）

**问题**：collaborationContext 无类型约束、JSON 格式指令散落在 3 个文件中重复注入且措辞触发 LLM 确认行为、无 API 级别 response_format 支持。

**方案**：以 collaborationContext 为核心载体，实现场景化输出格式控制，覆盖 3 个业务场景（会议/计划编排/内部消息）+ 聊天场景。

**改动摘要**：
- 新增 discriminated union 类型系统（`ScenarioMode` + `ResponseDirective`）
- 新增 `CollaborationContextFactory` 工厂（4 个场景 + `fromLegacy()` 向后兼容）
- LLM Provider 层支持 `response_format: { type: 'json_object' }`（OpenAI/Moonshot/AIV2，推理模型自动跳过）
- JSON 格式约束统一收敛到 `collaboration-context.builder.ts` 单一注入点
- 移除 `orchestration-context.service.ts` 和 `planner.service.ts` 中的冗余 `[SYSTEM OVERRIDE]` 注入
- 场景推导从字段猜测改为显式 `scenarioMode` 读取
- 9 处 collaborationContext 构建点全部改为工厂调用
- 上下文标签统一为英文 `Working Environment Context`

**关联文档**：
- Fix: `docs/issue/fix/2026-03-28-collaboration-context-scenario-driven-refactor.md`
- Plan: `docs/plan/COLLABORATION_CONTEXT_SCENARIO_DRIVEN_REFACTOR_PLAN.md`
- Technical: `docs/technical/COLLABORATION_CONTEXT_SCENARIO_DRIVEN_DESIGN.md`
- Commits: `e01a7cf`, `ff4e2fb`

### #11 Planner Prompt 未注入 LLM + Skill phaseInitialize 指令冲突修复（2026-03-31）

**问题**：phaseInitialize 阶段 LLM 100% 跳过 Phase 1（outline 生成），只执行 skill 的需求锚定步骤，导致 `metadata.outline` 为空 → initialize 反复失败。经多轮 session log 分析和代码链路追查，发现两个叠加根因：

1. **P0 — Planner prompt 从未到达 LLM**：`planner.service.ts` 的 4 个方法（initializePlan / generateNextTask / executePreTask / executePostTask）将 prompt 放入 `task.description`，`task.messages = []`。但 `TaskContextBuilder` 检测到 `descriptionWillBePrompt = true`（有 description 无 user message）时抑制了 description 注入，假设"其他代码会作为 user message 注入"——实际没有任何代码这样做。**LLM 从未看到我们构建的 Phase 1/Phase 2 prompt**。
2. **P1 — Skill 扩展步骤覆盖 prompt 指令**：rd-workflow 的 `## phaseInitialize 扩展步骤`（4 步具体工具序列：requirement.list → get → plan-initialize(taskContext) → update-status）作为 system message 注入，是 LLM 唯一看到的 initialize 指令。即使修复了 prompt 注入，skill 的具体指令仍会与 prompt 的 Phase 1 指令冲突。

**修复摘要**（3 个文件）：

**Planner prompt 注入修复**：
- `planner.service.ts`：4 个 planner 方法的 `task.messages` 从 `[]` 改为 `[{ role: 'user', content: prompt, timestamp: new Date() }]`，确保 prompt 作为 user message 进入 LLM 上下文

**buildPhaseInitializePrompt 优化**：
- `planner.service.ts`：Phase 1 增加 OutlineItem JSON Schema 定义 + 完整 `plan-initialize(mode=outline)` tool_call 模板；顶部增加"执行顺序（严格遵守）"section 强调 Phase 1 → Phase 2 先后关系；existingRequirementId 存在时 Phase 2 跳过 requirement.list/get 直接给出预填参数的 tool_call 模板

**Skill phaseInitialize 段落裁剪扩大**：
- `toolset-context.builder.ts`：`stripPhaseInitializeSectionIfNeeded()` 从"仅对非 initialize 的 planner 角色生效"改为"对所有 planner 角色生效（含 planner_initialize）"。planner_initialize 阶段使用特化替换文本引导 LLM 按 user prompt 执行

**影响范围**：所有 4 个 planner 阶段（initialize / generating / pre_execute / post_execute）

**关联文档**：
- Guide: `docs/guide/PLANNER_INITIALIZE_PROMPT_AND_SKILL_CONFLICT.MD`
- Guide: `docs/guide/PLANNER_INITIALIZE_PROMPT_TOOL_EXECUTION_CHAIN.MD`
- Commit: `0dedcfa`

---

### #12 Planner Initialize 重构 + Skill 激活门控 + 预编译 Prompt 注入（2026-03-31）

**问题**：经 fix1~#11 修复后，计划编排仍存在两个结构性问题：
1. **Skill 全文在所有阶段注入**：rd-workflow / orchestration-runtime-tasktype-selection 等 skill 在 planner 的 generating / pre_execute / post_execute 阶段都被激活注入，LLM 上下文膨胀、指令冲突导致行为偏移
2. **phaseInitialize 与业务强绑定**：initialize 硬编码了 requirement 获取逻辑，无法复用于 general/research 域

**设计思路**：

核心理念：**Skill 全文只在 initialize 阶段出现一次，后续阶段读取预编译的 phasePrompts**。

- **Planner Initialize = 核心职责 + Skill 扩展**
  - Phase 1（核心，所有计划必做）：list-agents → 读取 skill 定义 → 确定步骤大纲 outline → 为每步每阶段生成专用 prompt（generating / pre_execute / execute / post_execute）→ 通过 `plan-initialize(mode=outline)` 工具写入 `plan.metadata.outline`
  - Phase 2（扩展，由 skill 定义）：执行 skill 中 `## phaseInitialize 扩展步骤` 定义的额外工具调用（如 rd-workflow 的 requirement 获取）→ 通过 `plan-initialize(mode=taskContext)` 写入共享上下文
  - 所有数据写入通过工具调用完成（非 LLM 输出 JSON 文本），避免解析不稳定

- **Skill 激活门控（Tag-Based Activation Rule）**
  - Tag 格式：`field:value[,value2]:rule`，rule = must / no / enable
  - 匹配优先级：no > must > enable
  - 非激活格式 tag 走原有语义匹配逻辑（向后兼容）
  - 示例：`domainType:development:must`（仅 development 域激活）、`phase:pre_execute:must`（仅 pre_execute 阶段激活）、`taskType:development.exec:no`（exec 类型排除）

- **后续阶段 prompt 来源切换**
  - generating / pre_execute / execute / post_execute 四个阶段从 `plan.metadata.outline[step].phasePrompts[$phase]` 读取预编译 prompt
  - 各阶段保留框架性 prompt（阶段声明、工具说明、行为约束），步骤指导部分替换为预编译内容
  - 降级路径：无预编译 prompt 时走原有硬编码逻辑

**改动摘要**（20 个文件，+961 / -391）：

- **Skill 激活门控**：`context-strategy.service.ts` 新增 `parseActivationTags()` / `evaluateActivationTags()`，`shouldActivateSkillContent()` 支持 tag-based 判断；`collaboration-context.types.ts` 新增 `domainType` / `phase` / `taskType` 字段透传
- **plan-initialize 工具**：`builtin-tool-catalog.ts` 注册工具；`orchestration-tool-handler.service.ts` 实现 `planInitialize()`（含 outline 校验 + taskContext merge + roleInPlan 拦截）；`plan-management.service.ts` 新增 `updatePlanMetadata()` + controller 端点 `PATCH /plans/:id/metadata`
- **phaseInitialize 重构**：`planner.service.ts` 重写 `buildPhaseInitializePrompt()`（Phase 1 核心 + Phase 2 扩展）；initialize 完成判断改为从 DB 检查 metadata.outline 含 phasePrompts；移除 `extractInitializeFieldsFromText()` 降级逻辑
- **prompt 注入改造**：generating 从 outline 读取 `phasePrompts.generating`；pre_execute / post_execute 优先使用预编译 prompt；execute 阶段通过 `loadPlanStepExecutePrompt()` 注入
- **Skill 文档更新**：rd-workflow 添加 `domainType:development:must`；tasktype-selection 添加 `phase:pre_execute:must`；task-out-validation 添加 `phase:post_execute:must`；rd-workflow phaseInitialize 段落改为扩展步骤格式

**关联文档**：
- Plan: `docs/plan/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE.md`
- Technical: `docs/technical/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE_DESIGN.md`
- Commit: `5da0b75`

---

### #13 plan-initialize(mode=outline) Schema 与 Handler 校验矛盾 — 死循环修复（2026-03-31）

**问题**：phaseInitialize 阶段 LLM 调用 `plan-initialize(mode=outline)` 100% 失败，进入死循环。Session log 显示 14+ 轮重试后 outline 始终无法写入，只有 taskContext 降级成功。

**根因**：三层校验对 `data` 参数的类型期望矛盾：
1. **Schema 声明**（`builtin-tool-catalog.ts:718`）：`data: { type: 'object' }` — 声明为 object
2. **Preflight 校验**（`agent-executor.helpers.ts:279`）：按 schema 检查，`Array.isArray(value)` 为 true 时返回 `"field 'data' must be object"` — array 被拦截，不进入 handler
3. **Handler 校验**（`orchestration-tool-handler.service.ts:358`）：`validateOutlineData()` 要求 `Array.isArray(data)` — 要求必须是 array

死循环过程：LLM 传 array → Preflight 拦截 "must be object" → LLM 改传 object({items:[...]}) → Preflight 通过 → Handler 拦截 "requires non-empty array" → LLM 改回 array → 循环

**修复摘要**（2 个文件）：

**Schema 声明修复**：
- `builtin-tool-catalog.ts`：`data` 字段移除 `type: 'object'` 约束，仅保留 `description` 说明两种 mode 下的数据格式（array/object）。Preflight 校验发现无 `type` 声明时 `continue` 跳过类型检查，不再拦截 array。

**Handler 兼容逻辑**：
- `orchestration-tool-handler.service.ts`：`planInitialize()` 在 `mode=outline` 时新增 object-to-array unwrap 兼容——若 `data` 是 object 且包含 `items`/`data`/`outline` 子字段为 array，自动提取内层 array 传递给 `validateOutlineData()`。防止 LLM 因修正指令包裹 object 后仍被 handler 拒绝。

**防御层次**：
1. **Schema 层**：不声明 type → preflight 不做类型拦截 → array 和 object 均可到达 handler
2. **Handler 层**：array 直接校验通过；object 包裹的 array 自动 unwrap 后校验
3. **Prompt 层**：`buildPhaseInitializePrompt` 示例已使用 `"data":[...]` array 格式（无需改动）

---

### #14 pre_execute 无 actions 直接跳过 + phasePrompts.pre_execute/post_execute 停止消费 + preExecuteActions 结构化 Prompt（2026-03-31）

**问题**：计划 `69cac0a7` Step2 在 pre_execute 阶段被反复 blocked 4 次后用户手动停止。根因分析：

1. **P0 — pre_execute 阶段职责错位**：`phasePrompts.pre_execute` 生成了"检查 step1 输出可执行"等审查类指令，但 pre_execute 阶段的 Planner 上下文中**没有注入前置步骤的执行结果**，Planner 通过 `memory.search-memo`、`repo-read grep` 均无法获取 Step1 输出，于是反复返回 `allowExecute=false`
2. **P1 — phasePrompts.pre_execute/post_execute 实际价值为零**：LLM 在 phaseInitialize 阶段生成的 pre_execute/post_execute prompt 文本要么是空洞的系统术语（"执行 preExecuteActions"），要么是无法满足的审查指令（"检查 step1 输出"），注入后反而误导 Planner
3. **P1 — preExecuteActions 结构化数据未生成**：outline 中 3 个 step 的 `preExecuteActions` 全部为 null，LLM 只在 `phasePrompts.pre_execute` 文本里写了"执行 preExecuteActions"但没有生成实际的结构化数组

**设计决策**：
- **pre_execute 的唯一职责**：执行 `preExecuteActions`（如 requirement.update-status）。无 actions 时系统直接跳过，不调 LLM
- **post_execute 的决策规则**：统一使用系统内置的多步流程进度逻辑，不再由 LLM 生成的 prompt 覆盖
- **phasePrompts 字段保留**：DB 中仍存储 `pre_execute`/`post_execute` 字段（不破坏 schema），但 dispatcher 不再消费

**修复摘要**（4 个文件）：

**dispatcher phasePreExecute 短路跳过**：
- `orchestration-step-dispatcher.service.ts`：提取 `preExecuteActions` 后判断——为空则直接 `allowExecute=true` 跳到 executing，写入 runLog "Pre-execute skipped: no preExecuteActions defined"，发出事件；有 actions 时仍走 LLM 执行工具调用。删除 `normalizedPreExecutePrompt` / `outlinePrompts` 读取逻辑

**dispatcher phasePostExecute 去除 prompt 注入**：
- `orchestration-step-dispatcher.service.ts`：删除从 `outline.phasePrompts.post_execute` 读取 `postExecutePrompt` 并传递给 `buildPostTaskContext` 的逻辑；删除不再需要的 `planSnapshot` 查询

**buildPreTaskContext 简化**：
- `orchestration-context.service.ts`：签名从 `outlineStep?: { phasePrompts?, preExecuteActions? }` 改为 `preExecuteActions: Array<...>`；删除 `phasePrompts.pre_execute` 参数、preExecutePrompt 分支、无 actions 的兜底分支；精简阶段隔离声明

**buildPostTaskContext 去除 prompt 参数**：
- `orchestration-context.service.ts`：删除 `postExecutePrompt?: string` 参数和对应注入分支；决策规则统一走系统内置的多步流程进度逻辑（已完成/总步数 → generate_next 或 stop）

**buildPhaseInitializePrompt 增加 preExecuteActions 结构化定义**：
- `planner.service.ts`：OutlineItem Schema 增加 `preExecuteActions` 数组字段定义（含 tool、params 说明）；Phase 1 示例中 step1/step3 增加 preExecuteActions 示例（requirement.update-status）；step2 无 preExecuteActions 示例；增加 preExecuteActions 用法说明段落；phasePrompts 中删除 `pre_execute` 字段的示例

**测试更新**：
- `orchestration-context.service.spec.ts`：更新 buildPreTaskContext 测试（传入 preExecuteActions 数组）；更新 buildPostTaskContext 测试（验证系统决策规则，不再传 postExecutePrompt）

**验证结果**：TypeScript 编译通过，23 个相关测试全部通过

---

### #16 通用终态工具（Terminal Tool）机制 — post_execute 死循环修复（2026-03-31）

**问题**：计划 `69cb75cc` 的 post_execute 阶段，Planner 调用 `report-task-run-result` 工具成功返回 `{ accepted: true, action: "generate_next" }` 后，executor 不终止 session，LLM 反复重复调用同一工具 30+ 轮直到轮次上限。

**根因**：`agent-executor.service.ts` 的 tool-calling 循环中，只有 `submit-task` 有 hardcoded early return（检查 `toolResultPayload?.taskId`），`report-task-run-result` 执行后走通用路径——结果被序列化为 system message 推入消息历史，loop 继续下一轮，LLM 看到工具结果后再次调用，形成无限循环。

**方案**：引入通用"终态工具"（Terminal Tool）机制，替代 hardcoded 单工具检查。

**修复摘要**（4 个文件）：

**Tool Schema 新增 `terminal` 字段**：
- `tool.schema.ts`：新增 `@Prop({ default: false }) terminal?: boolean;`，标记工具成功执行后是否应终止 agent executor 的 tool-calling 循环

**Builtin Tool Catalog 标记终态工具**：
- `builtin-tool-catalog.ts`：`submit-task` 和 `report-task-run-result` 添加 `terminal: true`；新增导出 `TERMINAL_TOOL_IDS: ReadonlySet<string>`，从 `BUILTIN_TOOLS` 静态过滤（无运行时 DB 查询）

**Tool Registry 同步新字段**：
- `tool-registry.service.ts`：`initializeBuiltinTools` 的 `$set` 块增加 `terminal` 字段同步

**Executor 循环通用 terminal early return**：
- `agent-executor.service.ts`：导入 `TERMINAL_TOOL_IDS`；将原 `submit-task` hardcoded early return 替换为通用检查 `if (TERMINAL_TOOL_IDS.has(normalizedToolCallId))`，成功即 `return`；日志 tag 从 `submit_task_early_return` 改为 `terminal_tool_early_return`

**设计决策**：
- Terminal early return 无额外条件——工具执行成功（未进入 catch）即终止
- Terminal tool set 来源为静态 `BUILTIN_TOOLS` 过滤，不查 DB
- 未来新增终态工具只需在 catalog 中加 `terminal: true`，无需改 executor

**验证结果**：TypeScript 编译通过，65 个相关测试全部通过（agent-executor 14 + orchestration 50 + tool-registry 1）

---

## 待跟进

1. `agent-task.worker.ts` 嵌套 `collaborationContext.collaborationContext` 问题（独立修复）
2. `orchestration-tool-handler.service.ts` 中 `organizationId` 残留清理
3. `fromLegacy()` 对孤立 `meetingId`（无 `collaborationMode`/`meetingTitle`）的归类问题
4. 过渡期结束后（预计 2026-07）移除旧字段（`format`、`mode`、`collaborationMode`）和兼容逻辑
5. 运行时验证：计划编排首步生成、planner pre/post 决策、executor 任务执行、内部消息触发、会议场景
### #15 多 tool_call 丢弃通知 + phaseInitialize text-only retry 纠正指令修复（2026-03-31）

**问题**：计划 `69cac0a7` 和 `69cb6675` 的 phaseInitialize 阶段暴露了两个问题：

1. **P1 — LLM 单次输出多个 tool_call 时后续调用被静默丢弃**：LLM 在一次回复中同时输出 `list-agents` + `plan-initialize` + `requirement.list` 三个 tool_call，但 `extractToolCall()` 只提取第一个（非贪婪正则 `([\s\S]*?)`），其余被静默丢弃。后续轮次 LLM 不知道哪些被执行、哪些被丢弃，用过时参数重新提交（如 agentId 填 `"TBD"`），导致执行链断裂和数据错误。

2. **P2 — text-only retry 纠正指令误导 LLM 调 get-plan**：纠正指令说"请直接输出最终 JSON 结果（包含 requirementId、outline 等字段）"，LLM 解读为需要输出包含 outline 完整数据的 JSON，于是调 `get-plan` 想读回已写入的数据——但 `get-plan` 不在 Planner 工具列表中（`Tool not assigned`）。

**方案演进**：

最初方案是"extractAllToolCalls + for 循环顺序执行全部"，但分析后发现这不能解决参数依赖问题——LLM 在生成第二个 tool_call 时还没看到第一个的结果，参数已经"冻结"了（如 plan-initialize 的 agentId 填 `"TBD"` 因为 list-agents 还没返回）。顺序执行全部 ≠ 解决了参数依赖。

考虑过"检测到多个就全部拒绝、要求 LLM 重试只输出一个"的方案，但：
- 浪费已有推理结果——第一个 tool_call 通常是正确的（LLM 按依赖顺序排列）
- 重试不保证收敛——较弱模型会反复犯同样的错，超过重试次数后降级为报错
- 增加延迟——每次重试是一个完整的 LLM round trip

**最终方案：执行第一个 + 丢弃通知**。系统只执行第一个 tool_call，成功后向 messages 追加结构化通知告知 LLM 哪些调用被跳过，LLM 在下一轮基于真实结果重新发起后续调用。

**修复摘要**（3 个文件）：

**多 tool_call 检测与丢弃通知**：
- `agent-executor.helpers.ts`：新增 `extractAllToolCalls()` 函数，使用全局正则 `/<tool_call>[\s\S]*?<\/tool_call>/gi` 提取所有闭合 tool_call 块；原 `extractToolCall()` 改为调用 `extractAllToolCalls()[0]`（向后兼容）
- `agent-executor.service.ts`：主循环从 `extractToolCall()` 改为 `extractAllToolCalls()`，`toolCall = toolCalls[0]`，`droppedToolCalls = toolCalls.slice(1)`。只执行第一个工具。成功后若 `droppedToolCalls.length > 0`，向 messages 追加 system 消息：`"你在同一条回复中输出了 N 个 tool_call，系统只执行了第一个（xxx）。被跳过的工具：yyy。请根据上方工具返回结果，在下一条回复中逐个发起后续工具调用。"` 通知同时持久化到 session（source: `tool-calling-loop.dropped-tool-calls`）。日志记录 `[multi_tool_call_dropped]` 含 executed/dropped 工具名

**text-only retry 纠正指令修复**：
- `agent-executor.service.ts`：phaseInitialize 阶段的纠正指令从"输出最终 JSON 结果（包含 requirementId、outline 等字段）"改为"直接回复 phaseInitialize completed 即可，不需要输出 JSON"；显式禁止调用 `get-plan`

**验证结果**：TypeScript 编译通过，78 个相关测试全部通过（14 agent-executor + 64 orchestration）

---

6. ~~**[P1] development 计划步骤推进验证**~~ → **已验证通过**（#6 计划 69c94186 step1→step2→step3 全部 completed）
7. ~~**[P2] pre-execute 需求状态更新验证**~~ → **已实现 outline preExecuteActions 机制**（#6），待端到端验证 Planner 是否成功执行工具调用
8. ~~**[P2] Planner 输出稳定性**：post-execute 阶段 Planner 是否稳定返回 `generate_next` 而非 stop/无效 JSON~~ → **已修复**（#6 post_execute prompt 重构，XML 边界标记 + 场景化决策规则）
9. ~~**[P1] step1 任务执行失败排查**~~ → **已修复**（#6 capability routing 修复，executor 正确分配）
10. ~~**[P1] phaseInitialize 端到端验证**~~ → **已验证通过**（#6 多个计划均正确完成 initialize 5 步工具调用链）
11. ~~**[P1] rd-workflow v0.5.0 三步流程验证**~~ → **已验证通过**（#6 计划 69c94186）
12. ~~**[P2] phaseInitialize LLM 输出稳定性**~~ → **已验证通过**（#6 多个计划均稳定输出合规 JSON）
13. **[P2] 非 development 域 phaseInitialize 验证**：general/research 域计划是否正确跳过 requirement 选择，仅生成 outline
14. **[P2] 前端 outline 展示**：`plan.metadata.outline` 和 `plan.metadata.taskContext` 新字段的前端展示（可后续迭代）
15. **[P1] pre_execute outline actions 端到端验证**：验证 Planner 在 pre_execute 阶段是否能正确执行 outline 中定义的 preExecuteActions 工具调用（requirement.update-status），需求状态是否成功流转 assigned → in_progress → review
16. **[P2] Planner planId 截断问题**：generate 阶段 Planner 仍偶发截断 planId（如 `69c95162f89f45faa79a4`），submit-task preflight 报错后重试成功但浪费 token
17. ~~**[P2] Planner generate 阶段确认文本**~~ → **已缓解**（#9 planner text-only retry 机制 + skill phaseInitialize 裁剪），retry 后 planner 能执行 tool_call，但 initialize 阶段仍偶发混淆 initialize/generating 职责
18. ~~**[P1] Initialize 阶段 LLM 行为不稳定**~~ → **已修复**（#10 roleInPlan 交叉赋值修复 + 三层纵深防御：硬拦截/prompt 引导/解析降级/session 隔离）
19. ~~**[P0] Planner prompt 未注入 LLM 上下文**~~ → **已修复**（#11 task.messages 注入 user message，4 个 planner 方法统一修复）
20. ~~**[P1] Skill phaseInitialize 扩展步骤与 prompt Phase 1 指令冲突**~~ → **已修复**（#11 所有 planner 角色裁剪 skill 的 phaseInitialize 段落）
21. **[P1] #11 修复端到端验证**：验证 initialize 阶段 LLM 是否按 Phase 1 → Phase 2 顺序执行（list-agents → outline → taskContext → update-status），outline 是否成功写入 metadata
22. **[P2] AgentExecutionTask.description → prompt 语义重命名**：涉及 24 个文件（含 schema/DTO/execution engine），需单独 session 执行
