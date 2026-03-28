# Plan: Orchestration Planner 工具驱动输出改造

- 日期: 2026-03-29
- 状态: pending
- 影响范围: orchestration planner、step dispatcher、builtin tools、LLM 输出稳定性

---

## 一、问题背景

### 1.1 现状

Planner 在 `phaseGenerate` 和 `phasePostExecute` 阶段通过"输出纯文本 JSON → 系统解析"完成任务创建和执行后决策。JSON 结构完全靠 prompt 文本中的样例引导，没有强约束。

### 1.2 问题表现

| 症状 | 根因 |
|------|------|
| postExecute 返回 `action` 而非 `nextAction`，被降级为 stop | generate 阶段用 `action`，postExecute 用 `nextAction`，LLM 在同一 session 内混淆 |
| LLM 输出非法 JSON 结构（缺字段、多字段、字段类型错误） | 纯 prompt 引导无强约束，`response_format: json_object` 只保证合法 JSON 不保证结构 |
| 解析失败直接降级 stop，编排终止 | 无重试回灌机制 |
| Planner 输出确认性文本而非 JSON | prompt 中规则噪声太多，核心指令被淹没 |

### 1.3 对比：为什么工具调用稳定

同一系统中工具调用（`<tool_call>` 协议）的输出稳定性远高于 Planner 的纯文本 JSON 输出，原因：

| 维度 | 工具调用 | Planner 纯文本 JSON |
|------|---------|-------------------|
| 参数约束 | JSON Schema 定义 required/type/enum | 一行样例字符串 |
| 校验反馈 | `getToolInputPreflightError` + repair 回灌 | 无，直接降级 stop |
| 字段名冲突 | 每个工具独立定义 | generate 用 `action`，postExecute 用 `nextAction` |
| 上下文噪声 | 工具列表结构清晰 | ~600 行混杂 prompt |

### 1.4 核心思路

**将 Planner 的"输出方式"从纯文本 JSON 改为工具调用。** 四阶段调度流不变，只是 Planner 在 generate 和 postExecute 阶段通过调用专用工具完成输出，获得工具调用链路天然的参数校验 + 重试回灌能力。

---

## 二、方案设计

### 2.1 总体架构

```
Before:
  dispatcher → plannerService.generateNextTask()
    → LLM 输出纯文本 JSON
    → tryParseJson() + 手动字段校验
    → 返回 GenerateNextTaskResult
  dispatcher → 从返回值中提取 task 信息 → 创建 task → 推进 preExecute

After:
  dispatcher → plannerService.generateNextTask()
    → LLM 调用 submit-task 工具（参数有 JSON Schema 约束）
    → 参数校验失败 → 自动 repair 回灌 → LLM 重试（已有机制）
    → 参数校验通过 → handler 创建 task 并返回完整 task 信息
    → LLM 看到工具返回结果 → 输出最终文本（包含工具结果摘要）
    → plannerService 从 LLM 最终文本 或 DB 中获取已创建的 task
  dispatcher → 从 DB 读取 task → 推进 preExecute
```

### 2.2 新增工具定义

#### 工具 A: `orchestration.submit-task`

**用途**: 替代 phaseGenerate 阶段的纯文本 JSON 输出。Planner 调用此工具提交任务定义。

**Tool ID**: `builtin.sys-mg.mcp.orchestration.submit-task`

**参数 (JSON Schema 格式 B)**:

```typescript
{
  type: 'object',
  required: ['planId', 'action', 'title', 'description'],
  additionalProperties: false,
  properties: {
    planId:          { type: 'string', description: '计划 ID' },
    action:          { type: 'string', enum: ['new', 'redesign'], description: 'new=新建任务, redesign=重新设计失败任务' },
    title:           { type: 'string', description: '任务标题（简明扼要）' },
    description:     { type: 'string', description: '具体执行指令（输入、动作、产出）' },
    priority:        { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: '优先级，默认 medium' },
    taskType:        { type: 'string', enum: ['general', 'research', 'development.plan', 'development.exec', 'development.review'], description: '任务类型' },
    agentId:         { type: 'string', description: '指定执行者 agent ID（从 list-agents 结果中选择）' },
    requiredTools:   { type: 'array', items: { type: 'string' }, description: '任务所需工具 ID 列表' },
    reasoning:       { type: 'string', description: '生成此任务的推理依据' },
    redesignTaskId:  { type: 'string', description: 'action=redesign 时必填，目标 task ID' },
    isGoalReached:   { type: 'boolean', description: '为 true 时表示计划目标已达成，不创建 task' },
  }
}
```

**Handler 逻辑**:

