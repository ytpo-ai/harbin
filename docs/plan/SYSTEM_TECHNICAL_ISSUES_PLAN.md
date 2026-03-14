# 系统技术债与架构问题清单

本文档记录在 CTO Agent 日常研发工作流分析过程中发现的所有系统现有问题，按模块分类并标注代码位置。

---

## 一、编排模块（Orchestration）

### 1.1 编排任务无 `requirementId` 关联

**问题描述**：`orchestration_tasks` schema 无字段关联回 `ei_requirements`，导致任务完成后无法自动触发需求状态更新，闭环断裂。

**代码位置**：
- `backend/src/shared/schemas/orchestration-task.schema.ts` — 任务数据模型，缺少 `requirementId` 字段

**相关文件**：
- `backend/src/modules/orchestration/orchestration.service.ts` — 任务执行与状态流转逻辑
- `backend/src/modules/orchestration/planner.service.ts` — 任务拆解服务

---

### 1.2 编排 MCP 工具强依赖会议上下文

**问题描述**：全部 10 个编排工具 + 3 个会议工具在执行前调用 `assertMeetingContext()`，无会议上下文时抛错。定时调度（cron）、CTO 主动触发等非会议场景无法使用编排 MCP 工具。

**代码位置**：
- `backend/apps/agents/src/modules/tools/tool.service.ts:1984-1996` — `assertMeetingContext()` 方法定义
- `backend/apps/agents/src/modules/tools/tool.service.ts:2153` — 首次调用位置
- `backend/apps/agents/src/modules/tools/tool.service.ts` — 共 11 处调用（1984, 2153, 2198, 2228, 2288, 2306, 2327, 2357, 2476, 2532, 2575）

**影响范围**：
- 定时调度场景无法工作（`scheduler.service.ts` 触发时无 meetingId）
- CTO Agent 非会议场景无法调用编排工具

---

### 1.3 编排执行使用内存锁，不持久化

**问题描述**：`runningPlans` 是内存中的 `Set<string>`，进程重启后丢失，无法防止并发执行。

**代码位置**：
- `backend/src/modules/orchestration/orchestration.service.ts:43` — `private readonly runningPlans = new Set<string>()` 声明
- `backend/src/modules/orchestration/orchestration.service.ts:511-520` — `runPlanAsync` 中的锁检查与添加逻辑

**具体代码**：
```typescript
// orchestration.service.ts:511-520
if (this.runningPlans.has(runKey)) {
  return { accepted: true, planId, status: 'running', alreadyRunning: true };
}
this.runningPlans.add(runKey);
// ... 执行完成后
this.runningPlans.delete(runKey);
```

**风险**：进程重启后 runningPlans 清空，多个实例同时执行同一计划。

---

### 1.4 任务智能分配使用硬编码关键词匹配

**问题描述**：任务分配算法使用简单的 `text.includes()` 关键词匹配判断任务类型（如 email、research），不够智能。

**代码位置**：
- `backend/src/modules/orchestration/orchestration.service.ts:1499-1512` — `isEmailTask()` 方法
- `backend/src/modules/orchestration/orchestration.service.ts:1515-1527` — `isResearchTask()` 方法

**具体代码**：
```typescript
// orchestration.service.ts:1503-1512
private isEmailTask(title: string, description: string): boolean {
  const text = `${title} ${description}`.toLowerCase();
  return (
    text.includes('send email') ||
    text.includes('email to') ||
    text.includes('发送邮件') ||
    text.includes('发邮件') ||
    text.includes('gmail') ||
    text.includes('@')
  );
}
```

---

### 1.5 任务完成验证使用正则规则匹配

**问题描述**：任务完成验证依赖 Agent 输出中的特定标记（如 `EMAIL_SEND_PROOF`、`RESEARCH_EXECUTION_PROOF`），使用正则提取验证，不够可靠。

**代码位置**：
- `backend/src/modules/orchestration/orchestration.service.ts:1242-1266` — `extractEmailSendProof()` 方法
- `backend/src/modules/orchestration/orchestration.service.ts:1761-1783` — `validateResearchExecutionProof()` 方法

**具体代码**：
```typescript
// orchestration.service.ts:1244
const markerMatch = text.match(/EMAIL_SEND_PROOF\s*:\s*(\{[\s\S]*?\})/i);

// orchestration.service.ts:1762
const markerMatch = text.match(/RESEARCH_EXECUTION_PROOF\s*:\s*(\{[\s\S]*?\})/i);
```

