# Agent 详情页日志列表优化 + Run 扣分记录对接

## 背景

### 关联上下文
- 后端 Agent Run 评分系统已实现（`docs/issue/PLAN_OPTIMAZE.md` #18），提供 3 个 API 端点
- 前端 Agent 详情页日志 Tab（`LogTab.tsx`）当前按 runId 聚合 `AgentActionLog` 为 `TaskGroup`，但列表展示同一 run 的多条中间状态（started / step_started / completed），信息冗余
- 评分 API 无前端消费端，需要在日志 Tab 中对接

### 目标
1. **日志列表精简**：一个 Run 只展示一条记录（最终状态），从任务开始到完成/失败的完整信息
2. **详情懒加载**：点击 Run 才加载执行流程步骤详情和评分数据
3. **详情分 Tab 展示**：展开后分为「执行流程」「原始信息」「扣分记录」三个视图

## 现状分析

### 当前日志列表问题
- `useLogState.ts` 从 `/agent-action-logs` 获取日志条目，按 `runId` 聚合成 `TaskGroup`
- TaskGroup 折叠态展示：标题 + 状态 badge + 上下文类型 + 时间戳 + 耗时 + 事件数 + 环境标签 + 最后 action 摘要
- TaskGroup 展开态：直接展示所有 action 的时间线 或 原始 JSON，通过「切换可读/切换原始」按钮切换
- 问题：同一个 run 的多个中间状态（启动、步骤开始、工具调用、完成）全部展示，信息密度过高；客户端聚合 action log 来拼凑 run 视图，逻辑复杂且不可靠

> **[v2 变更]** 数据源从 AgentActionLog 客户端聚合改为直接查询 `agent_runs` collection。
> AgentRun schema 本身就是 run 级别数据，一条记录 = 一次执行，天然满足「一条显示一个任务」的需求，
> 消除了客户端 ~80 行的 TaskGroup 聚合逻辑。

### 后端评分 API（已就绪）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/agents/runtime/runs/:runId/score` | GET | 获取单个 Run 的评分详情 |
| `/agents/runtime/scores` | GET | 分页查询评分列表（支持 agentId/日期/分数筛选） |
| `/agents/runtime/scores/stats` | GET | Agent 级聚合统计（平均分/最高分/最低分/top 规则频次） |

本次仅对接第 1 个端点（按 runId 获取单个评分）。

### > **[v2 新增]** 后端 AgentRun 现状分析

**AgentRun schema**（collection: `agent_runs`）已有字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `run-<uuid>` 格式，唯一标识 |
| `agentId` | string | 所属 Agent |
| `agentName` | string | Agent 名称 |
| `taskTitle` | string | 任务标题 |
| `taskDescription` | string | 任务描述 |
| `status` | enum | `pending / running / completed / failed / cancelled / paused` |
| `currentStep` | number | 当前执行步骤 |
| `startedAt` | Date | 开始时间 |
| `finishedAt` | Date? | 结束时间 |
| `error` | string? | 错误信息 |
| `sessionId` | string? | 关联 session |
| `taskId` | string? | 关联 task |
| `roleCode` | string? | 角色代码 |
| `executionChannel` | enum? | `native / opencode` |
| `metadata` | object? | 扩展元数据（含 planId、meetingContext 等） |
| `score` | number? | 评分冗余副本 |

**已有索引**：`{ agentId: 1, createdAt: -1 }` — 支持按 agent 分页查询。

**缺口**：
1. **无列表查询 API**：当前仅有 `GET /agents/runtime/runs/:runId`（单条），无分页列表端点
2. **单条接口返回字段不全**：`getRun()` 方法仅投影部分字段，未返回 `taskTitle`、`agentName`、`metadata`、`score`

### 评分数据结构

```typescript
interface AgentRunScore {
  id: string;
  runId: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  score: number;         // 0-100
  baseScore: number;     // 100
  totalDeductions: number;
  stats: {
    totalRounds: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
  };
  deductionsByRule: Record<string, { count: number; totalPoints: number }>;
  deductions: AgentRunScoreDeduction[];
  ruleVersion: string;
}

interface AgentRunScoreDeduction {
  ruleId: string;    // D1~D12
  points: number;    // 负数
  round: number;
  toolId?: string;
  detail?: string;
  timestamp: string;
}
```

### 扣分规则 D1-D12