1. `isGoalReached === true` → 不创建 task，返回 `{ goalReached: true, message: '计划目标已达成' }`
2. `action === 'redesign'` → 校验 `redesignTaskId` 必填 → 调用 `incrementalPlanningService.redesignFailedTask()` → 返回完整 task 信息
3. `action === 'new'` → 调用 `incrementalPlanningService.createTaskFromPlannerOutput()` → 返回完整 task 信息

**返回值（完整 task 信息）**:

```json
{
  "taskId": "69c802b6da777c1aa8433a90",
  "title": "step1 选定最高优先级需求",
  "description": "...",
  "status": "assigned",
  "priority": "high",
  "taskType": "general",
  "order": 0,
  "assignment": {
    "executorType": "agent",
    "executorId": "698a0bd7db9f7e6b8cca4171"
  }
}
```

#### 工具 B: `orchestration.report-task-run-result`

**用途**: 替代 phasePostExecute 阶段的纯文本 JSON 输出。Planner 调用此工具报告 task 执行运行结果的决策。

**Tool ID**: `builtin.sys-mg.mcp.orchestration.report-task-run-result`

**参数 (JSON Schema 格式 B)**:

```typescript
{
  type: 'object',
  required: ['planId', 'action', 'reason'],
  additionalProperties: false,
  properties: {
    planId:          { type: 'string', description: '计划 ID' },
    action:          { type: 'string', enum: ['generate_next', 'stop', 'redesign', 'retry'], description: '下一步动作' },
    reason:          { type: 'string', description: '决策原因' },
    redesignTaskId:  { type: 'string', description: 'action=redesign 时必填，目标 task ID' },
    nextTaskHints:   { type: 'array', items: { type: 'string' }, description: '下一步任务提示' },
  }
}
```

**Handler 逻辑**:

1. `action === 'redesign'` → 校验 `redesignTaskId` 必填
2. 不做业务操作（决策由 dispatcher 消费），只做参数校验
3. 返回确认结果：`{ action, reason, accepted: true }`

### 2.3 P0-1: 字段名统一

**规则**: 全部统一为 `action`。

| 阶段 | 旧字段名 | 新字段名 | 合法值 |
|------|---------|---------|--------|
| generate | `action` | `action` (不变) | `new`, `redesign` |
| postExecute | `nextAction` | `action` | `generate_next`, `stop`, `redesign`, `retry` |
| preExecute | `allowExecute` | `allowExecute` (不变) | boolean |

**代码改动**:

- `PostExecutionDecision` 接口：`nextAction` → `action`
- `executePostTask` 解析层：优先取 `parsed.action`，兼容 `parsed.nextAction`
- `buildPostTaskContext` prompt：schema 样例中 `nextAction` → `action`
- `phasePostExecute`：`decision.nextAction` → `decision.action`

### 2.4 P0-2: 非工具调用响应的兜底

有了工具调用后，参数校验失败的重试回灌由工具调用链路自动完成。

但需处理一种退化情况：**LLM 不调用工具而直接输出 JSON 文本**。

**兜底策略**: 在 `generateNextTask` / `executePostTask` 中，如果最终响应不包含工具调用结果的标志（如 `taskId` 或 `accepted`），尝试按旧逻辑 `tryParseJson` 解析文本 JSON，作为向后兼容 fallback。

这样在以下情况仍可工作：
- LLM 未遵循工具调用指令（概率低但可能）
- Agent 未绑定新工具（过渡期兼容）
- 非 OpenAI provider 可能不完美支持 tool_call 协议

### 2.5 Dispatcher 集成方式（方案 A: 工具输出模式）

四阶段流不变。改动集中在 Planner 的三个方法内部：

#### phaseGenerate 适配

```
Before:
  generateNextTask() → 返回 GenerateNextTaskResult
    dispatcher 从中取 task 信息 → createTaskFromPlannerOutput()

After:
  generateNextTask() → Planner 调用 submit-task 工具 → handler 内部已创建 task
    → 返回 GenerateNextTaskResult（从 DB 查询已创建的 task）
    dispatcher 从返回值取 taskId → 从 DB 读取 task（已存在）→ 跳过 createTaskFromPlannerOutput
```

**关键变化**：`phaseGenerate` 中 `createTaskFromPlannerOutput` 不再由 dispatcher 调用，而是由工具 handler 调用。dispatcher 只需从 DB 读取已创建的 task。

#### phasePostExecute 适配

```
Before:
  executePostTask() → 从纯文本 JSON 解析 PostExecutionDecision

After:
  executePostTask() → Planner 调用 report-task-run-result 工具 → 参数有 enum 约束
    → 从 LLM 最终文本中提取决策（工具返回值会被包含在文本中）
    → fallback: tryParseJson 旧逻辑
```