**相关配置**：
- `backend/src/modules/orchestration/orchestration.service.ts:1160` — 研究任务类型定义 `city_population | generic_research`
- `backend/src/modules/orchestration/orchestration.service.ts:1733-1759` — 研究输出契约构建

---

### 1.6 调度器触发使用内存锁

**问题描述**：与编排服务类似，调度器也使用内存 `Set` 防止并发触发。

**代码位置**：
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts:39` — `private readonly runLocks = new Set<string>()`

---

## 二、Agent Runtime 模块

### 2.1 OpenCode 执行角色门禁硬编码

**问题描述**：Runtime 角色准入仅允许 `devops-engineer`、`fullstack-engineer`、`technical-architect` 三个角色，其他角色（包括 CTO）无法触发 OpenCode 执行。

**代码位置**：
- `backend/apps/agents/src/modules/agents/agent.service.ts:177-181` — `OPENCODE_ALLOWED_ROLE_CODES` 常量定义
- `backend/apps/agents/src/modules/agents/agent.service.ts:590-602` — `assertOpenCodeExecutionGate()` 方法

**具体代码**：
```typescript
// agent.service.ts:177-181
const OPENCODE_ALLOWED_ROLE_CODES = new Set([
  'devops-engineer',
  'fullstack-engineer',
  'technical-architect',
]);