| 规则 | 扣分 | 含义 |
|---|---|---|
| D1 | -5 | 工具参数预检失败 |
| D2 | -8 | 多 tool_call 批量输出（每个丢弃的调用） |
| D3 | -10 | 连续两轮调用相同工具 |
| D4 | -8 | 工具执行失败（非参数类） |
| D5 | -5 | 工具执行失败（参数类） |
| D6 | -10 | 调用未授权工具 |
| D7 | -3 | tool_call JSON 解析失败 |
| D8 | -5 | 文本意图未执行（说要调但没 tool_call） |
| D9 | -5 | Planner 纯文本重试触发 |
| D10 | -3 | 空/无意义响应 |
| D11 | -15 | 达到最大轮次上限 |
| D12 | -2 | LLM 调用超时/网络错误 |

## 实施步骤

### > **[v2 新增]** Step 0：后端 — AgentRun 列表接口 + getRun 字段补全

本步骤为 v2 新增，解决前端数据源从 ActionLog 切换到 AgentRun 所需的后端缺口。

#### Step 0.1：RuntimePersistence — 新增 `listRunsByAgent()` 分页查询

**文件**：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

**改动**：
```typescript
async listRunsByAgent(
  agentId: string,
  options?: {
    status?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  },
): Promise<{ total: number; page: number; pageSize: number; runs: AgentRun[] }>
```

- 查询 `agent_runs` collection，`filter: { agentId }`
- 可选筛选：`status`（精确匹配）、`from/to`（`startedAt` 范围）
- 排序：`{ startedAt: -1 }`（最新在前）
- 分页：默认 `page=1, pageSize=20`，上限 `pageSize=100`
- 利用已有索引 `{ agentId: 1, createdAt: -1 }`

#### Step 0.2：RuntimeOrchestrator — 新增 `listRuns()` + 补全 `getRun()` 返回字段

**文件**：`backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`

**改动**：

1. **新增 `listRuns()`**：透传 persistence 的 `listRunsByAgent()`，对每条 run 投影为前端所需字段集（见下方 RunListItem）

2. **补全 `getRun()` 返回字段**：在现有返回基础上增加：
   - `taskTitle: run.taskTitle`
   - `taskDescription: run.taskDescription`
   - `agentName: run.agentName`
   - `metadata: run.metadata`
   - `score: run.score`

#### Step 0.3：RuntimeController — 新增 `GET /agents/runtime/runs` 列表端点

**文件**：`backend/apps/agents/src/modules/runtime/runtime.controller.ts`

**改动**：
```typescript
@Get('runs')
async listRuns(
  @Req() req: Request & { userContext?: GatewayUserContext },
  @Query('agentId') agentId: string,          // 必填
  @Query('status') status?: string,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('page') page?: string,
  @Query('pageSize') pageSize?: string,
)
```

**注意**：该端点必须放在 `@Get('runs/:runId')` 之前，避免路由冲突（`runs` 被当作 `runId` 匹配）。

**返回格式**：
```json
{
  "success": true,
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3,
  "items": [
    {
      "id": "run-xxx",
      "agentId": "agent-xxx",
      "agentName": "Coder-Van",
      "taskTitle": "执行开发计划中任务",
      "taskDescription": "...",
      "status": "completed",
      "currentStep": 5,
      "startedAt": "2026-03-31T10:00:00Z",
      "finishedAt": "2026-03-31T10:05:30Z",
      "error": null,
      "sessionId": "session-xxx",
      "taskId": "task-xxx",
      "roleCode": "coder",
      "executionChannel": "native",
      "metadata": { "planId": "xxx", ... },
      "score": 85
    }
  ]
}
```

### Step 1：前端 Service 层 — 新增 API 调用与类型

**文件**：`frontend/src/services/agentService.ts`

**改动**：

> **[v2 变更]** 除评分接口外，新增 AgentRun 列表接口调用。

1. > **[v2 新增]** 新增 `AgentRunListItem` 接口（对齐后端 Step 0.3 返回的 items 字段）
2. > **[v2 新增]** 新增 `listAgentRuns(agentId, filters?)` 方法 — 调用 `GET /agents/runtime/runs?agentId=xxx`
3. 新增 `AgentRunScoreDeduction` 接口
4. 新增 `AgentRunScore` 接口
5. 新增 `getRunScore(runId: string): Promise<AgentRunScore | null>` 方法
   - 调用 `GET /agents/runtime/runs/:runId/score`
   - 404 时返回 `null`（try/catch 处理）

