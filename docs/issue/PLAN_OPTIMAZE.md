# 优化系统提示词优化

此文档是我们执行问题交互的追踪文档，目标会随着问题结局而变化，我会在必要时更新。

## 目标
优化系统提示词以及计划执行Prompt的设计，注入时机和注入条件。

## 当前需要解决的问题
1. ~~在计划编排过程，Agent的输出不稳定，导致计划编排失败率较高。~~ → **已解决**（见下方已完成项 #1）
2. ~~当前Prompt设计不够合理，导致不必要的注入污染上下文。~~ → **已解决**（见下方已完成项 #1）
3. ~~Prompt注入条件和时机需要更完善的设计。~~ → **已解决**（见下方已完成项 #1）

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

## 待跟进

1. `agent-task.worker.ts` 嵌套 `collaborationContext.collaborationContext` 问题（独立修复）
2. `orchestration-tool-handler.service.ts` 中 `organizationId` 残留清理
3. `fromLegacy()` 对孤立 `meetingId`（无 `collaborationMode`/`meetingTitle`）的归类问题
4. 过渡期结束后（预计 2026-07）移除旧字段（`format`、`mode`、`collaborationMode`）和兼容逻辑
5. 运行时验证：计划编排首步生成、planner pre/post 决策、executor 任务执行、内部消息触发、会议场景
6. ~~**[P1] development 计划步骤推进验证**：新计划中 step1→step2→...→step5 是否能正确推进~~ → **已重构**（#5 phaseInitialize + rd-workflow v0.5.0，步骤缩减为 3 步，需重新验证 step1→step3 推进）
7. ~~**[P2] pre-execute 需求状态更新验证**~~ → **已重构**（#5 assigned 改为 phaseInitialize 工具调用，in_progress/review 仍在 pre-execute）
8. **[P2] Planner 输出稳定性**：post-execute 阶段 Planner 是否稳定返回 `generate_next` 而非 stop/无效 JSON
9. **[P1] step1 任务执行失败排查**：计划 69c8325712cff082b097ff8c 中 step1 创建成功但执行后 `status=failed`，post_execute 决定 `stop`。需排查任务执行层面的失败原因
10. **[P1] phaseInitialize 端到端验证**：创建新 development 计划，验证 initialize 阶段 planner 是否正确调用 list-agents → requirement.list → requirement.get → requirement.update-status(assigned)，taskContext 和 outline 是否正确写入 plan.metadata
11. **[P1] rd-workflow v0.5.0 三步流程验证**：验证新计划 step1(development.plan) → step2(development.exec) → step3(development.review) 是否完整推进至 stop
12. **[P2] phaseInitialize LLM 输出稳定性**：planner 在一轮对话中能否稳定完成多个工具调用并输出合规 JSON
13. **[P2] 非 development 域 phaseInitialize 验证**：general/research 域计划是否正确跳过 requirement 选择，仅生成 outline
14. **[P2] 前端 outline 展示**：`plan.metadata.outline` 和 `plan.metadata.taskContext` 新字段的前端展示（可后续迭代）