// agent.service.ts:598-601
if (!OPENCODE_ALLOWED_ROLE_CODES.has(roleCode)) {
  throw new BadRequestException(
    `OpenCode execution role not allowed: ${roleCode || 'unknown'}. Allowed roles: devops-engineer, fullstack-engineer, technical-architect`,
  );
}
```

---

### 2.2 Runtime 执行使用内存 Promise Chain 锁

**问题描述**：使用内存 `Map<string, Promise<void>>` 实现串行执行锁，进程重启后锁丢失，无法防止并发。

**代码位置**：
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts:31` — `private readonly lockTails = new Map<string, Promise<void>>()` 声明
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts:803-831` — `acquireLock()` 方法实现

**具体代码**：
```typescript
// runtime-orchestrator.service.ts:803-814
private async acquireLock(lockKey: string): Promise<() => void> {
  const previous = this.lockTails.get(lockKey) || Promise.resolve();
  let resolveCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve;
  });
  const nextTail = previous
    .catch(() => undefined)
    .then(() => current);
  this.lockTails.set(lockKey, nextTail);
  // ...
}
```

**风险**：
- 进程重启后锁丢失，不同实例可能同时执行同一 run
- 无法实现断点重入（重启后丢失执行位置）

---

### 2.3 预算门禁是异步暂停，非硬阻断

**问题描述**：预算超限时触发 `permission.asked` 事件并暂停 run，而非硬性阻断。需人工审批后才能继续。

**代码位置**：
- `backend/apps/agents/src/modules/agents/agent.service.ts:720-800` — `applyAgentBudgetGate()` 方法
- `backend/apps/agents/src/modules/agents/agent.service.ts:802-834` — `parseAgentBudgetConfig()` 方法
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts:259-263` — `pauseRunWithActor()` 方法
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts:295-299` — `resumeRunWithActor()` 方法
- `backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts:386` — `permission.asked` 事件发射

**具体代码**：
```typescript
// agent.service.ts:779-795
await this.runtimeOrchestrator.pauseRunWithActor(runtimeContext.runId, {
  actorId: context?.actor?.employeeId || 'system',
  actorType: context?.actor?.employeeId ? 'employee' : 'system',
  reason: 'quota exceeded, approval required',
});
await this.runtimeOrchestrator.recordPermissionAsked({
  runId: runtimeContext.runId,
  // ...
  payload: {
    requestType: 'quota.exceeded',
    message: 'Agent quota exceeded and approval is required to continue execution',
  },
});
```

---

### 2.4 工具执行分发使用巨型 switch-case

**问题描述**：`tool.service.ts` 中 `executeToolImplementation` 是一个巨大的 switch-case，扩展性差。

**代码位置**：
- `backend/apps/agents/src/modules/tools/tool.service.ts` — 约 3720 行，switch-case 分散在多处

---

## 三、需求管理模块（EI）

### 3.1 无需求管理 MCP 工具

**问题描述**：需求管理仅有 HTTP API（`/engineering-intelligence/requirements/*`），Agent 无法通过 MCP 工具操作需求。

**代码位置**：
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.controller.ts:128-182` — 需求相关 API 端点
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts` — 需求 CRUD 服务

**涉及 API**：
- `GET /engineering-intelligence/requirements` — 列表
- `GET /engineering-intelligence/requirements/:id` — 详情
- `POST /engineering-intelligence/requirements` — 创建
- `PATCH /engineering-intelligence/requirements/:id/status` — 状态流转
- `PATCH /engineering-intelligence/requirements/:id/assign` — 分配
- `POST /engineering-intelligence/requirements/:id/comments` — 讨论
- `POST /engineering-intelligence/requirements/:id/sync-github` — GitHub 同步

---

### 3.2 GitHub 同步仅创建不关闭

**问题描述**：`syncRequirementToGithub` 仅创建 Issue 并回写映射，不会在需求 `done` 时关闭 Issue。

**代码位置**：
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts` — `syncRequirementToGithub()` 方法（约 1250-1537 行区间）

---

### 3.3 需求状态机不完整

**问题描述**：需求状态为 `todo → assigned → in_progress → review → done`，支持 `blocked`，但：
- 从 `done` 回退时不会重新 open GitHub Issue
- 任务→需求回写存在竞态条件风险

**代码位置**：
- `backend/apps/engineering-intelligence/src/schemas/ei-requirement.schema.ts` — 需求数据模型

---

## 四、工具服务模块

### 4.1 速率限制与熔断使用内存 Map

**问题描述**：`rateLimitHits` 和 `circuitBreakers` 使用内存 `Map`，不持久化。

**代码位置**：
- `backend/apps/agents/src/modules/tools/tool.service.ts:122-123` — 内存 Map 声明
```typescript
private readonly rateLimitHits = new Map<string, number[]>();
private readonly circuitBreakers = new Map<string, CircuitState>();
```

---

### 4.2 工具 ID 规范化依赖运行时解析

**问题描述**：工具 ID 在运行时统一归一化到 canonical，但依赖运行时解析，调试困难。

**相关代码**：
- `backend/apps/agents/src/modules/agents/agent.service.ts:154` — `ORCHESTRATION_TOOL_ID_SET` 定义
- `backend/apps/agents/src/modules/agents/agent.service.ts:155-174` — `LEGACY_TOOL_ID_ALIASES` 别名映射

---

## 五、待确认/待调研问题

以下问题在分析过程中提及但未深入定位：

1. **EI 同步补偿机制的边界情况**：run 终态后触发同步，失败进入重试，重试上限后的处理逻辑
2. **Hook 消费幂等性实现**：虽然文档提到消费者需去重，但具体实现依赖方是否遵循
3. **多环境同步冲突处理**：`local/ecds` 场景下的冲突检测与解决策略
4. **内存锁在多实例部署下的行为**：当前实现假设单实例，多实例需分布式锁

---

## 六、问题优先级建议

| 优先级 | 问题 | 所属模块 | 与 CTO 工作流关联 |
|--------|------|----------|-------------------|
| P0 | 需求无 MCP 工具 | EI | 阻断 |
| P0 | 编排任务无 requirementId 关联 | Orchestration | 阻断 |
| P0 | 编排工具强依赖会议上下文 | Orchestration | 阻断 |
| P1 | OpenCode 角色门禁硬编码 | Runtime | 影响 CTO 权限 |
| P1 | GitHub 同步不关闭 Issue | EI | 影响闭环 |
| P2 | 内存锁不持久化 | Runtime/Orchestration | 稳定性问题 |
| P2 | 任务验证规则匹配不可靠 | Orchestration | 质量问题 |
| P3 | 工具执行分发 switch-case | Tools | 维护性问题 |

---

## 七、关联文档

- 改造计划：`docs/plan/CTO_AGENT_DAILY_DEV_WORKFLOW_PLAN.md`
- 需求管理功能文档：`docs/feature/ENGINEERING_INTELLIGENCE.md`
- 编排任务功能文档：`docs/feature/ORCHETRATION_TASK.md`
- Agent Runtime 功能文档：`docs/feature/AGENT_RUNTIME.md`