### Step 2：Constants — 新增评分相关映射与工具函数

**文件**：`frontend/src/components/agent-detail/constants.ts`

**改动**：
1. 新增 `SCORE_RULE_LABEL` 映射：`Record<string, string>`，D1~D12 → 中文描述
2. 新增 `getScoreBadgeClass(score: number): string`：
   - score ≥ 80 → 绿色（emerald）
   - score ≥ 60 → 黄色（amber）
   - score < 60 → 红色（rose）
3. 新增 `RunDetailTab` 类型：`'flow' | 'raw' | 'score'`
4. 新增 `RUN_DETAIL_TABS` 常量数组：
   - `{ key: 'flow', label: '执行流程' }`
   - `{ key: 'raw', label: '原始信息' }`
   - `{ key: 'score', label: '扣分记录' }`
5. > **[v2 新增]** 新增 `RUN_STATUS_META` 映射：run status → 中文标签 + badge 样式（沿用现有 `LOG_STATUS_META` 的颜色风格，但仅覆盖 `pending / running / completed / failed / cancelled / paused`）

### Step 3：Hook 重构 — useLogState 改为 AgentRun 数据源

**文件**：`frontend/src/components/agent-detail/hooks/useLogState.ts`

> **[v2 重大变更]** 数据源从 `agentActionLogService.getAgentActionLogs()` 切换为 `agentService.listAgentRuns()`。
> 移除 TaskGroup 客户端聚合逻辑（~80 行），直接使用后端返回的 run 列表。

**改动**：

1. > **[v2 变更]** **替换** 主查询数据源：
   - 移除 `agentActionLogService.getAgentActionLogs()` 调用
   - 改用 `agentService.listAgentRuns(agentId, filters)` 获取 run 列表
   - 返回数据直接作为列表项，无需客户端聚合
2. > **[v2 变更]** **移除** `taskGroups` 的 `useMemo` 聚合计算（~80 行 groupMap / resolveEnvironmentType / resolveMeetingTitle 等）
3. > **[v2 变更]** **移除** `latestRunIdFromLogs` 推导逻辑（列表第一条即为最新 run）
4. > **[v2 变更]** **简化** 筛选条件：`status`（直接传后端）、`from/to`（直接传后端）；移除 `contextType` 筛选（AgentRun 无此字段，后续可按 metadata 补充）
5. **移除** `taskViewModes` 状态（原 `'readable' | 'raw'` 切换）
6. **新增** `detailTabs` 状态：`Record<string, RunDetailTab>`，按 runId 记录当前选中的 tab，默认 `'flow'`
7. **新增** `runScores` 缓存状态：`Record<string, { loading: boolean; data: AgentRunScore | null; error?: string }>`
8. **新增** `loadRunScore(runId: string)` 方法：
   - 若 `runScores[runId]` 已有数据或正在加载，跳过
   - 否则设 loading → 调用 `agentService.getRunScore(runId)` → 写入缓存
9. **修改** `toggleExpanded(runId)` — 展开时自动触发 `loadRunScore(runId)`
10. **新增** `setDetailTab(runId: string, tab: RunDetailTab)` 方法
11. > **[v2 变更]** `approvalRunCandidates` 改为从 run 列表中筛选 `status === 'paused'` 的 run（原来从 action log 的 `details.status === 'asked'` 提取）
12. **保留** `runtimeRunQuery`（最新运行信息卡片仍从列表首条获取，或保持独立查询）

### Step 4：LogTab 组件重构

**文件**：`frontend/src/components/agent-detail/LogTab.tsx`

> **[v2 变更]** 列表数据源从 TaskGroup（action log 聚合）改为 AgentRunListItem（后端直接返回）。
> 列表项渲染从 `group.xxx` 改为 `run.xxx`，字段映射更直接。

#### 4.1 > **[v2 变更]** 筛选栏调整

- **保留**：日期范围（from/to）、状态筛选（pending/running/completed/failed/cancelled/paused）
- **移除**：`contextType` 下拉（AgentRun 无此字段）
- 筛选值直接传给后端 `listAgentRuns()` 的 query params

#### 4.2 折叠态（Run 列表项）

> **[v2 变更]** 数据直接来自 `AgentRunListItem`，无需从聚合的 action 中推导。

每个 Run 精简为一行摘要：

```
[状态图标] 任务标题  [状态badge]  [评分badge: 85分]  耗时: 5.5s  Agent: Coder-Van
```