### 2.6 Prompt 调整

在 `buildIncrementalPlannerPrompt` 中：
- 移除纯文本 JSON schema 样例
- 改为引导 Planner 使用 `submit-task` 工具
- 保留角色边界、步骤引导等指令

在 `buildPostTaskContext` 中：
- 移除纯文本 JSON schema 样例
- 改为引导 Planner 使用 `report-task-run-result` 工具

---

## 三、改动文件清单

### 3.1 工具层（新增）

| 文件 | 改动 |
|------|------|
| `apps/agents/src/modules/tools/builtin-tool-catalog.ts` | 新增 2 个工具定义（submit-task, report-task-run-result） |
| `apps/agents/src/modules/agents/agent.constants.ts` | 新增 2 个 ORCHESTRATION_TOOL_IDS 常量 |
| `apps/agents/src/modules/tools/builtin/orchestration-tool-handler.service.ts` | 新增 2 个 handler 方法 |
| `apps/agents/src/modules/tools/tool-execution-dispatcher.service.ts` | 新增 2 条路由 |

### 3.2 Planner 层（修改）

| 文件 | 改动 |
|------|------|
| `src/modules/orchestration/planner.service.ts` | `generateNextTask`: prompt 改为引导工具调用，结果解析适配工具返回值 + fallback 旧逻辑 |
| `src/modules/orchestration/planner.service.ts` | `executePostTask`: prompt 改为引导工具调用，结果解析适配 + fallback；`PostExecutionDecision.nextAction` → `action` |
| `src/modules/orchestration/planner.service.ts` | `buildIncrementalPlannerPrompt`: 移除纯文本 JSON schema，添加工具调用引导 |

### 3.3 Context 层（修改）

| 文件 | 改动 |
|------|------|
| `src/modules/orchestration/services/orchestration-context.service.ts` | `buildPostTaskContext`: schema 中 `nextAction` → `action`，添加工具调用引导 |

### 3.4 Dispatcher 层（修改）

| 文件 | 改动 |
|------|------|
| `src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | `phaseGenerate`: 适配工具已创建 task 的场景（从 DB 读取）；`decision.nextAction` → `decision.action` |

### 3.5 Seed 数据（修改）

| 文件 | 改动 |
|------|------|
| `scripts/seed/mcp-profile.ts` | planner 相关角色（executive-lead 等）绑定新工具 |

---

## 四、执行顺序

| 顺序 | 任务 | 依赖 |
|------|------|------|
| 1 | P0-1: 字段名统一 `nextAction` → `action`（接口 + 解析层 + prompt + dispatcher） | 无 |
| 2 | 新增工具定义 + 常量 + 路由（catalog / constants / dispatcher） | 无 |
| 3 | 新增工具 handler 实现（submit-task / report-task-run-result） | 步骤 2 |
| 4 | Planner prompt 改造（引导工具调用、移除纯文本 schema） | 步骤 1, 2 |
| 5 | Planner 结果解析适配（工具返回值提取 + fallback 旧逻辑） | 步骤 3, 4 |
| 6 | Dispatcher 适配（phaseGenerate 从 DB 读取 task） | 步骤 5 |
| 7 | Seed 数据更新（角色绑定新工具） | 步骤 2 |
| 8 | 编译验证（lint + typecheck） | 步骤 1-7 |

---

## 五、风险与兼容性

### 5.1 向后兼容

- **旧数据/旧 session**: `executePostTask` 解析层同时接受 `action` 和 `nextAction`
- **未绑定新工具的 agent**: fallback 到 tryParseJson 旧逻辑，不会中断
- **非 OpenAI provider**: `<tool_call>` 协议是 prompt 层面的，不依赖 API 层 function calling，所有 provider 均支持

### 5.2 风险项

| 风险 | 缓解 |
|------|------|
| LLM 不调用工具而直接输出 JSON | fallback 旧逻辑兜底 |
| submit-task handler 创建 task 后 dispatcher 重复创建 | dispatcher 检测 DB 中已有 task 则跳过创建 |
| 工具 handler 中 createTaskFromPlannerOutput 缺少 plannerContext | handler 从 plan DB 获取必要上下文 |
| Seed 未执行导致角色缺少新工具 | 文档中标注需运行 seed |

### 5.3 不变的部分

- 四阶段调度流（idle → generating → pre_execute → executing → post_execute）
- preExecute 阶段（仍用纯文本 JSON，因为 `allowExecute` 结构极简，不值得工具化）
- executor 执行路径
- session 隔离机制（本次另一个 PR 已修复）
