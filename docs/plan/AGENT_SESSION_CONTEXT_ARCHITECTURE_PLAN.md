# Agent Session 与 Context 组装架构优化计划

## 背景

当前 Agent Runtime 的 Session/Context 组装存在以下问题：

1. **上下文块职责不清晰**：buildMessages 中 9 层 system messages 的职责边界模糊，团队上下文与会议上下文高度重叠，业务场景上下文完全缺失
2. **Session 粒度不合理**：编排模式下每个 task 独立创建 session（`orch-task-{taskId}`），同一 agent 在同一 plan 中执行多个任务时无工作记忆连续性，跨 task 信息仅靠 `dependencyContext` 文本拼接
3. **AgentSession Schema 字段设计过时**：`sessionType` 只有 `meeting|task` 两种，无法区分 1v1 聊天与多人会议；`planContext` 绑定到 taskId 级别而非 planId 级别；团队上下文和业务场景上下文未持久化到 session
4. **团队上下文无实际价值**：当前 teamContext 仅是会议参与者列表或 `{mode:'planning',format:'json'}` 这样的空壳，未体现协作关系、层级治理、上下游依赖等信息
5. **记忆上下文形同虚设**：`buildMessages` 中记忆检索逻辑已被注释掉，memoSnapshot 异步刷新机制虽存在但未真正参与上下文组装

## 方案概述

### 一、重新定义 6 层上下文模型

将 context 组装从当前的 9 层扁平结构重构为 **6 层职责明确的上下文块**：

| Layer | 名称 | 职责定义 | 生命周期 |
|-------|------|---------|---------|
| L1 | **Agent Identity** | 我是谁——角色定义、职责边界、行为准则、自定义 prompt | Session 级，首次注入，变更时增量更新 |
| L2 | **Toolset & Skills** | 我能做什么——可用工具声明 + 使用策略、技能索引 + 按需激活全文 | Session 级，首次注入，变更时增量更新 |
| L3 | **Business Domain Context** | 我在什么领域工作——业务场景描述、领域知识、领域约束规则 | Plan/Session 级，注入一次全程有效 |
| L4 | **Collaboration Context** | 我和谁怎么配合——协作关系、层级治理、上下游依赖、交接约定 | 按场景差异化注入 |
| L5 | **Task Context** | 我当前要做什么——具体任务目标、依赖产出、执行要求 | Run/Task 级，每次任务切换时更新 |
| L6 | **Working Memory** | 我记得什么——前序任务摘要、历史经验、相关记忆检索 | Session 级，逐 run 积累 |

### 二、Session 模型从 task 级调整为 plan 级

**编排模式**：从"每 task 一个 session"改为"每 plan 每 agent 一个 session"

```
Plan
  └── Agent A Session (plan 内唯一)
  │     ├── Run #1 (task-1) → 完成后生成 runSummary
  │     ├── Run #2 (task-3) → 携带 Run #1 摘要
  │     └── Run #3 (task-5) → 携带 Run #1+#2 摘要
  └── Agent B Session (plan 内唯一)
        ├── Run #1 (task-2)
        └── Run #2 (task-4)
```

**会议模式**：保持当前 `meeting-{meetingId}-{agentId}` 的 session 复用逻辑不变

**1v1 聊天模式**：新增 `chat` sessionType，与 meeting/task 类型区分

### 三、AgentSession Schema 字段优化

### 四、各场景注入策略矩阵

| Layer | 计划编排 | 1v1 聊天 | 多人会议 |
|-------|---------|---------|---------|
| L1 Identity | 必注入 | 必注入 | 必注入 |
| L2 Toolset & Skills | 必注入 | 必注入 | 必注入（精简） |
| L3 Business Domain | **必注入** | 可选（轻量） | 可选 |
| L4 Collaboration | **必注入**（协作链+层级） | 通常为空 | **必注入**（参与者+议程） |
| L5 Task | 必注入 | 由对话内容自带 | 会议执行规范 |
| L6 Working Memory | 逐 run 积累 | 按需检索 | 按需 |

## 执行步骤

