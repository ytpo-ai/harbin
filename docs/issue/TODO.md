# 优化系统提示词优化

此文档是我们执行问题交互的追踪文档，我会在必要时更新。

## 目标
优化系统提示词以及计划执行Prompt的设计，注入时机和注入条件。

## 当前需要解决的问题
1. ~~在计划编排过程，Agent的输出不稳定，导致计划编排失败率较高。~~ → **已解决**（见下方已完成项 #1）
2. ~~当前Prompt设计不够合理，导致不必要的注入污染上下文。~~ → **已解决**（见下方已完成项 #1）
3. ~~Prompt注入条件和时机需要更完善的设计。~~ → **已解决**（见下方已完成项 #1）

## 测试token
Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbXBsb3llZUlkIjoiMzViODhhODMtOTBjZS00MDMyLWExOGMtMDc5ZDg4Y2ExOWYwIiwiZW1haWwiOiJhZG1pbkBhaS10ZWFtLmNvbSIsImV4cCI6MTc3NDcxNjk3NDg4M30.-b6WmVfagOZRaXt7fgskzfg4LVLdlIVkthXtmhhSJVo

## 已完成

### #3 Orchestration 无用系统工具下线与 seed 对齐（2026-03-29）

**问题**：以下历史工具已不再需要，但仍存在于工具注册、执行分发、MCP profile seed 与别名映射中，导致可见性与实际能力不一致：

- `builtin.sys-mg.mcp.orchestration.complete-human-task`
- `builtin.sys-mg.mcp.orchestration.create-schedule`
- `builtin.sys-mg.mcp.orchestration.debug-task`
- `builtin.sys-mg.mcp.orchestration.reassign-task`
- `builtin.sys-mg.mcp.orchestration.update-schedule`

**修复摘要**：
- 工具目录移除上述 5 个 tool id，并同步移除执行分发分支。
- 移除 Agent 常量与 legacy alias 中对应映射，避免运行时继续解析旧入口。
- `mcp-profile` seed 移除这些工具，并修正 `mode=sync` 为覆盖写入 `tools`，防止历史工具残留。
- 将 5 个 canonical id 加入 `DEPRECATED_TOOL_IDS`，确保 `builtin-tools` sync 会清理存量。
- 执行 seed 落库：`npm run seed:manual -- --only=builtin-tools,mcp-profiles --mode=sync`（`builtin-tools updated=51`，`mcp-profiles seeded=13`）。

**关联文档**：
- Development: `docs/development/ORCHESTRATION_UNUSED_MCP_TOOL_CLEANUP_2026-03-29.md`
- Feature: `docs/feature/AGENT_TOOL.md`

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
6. **[P1] development 计划步骤推进验证**：新计划中 step1→step2→...→step5 是否能正确推进，不重复、不跳步
7. **[P2] pre-execute 需求状态更新验证**：Planner 在 pre-execute 阶段是否按 rd-workflow skill 规则调用工具更新需求状态（assigned/in_progress/review）
8. **[P2] Planner 输出稳定性**：post-execute 阶段 Planner 是否稳定返回 `generate_next` 而非 stop/无效 JSON

## 必读（先统一认知）

以下是本次任务的主要参考文档，必要时阅读：

1. `docs/guide/TEST_GUIDELINE.MD`
2. `docs/learn/rd.md` 这是研发任务规划提示词
3. docs/issue/fix/2026-03-28-orchestration-plan-first-step-failure-investigation.md 这是针对计划编排首步失败的完整追溯分析，包含了问题现象、根因分析和代码链路梳理，非常有助于理解当前问题的症结所在。
4. docs/issue/fix/2026-03-28-orchestration-plan-generation-sse-and-planner-fixes.md 这是针对计划编排过程中发现的 SSE 连接问题和 Planner Agent 输出不稳定问题的修复记录，包含了具体的代码修改和验证结果。
5. docs/issue/fix/2026-03-28-orchestration-step3-no-response-regression.md
6. docs/issue/fix/2026-03-28-replan-requirementid-lost-in-planner-context.md
7. docs/issue/fix/2026-03-28-planner-skill-injection-causes-confirmation-output.md 这是针对 Skill 注入策略过于宽泛及注入措辞触发 Agent 确认性输出的完整追溯，包含了 skillActivation 可配置模式的设计实现、4 轮逐步验证过程、以及关键经验教训。
8. docs/issue/fix/2026-03-28-collaboration-context-scenario-driven-refactor.md CollaborationContext 场景化重构 + JSON 输出双重强制的完整修复记录。
9. docs/issue/fix/2026-03-29-development-plan-task-generation-skill-driven.md Development 计划任务生成偏离的完整追溯流程，包含 10 个阶段的问题发现与修复过程、Planner-Executor Session 共享根因、Skill 驱动改造设计决策。

### 过程中几个约束

- 执行过程要慢慢来，更多的交互，询问我的意见，而不是一次性输出最终结果
- 优先 ORCH_STEP_DISPATCHER_ENABLED=true，步骤调度器以步骤调度器的方式触发
- 必要时 可直接自己构造 LLM Conext，通过结构以某Agent的身份提交给LLM provider， 来测试提示词效果，验证设计合理性