- 状态图标：根据 `run.status` 展示（completed→v / failed→! / running→> / paused→|| / cancelled→x / pending→o）
- 状态 badge：`run.status` → `RUN_STATUS_META` 中文标签 + 颜色
- 评分 badge：从 `run.score` 字段读取（schema 上有冗余副本），有值时显示 `{score}分`（颜色按分段），无值不显示
- 任务标题：`run.taskTitle`
- 耗时：`run.finishedAt - run.startedAt` 计算，或运行中显示「进行中」
- Agent 名称：`run.agentName`
- **移除**：事件数、最后 action 摘要、环境标签（后续可从 metadata 中补充）

#### 4.3 展开态

顶部 Tab 栏：`[执行流程] [原始信息] [扣分记录]`

**「执行流程」Tab（flow）**：
- > **[v2 变更]** 展开时懒加载 `agentService.getRuntimeRunMessages(runId)` 获取 messages + parts
- 渲染为 message 时间线（复用现有 SessionDrawer 中的 message 渲染逻辑风格）
- 每条 message：角色 badge + 内容摘要 + 工具调用信息 + token/cost

**「原始信息」Tab（raw）**：
- > **[v2 变更]** 展示 AgentRun 原始数据（run 对象 JSON）而非 action log 数组
- `<pre>` 中 JSON.stringify(run, null, 2)

**「扣分记录」Tab（score）**：
- 展开时懒加载 `agentService.getRunScore(runId)` 获取评分详情
- 加载中 → 显示加载提示
- 无评分数据 → 显示「该 Run 暂无评分记录」
- 有评分数据 → 展示以下内容：

**评分概览区**（横向 4 个指标卡片）：
| 总评分 | 执行轮次 | 工具调用 | 工具成功率 |
|--------|---------|---------|-----------|
| `score`/100 | `stats.totalRounds` | `stats.totalToolCalls` | `successfulToolCalls / totalToolCalls` |

**扣分规则汇总表**（仅展示有触发的规则）：

| 规则 | 说明 | 触发次数 | 总扣分 |
|------|------|---------|--------|
| D1 | 工具参数预检失败 | 2 | -10 |
| D3 | 连续调用相同工具 | 1 | -10 |

- 来源：`deductionsByRule` 字段，过滤 `count > 0` 的规则

**扣分明细时间线**（默认折叠，点击「查看完整扣分明细」展开）：

每条扣分记录：
```
[D1] -5分  第3轮  工具: requirement.list  参数预检失败
```

- 来源：`deductions` 数组，按 `round` 升序排列

## 文件影响清单

> **[v2 变更]** 新增 3 个后端文件的改动

| 文件 | 改动类型 | 说明 |
|---|---|---|
| **后端** | | |
| `backend/.../runtime-persistence.service.ts` | **[v2 新增]** 新增方法 | `listRunsByAgent()` 分页查询 |
| `backend/.../runtime-orchestrator.service.ts` | **[v2 新增]** 修改 | `listRuns()` 新增 + `getRun()` 补全字段 |
| `backend/.../runtime.controller.ts` | **[v2 新增]** 新增端点 | `GET /agents/runtime/runs?agentId=xxx` |
| **前端** | | |
| `frontend/src/services/agentService.ts` | 新增 | AgentRunListItem 类型 + listAgentRuns + AgentRunScore 类型 + getRunScore |
| `frontend/src/components/agent-detail/constants.ts` | 新增 | 评分规则映射、分数颜色分段、详情 Tab 定义、RUN_STATUS_META |
| `frontend/src/components/agent-detail/hooks/useLogState.ts` | **[v2 重构]** | 数据源切换为 AgentRun；移除 ActionLog 聚合；新增评分懒加载 |
| `frontend/src/components/agent-detail/LogTab.tsx` | 重构 | 列表按 run 展示，折叠态精简，展开态 3-tab 布局 |

## 不在本次范围

- Agent 级聚合评分统计（`/scores/stats` 端点）— 后续迭代
- 编排页面的评分展示 — 评分只在 Agent 详情页日志 Tab 中展示
- 日志 Tab 顶部 3 个信息卡片（最新运行/同步状态/授权处理）— 保持不变
- `contextType` 筛选 — AgentRun 无此字段，后续可通过 metadata 补充
- 原有 `AgentActionLog` 查询和聚合逻辑 — 本次替换后不再使用，但暂不删除相关服务代码（可后续清理）
