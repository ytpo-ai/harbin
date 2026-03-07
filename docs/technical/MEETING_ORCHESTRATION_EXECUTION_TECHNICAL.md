# 计划编排技术设计文档

## 1. 计划编排当前设计梳理

### 1.1 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      OrchestrationModule                        │
├─────────────────┬─────────────────────┬─────────────────────────┤
│  PlannerService │ OrchestrationService│ SessionManagerService   │
│    (计划生成)    │    (计划执行引擎)     │    (会话管理)            │
└────────┬────────┴──────────┬──────────┴────────────┬────────────┘
         │                  │                       │
    ┌────▼────┐        ┌────▼────┐             ┌────▼────┐
    │  Agent  │        │  Plan   │             │ Session │
    │(Planner)│        │  Task   │             │         │
    └─────────┘        └─────────┘             └─────────┘
```

### 1.2 核心组件

| 组件 | 职责 | 关键方法 |
|------|------|----------|
| **PlannerService** | 从 Prompt 生成任务列表 | `planFromPrompt()` |
| **OrchestrationService** | 计划执行、任务调度、状态管理 | `runPlan()`, `executeTaskNode()` |
| **SessionManagerService** | Agent 会话管理 | `getOrCreateAgentSession()` |

### 1.3 数据模型

**OrchestrationPlan** (计划)
- `status`: draft → planned → running → paused/completed/failed
- `strategy.mode`: sequential | parallel | hybrid
- `stats`: 任务计数统计

**OrchestrationTask** (任务)
- `status`: pending → assigned → in_progress → completed/failed/waiting_human
- `dependencyTaskIds`: 依赖关系（数组索引）
- `assignment`: 执行者分配 (agent/employee/unassigned)

### 1.4 执行流程

1. **创建计划**: `createPlanFromPrompt()` 
   - 调用 PlannerService 生成任务
   - 自动选择执行者 (selectExecutor)
   - 建立任务依赖关系

2. **执行计划**: `runPlan()` / `runPlanAsync()`
   - 按 mode 调度 (sequential/parallel/hybrid)
   - 依赖检查: 只有前置任务完成才可执行
   - 支持 continueOnFailure

3. **任务执行**: `executeTaskNode()`
   - 特殊任务识别: Email任务、研究任务、审核任务
   - 输出验证: research output contract、review output contract
   - 外部动作验证: EMAIL_SEND_PROOF

---

## 2. 架构决策分析

### 2.1 现状对比

| 维度 | `apps/agents` (Agent 运行时) | `modules/orchestration` (计划编排) |
|------|------------------------------|-----------------------------------|
| **定位** | 单 Agent 任务执行 | 多任务协作编排 |
| **核心对象** | Agent + Session + Run | Plan + Task |
| **执行模式** | 单 Agent 循环 | 多任务 DAG 调度 |
| **已有运行时** | RuntimeOrchestrator | OrchestrationService |

### 编排设置为独立的编排层

```
系统架构:
├── Gateway (入口)
├── apps/agents (单 Agent 运行时)
└── modules/orchestration (编排层) → 调用 apps/agents
```

**结论**: 编排作为独立层，通过 AgentClientService 调用 apps/agents 执行任务。

---

## 3. 优化后的架构

### 3.1 分层架构

```
                    ┌─────────────────────────────────────────┐
                    │           AgentSession                  │
                    │  (由 apps/agents 统一管理)               │
                    ├─────────────────────────────────────────┤
                    │ • session metadata                      │
                    │ • messages (对话历史)                    │
                    │ • memos (知识/结论/TODO)                 │
                    │ • runs (多次执行记录)                    │
                    │ • planContext (计划编排)  ← 新增         │
                    │ • meetingContext (会议上下文) ← 新增    │
                    └─────────────────────────────────────────┘
                                    ▲
                                    │ 引用
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
    ┌───────▼───────┐      ┌────────▼────────┐    ┌───────▼───────┐
    │ Orchestration │      │  apps/agents    │    │    Meetings   │
    │   PlanSession │      │   Runtime       │    │               │
    ├───────────────┤      ├─────────────────┤    │               │
    │ • taskId      │      │ • runId         │    │               │
    │ • input       │      │ • messages      │    │               │
    │ • output      │      │ • parts         │    │               │
    │ • status      │      │ • tool_calls    │    │               │
    │ • logs        │      │                 │    │               │
    └───────────────┘      └─────────────────┘    └───────────────┘
```

### 3.2 数据流向

| 层级 | 职责 | 数据粒度 |
|------|------|---------|
| **AgentSession** | 统一上下文容器 | Plan/Meeting 级别的元信息 |
| **PlanSession** (Orchestration) | 任务输入输出 | 每个 Task 的 input/output/status |
| **Runtime** (apps/agents细节 | messages,) | Agent 执行 parts, tool_calls |

---

## 4. 核心实现变更

### 4.1 AgentSession 统一管理

- `apps/agents` 成为 AgentSession 的唯一管理者
- 每个 Task 对应一个 AgentSession（不再 plan+agent 复用会话）
- Session 直接存储 messages（支持容量治理，默认 1200 条）

### 4.2 PlanSession 轻量视图

- `orchestration` 侧新增 PlanSession
- 仅记录任务输入输出与状态，不记录工具调用细节
- 通过 `planSession.tasks[].agentSessionId/agentRunId` 关联 AgentSession

### 4.3 编排与执行解耦

- `orchestration` 负责计划拆解、任务依赖调度、状态管理
- `apps/agents` 负责 Task 级执行与会话生命周期
- 执行接口返回 `response + runId + sessionId`

---

## 5. 相关文档索引

- 计划主文档：`docs/plan/MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md`
- 开发沉淀：`docs/development/MEETING_ORCHESTRATION_EXECUTION_MASTER_PLAN.md`
- 架构设计：`docs/architecture/AGENT_ORCHESTRATION_ARCHITECTURE_DESIGN.md`
- 时序图：`docs/architecture/AGENT_ORCHESTRATION_SEQUENCE_DIAGRAMS.md`