1. **重新设计 AgentSession Schema**：新增 `chat` sessionType、重构 `planContext` 为 plan 级关联、新增 `domainContext` 和 `collaborationContext` 持久化字段、为 messages 增加 `runId` 边界标记，新增 `runSummaries` 数组字段用于存储 run 完成后的结构化摘要
2. **重构 session 创建逻辑**：编排模式下新增 `getOrCreatePlanSession` 方法（按 `planId + agentId` 复用），调整 `orchestration.service.ts` 中 sessionId 生成规则从 `orch-task-{taskId}` 改为 `plan-{planId}-{agentId}`
3. **实现 6 层 Context Builder（独立模块）**：将当前 `buildMessages` 中的 12 阶段硬编码拆分为独立模块 `modules/agents/context/`，包含统一接口定义、6 个独立的 Context Block Builder、1 个 ContextAssembler 编排服务，以及从 `agent-executor.service.ts` 中迁出的指纹缓存/增量更新等通用能力。`agent-executor.service.ts` 中的 `buildMessages` 简化为对 `ContextAssembler.assemble()` 的单行调用
4. **实现 Business Domain Context 数据模型与注入**：在 OrchestrationPlan 级别新增 `domainContext` 字段（业务场景类型、领域描述、约束规则），计划创建时由用户指定或 planner 自动提取，注入到 session 的 `domainContext` 持久化
5. **重构 Collaboration Context**：编排模式下构建协作链上下文（上游产出摘要 + 当前 agent 层级 + 下游期望 + 协作者职责边界）；会议模式下保留参与者 + 议程结构；集成三层治理架构信息（高管/执行层/临时工层级标识与分派约束）
6. **实现 Run Summary 机制**：每个 run 完成后由 LLM 或规则引擎生成结构化摘要（任务目标、执行结果、关键产出、遗留问题），存入 session 的 `runSummaries` 数组，后续 run 的 Working Memory（L6）从中读取
7. **处理并行任务隔离**：同一 agent 在同一 plan 中有并行任务时，采用 run 级别隔离——共享 session 但各自有独立 runId，并行 run 完成后各自生成 summary 再合并到 session

## 关键影响点

- **AgentSession Schema**：`backend/apps/agents/src/schemas/agent-session.schema.ts`（字段重构）
- **Session 持久化层**：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`（新增 `getOrCreatePlanSession`，调整 `getOrCreateTaskSession`）
- **Runtime 编排层**：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`（session 路由逻辑调整）
- **Context 组装模块（新增）**：`backend/apps/agents/src/modules/agents/context/`（独立目录，包含 ContextAssembler + 6 个 Builder + 接口定义 + 通用工具）
- **Context 组装核心**：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`（`buildMessages` 简化为调用 `ContextAssembler.assemble()`，迁出组装逻辑）
- **编排服务**：`backend/src/modules/orchestration/orchestration.service.ts`（sessionId 生成规则、domainContext 透传）
- **Planner 服务**：`backend/src/modules/orchestration/planner.service.ts`（teamContext 重构为 collaborationContext）
- **会议服务**：`backend/src/modules/meetings/meeting.service.ts`（teamContext 构建逻辑调整）
- **Agent Client**：`backend/src/modules/agents-client/agent-client.service.ts`（新增 `getOrCreatePlanSession` 远程调用）
- **功能文档**：`docs/feature/AGENT_RUNTIME.md`（Session 与上下文协同章节全面更新）

## 风险与处理

- 风险：Session 粒度从 task 级改为 plan 级后，长计划中 session 消息量可能膨胀超出上下文窗口
  - 处理：通过 Run Summary 机制压缩历史——每个 run 完成后将原始消息替换为结构化摘要，控制累积上下文量
- 风险：并行任务场景下同 session 的并发写入可能产生数据竞争
  - 处理：run 级别隔离 + MongoDB 原子操作（`$push`），并行 run 之间不共享实时消息，仅在完成后合并 summary
- 风险：现有编排流程、会议流程大量依赖当前 session 创建逻辑，重构范围较大
  - 处理：分阶段实施——先完成 Schema 和 Context Builder 的设计与实现，再逐场景迁移调用方；保留旧 `getOrCreateTaskSession` 的兼容路径
- 风险：Business Domain Context 的数据来源尚未完全确定，初期可能内容为空
  - 处理：初期支持计划创建时手动指定 + planner 自动提取两种方式，字段设为可选，不影响无 domainContext 的现有流程
