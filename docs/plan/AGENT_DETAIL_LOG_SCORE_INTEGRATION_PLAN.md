# Agent 详情页日志列表优化 + Run 扣分记录对接

## 背景

### 关联上下文
- 后端 Agent Run 评分系统已实现（`docs/issue/PLAN_OPTIMAZE.md` #18），提供 3 个 API 端点
- 前端 Agent 详情页日志 Tab（`LogTab.tsx`）当前按 runId 聚合 `AgentActionLog` 为 `TaskGroup`，但列表展示同一 run 的多条中间状态（started / step_started / completed），信息冗余
- 评分 API 无前端消费端，需要在日志 Tab 中对接

### 目标
1. **日志列表精简**：一个 TaskGroup 只展示一条记录（最终状态），从任务开始到完成/失败的完整信息
2. **详情懒加载**：点击 TaskGroup 才加载执行流程步骤详情和评分数据
3. **详情分 Tab 展示**：展开后分为「执行流程」「原始信息」「扣分记录」三个视图

## 现状分析

### 当前日志列表问题
- `useLogState.ts` 从 `/agent-action-logs` 获取日志条目，按 `runId` 聚合成 `TaskGroup`
- TaskGroup 折叠态展示：标题 + 状态 badge + 上下文类型 + 时间戳 + 耗时 + 事件数 + 环境标签 + 最后 action 摘要
- TaskGroup 展开态：直接展示所有 action 的时间线 或 原始 JSON，通过「切换可读/切换原始」按钮切换
- 问题：同一个 run 的多个中间状态（启动、步骤开始、工具调用、完成）全部展示，信息密度过高

### 后端评分 API（已就绪）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/agents/runtime/runs/:runId/score` | GET | 获取单个 Run 的评分详情 |
| `/agents/runtime/scores` | GET | 分页查询评分列表（支持 agentId/日期/分数筛选） |
| `/agents/runtime/scores/stats` | GET | Agent 级聚合统计（平均分/最高分/最低分/top 规则频次） |

本次仅对接第 1 个端点（按 runId 获取单个评分）。

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

### Step 1：Service 层 — 新增评分 API 调用与类型

**文件**：`frontend/src/services/agentService.ts`

**改动**：
1. 新增 `AgentRunScoreDeduction` 接口
2. 新增 `AgentRunScore` 接口
3. 新增 `getRunScore(runId: string): Promise<AgentRunScore | null>` 方法
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
3. 新增 `TaskGroupDetailTab` 类型：`'flow' | 'raw' | 'score'`
4. 新增 `TASK_GROUP_DETAIL_TABS` 常量数组：
   - `{ key: 'flow', label: '执行流程' }`
   - `{ key: 'raw', label: '原始信息' }`
   - `{ key: 'score', label: '扣分记录' }`

### Step 3：Hook 重构 — useLogState 支持懒加载 + 评分

**文件**：`frontend/src/components/agent-detail/hooks/useLogState.ts`

**改动**：
1. **移除** `taskViewModes` 状态（原 `'readable' | 'raw'` 切换）
2. **新增** `detailTabs` 状态：`Record<string, TaskGroupDetailTab>`，按 groupKey 记录每个 TaskGroup 当前选中的 tab，默认 `'flow'`
3. **新增** `runScores` 缓存状态：`Record<string, { loading: boolean; data: AgentRunScore | null; error?: string }>`
4. **新增** `loadRunScore(runId: string)` 方法：
   - 若 `runScores[runId]` 已有数据或正在加载，跳过
   - 否则设 loading → 调用 `agentService.getRunScore(runId)` → 写入缓存
5. **修改** `toggleTaskExpanded(groupKey)` — 展开时自动触发 `loadRunScore(groupKey)`（groupKey 大多数情况下就是 runId）
6. **新增** `setDetailTab(groupKey: string, tab: TaskGroupDetailTab)` 方法
7. **对外暴露** `detailTabs`、`runScores`、`setDetailTab`；**移除** `taskViewModes`、`toggleTaskViewMode`

### Step 4：LogTab 组件重构

**文件**：`frontend/src/components/agent-detail/LogTab.tsx`

#### 4.1 折叠态（TaskGroup 列表项）

每个 TaskGroup 精简为一行摘要：

```
[状态图标] 任务标题  [状态badge]  [评分badge: 85分]  耗时: 3.2s  环境: 计划编排·XXX
```

- 状态图标：沿用现有逻辑（v / ! / > / || / ?）
- 状态 badge：最终状态（成功/失败/运行中/已暂停/待授权/已取消）
- 评分 badge：从 `runScores[groupKey]` 读取，有数据时显示 `{score}分`（颜色按分段），无数据/加载中不显示
- 耗时：沿用 `totalDurationMs` 格式化
- 环境标签：沿用 `environmentLabel`
- **移除**：事件数、最后 action 摘要、「切换可读/切换原始」按钮

#### 4.2 展开态

顶部 Tab 栏：`[执行流程] [原始信息] [扣分记录]`

**「执行流程」Tab（flow）**：
- 保持现有 action 时间线渲染逻辑不变
- 即沿用当前 readable 模式下的 timeline 代码

**「原始信息」Tab（raw）**：
- 保持现有 JSON 渲染逻辑不变
- 即沿用当前 raw 模式下的 `<pre>` 代码

**「扣分记录」Tab（score）**：
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

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `frontend/src/services/agentService.ts` | 新增 | AgentRunScore 类型 + getRunScore 方法 |
| `frontend/src/components/agent-detail/constants.ts` | 新增 | 评分规则映射、分数颜色分段、详情 Tab 定义 |
| `frontend/src/components/agent-detail/hooks/useLogState.ts` | 修改 | 新增评分懒加载、Tab 切换；移除 taskViewModes |
| `frontend/src/components/agent-detail/LogTab.tsx` | 重构 | 折叠态精简、展开态 3-tab 布局 |

## 不在本次范围

- Agent 级聚合评分统计（`/scores/stats` 端点）— 后续迭代
- 编排页面的评分展示 — 评分只在 Agent 详情页日志 Tab 中展示
- 日志 Tab 顶部 3 个信息卡片（最新运行/同步状态/授权处理）— 保持不变
- 筛选栏 — 保持不变
