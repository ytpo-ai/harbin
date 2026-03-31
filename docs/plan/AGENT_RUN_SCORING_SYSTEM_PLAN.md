# Agent Run 执行质量评分系统

## 概述

在 Agent Runtime 的 tool-calling loop 中实时追踪 LLM 每一轮的行为质量，以扣分制量化执行过程中的错误行为，产出 **Run 级评分**（满分 100 分），为 Prompt/Skill 优化效果提供可量化的衡量基准。

## 设计目标

1. **Run 级实时评分**：在 `executeWithToolCalling` 循环内实时采集扣分事件，任务结束时写入独立 collection
2. **规则可迭代**：扣分规则带版本号，后续可调整分值、增删规则，支持历史数据按新规则重算
3. **可观测**：提供 API 查询接口（单 run 评分 + agent 维度聚合）
4. **低耦合**：评分体系独立运作，不耦合现有 memo 聚合系统

## 评分主体

**Agent Run**（非 Agent Task）。理由：
- 扣分事件全部发生在 `executeWithToolCalling` 的 loop 内，这是 run 级执行过程
- Run 是可观测的原子单元，已有完整的 step/part 持久化和 lifecycle event
- 如需 task 级评分，可从关联的多个 run 聚合

## 存储方案

**独立 Schema（`agent_run_scores` collection）**，不嵌入 AgentRun。理由：
- 扣分明细是增长数组，嵌入会让 run 文档膨胀
- 规则迭代时可独立重算而不碰 run 数据
- 聚合查询在独立 collection 上做 aggregate pipeline 更干净

---

## 扣分规则（v1.0）

基准分：**100 分**，每个错误行为按规则扣分，最低 0 分。

| 规则 ID | 错误行为 | 扣分值 | 检测点 | 说明 |
|---------|---------|--------|--------|------|
| **D1** | 工具调用参数错误（preflight 失败） | **-5** | `getToolInputPreflightError()` 返回非空 | LLM 传了错误类型/缺少必填字段 |
| **D2** | 多 tool_call 批量输出（每多一个被丢弃的调用） | **-8** | `extractAllToolCalls().length > 1`，每个被丢弃的调用各扣 8 分 | 系统只执行第一个，其余被丢弃 |
| **D3** | 重复调用相同工具（连续两轮 toolId 相同） | **-10** | 当前 toolId === 上一轮 toolId | LLM 陷入循环或未利用上轮结果 |
| **D4** | 工具执行失败（非参数类错误） | **-8** | tool execution catch 块，且不匹配 `isToolInputErrorMessage` | 工具执行抛异常（超时、API 失败等） |
| **D5** | 工具执行失败（参数类错误） | **-5** | `isToolInputErrorMessage()` 匹配 | 参数值通过 preflight 但实际执行时无效 |
| **D6** | 调用未授权工具 | **-10** | tool authorization denial | LLM 调了不在 assignedTools 中的工具 |
| **D7** | tool_call JSON 解析失败 | **-3** | `extractToolCall` 有 tag 但 parse 失败 | 输出了 `<tool_call>` 但 JSON 格式错误 |
| **D8** | 文本意图未执行 | **-5** | `AgentAfterStepEvaluationHook` 检测到 tool intent | LLM 说"我来调用..."但没有实际 tool_call |
| **D9** | Planner 纯文本重试 | **-5** | `isPlannerTextOnlyRetryNeeded()` 返回 true | Planner 该输出工具调用却输出了纯文本 |
| **D10** | 空响应 / 无意义响应 | **-3** | `isMeaninglessAssistantResponse()` 匹配 | LLM 返回空/无意义内容 |
| **D11** | 达到最大轮次上限 | **-15** | round === maxToolRounds | 任务未能在限制内完成 |
| **D12** | LLM 调用超时/网络错误 | **-2** | `shouldRetryGenerationError()` 匹配 | 影响效率，但非 LLM 行为问题 |

---

## 数据模型

### Schema: `agent_run_scores`

```typescript
/** 单次扣分事件 */
interface ScoreDeduction {
  ruleId: string;         // D1~D12
  points: number;         // 负数
  round: number;          // 发生的 round
  toolId?: string;        // 相关工具（如适用）
  detail?: string;        // 补充说明
  timestamp: Date;
}

/** Run 级评分文档 */
interface AgentRunScore {
  id: string;             // UUID
  runId: string;          // 关联 AgentRun（唯一索引）
  agentId: string;        // 冗余，方便按 agent 聚合
  taskId?: string;        // 冗余，方便按 task 查询
  sessionId?: string;     // 冗余
  
  // 评分结果
  score: number;          // 最终得分 0~100
  baseScore: number;      // 基准分 100
  totalDeductions: number; // 总扣分（负数的绝对值之和）
  
  // 执行统计
  stats: {
    totalRounds: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
  };
  
  // 规则维度汇总
  deductionsByRule: Record<string, {
    count: number;
    totalPoints: number;  // 该规则的总扣分
  }>;
  
  // 扣分明细
  deductions: ScoreDeduction[];
  
  // 元信息
  ruleVersion: string;    // 评分规则版本号（如 "1.0"）
  createdAt: Date;
  updatedAt: Date;
}
```

### 索引设计

| 索引 | 字段 | 类型 | 用途 |
|------|------|------|------|
| uk_runId | `runId` | unique | 一个 run 只有一个评分 |
| idx_agent_created | `agentId, createdAt` | compound | agent 维度聚合查询 |
| idx_score | `score, createdAt` | compound | 低分 run 筛选 |

---

## 架构设计

### 核心类：TaskExecutionScorer

纯逻辑类（无 DI 依赖），在 `executeWithToolCalling` 中每个任务创建一个实例。

```
职责：
- 内存中累积扣分事件
- 提供 deduct(ruleId, round, toolId?, detail?) 方法
- 提供 summarize() 方法返回 AgentRunScore 所需的全部数据
- 跟踪 lastToolId 用于 D3 检测
```

### 检测点与 executor 集成

在 `agent-executor.service.ts` 的 `executeWithToolCalling` 循环中嵌入 scorer 调用：

```
executeWithToolCalling() {
  const scorer = new TaskExecutionScorer();
  
  for (round = 0..maxToolRounds) {
    // ── LLM 调用 ──
    try { response = modelService.chat(...) }
    catch (err) {
      if (shouldRetryGenerationError) scorer.deduct('D12', round);  // 检测点 ①
    }
    
    // ── tool_call 解析 ──
    const toolCalls = extractAllToolCalls(response);
    if (hasToolCallTag && toolCalls.length === 0)
      scorer.deduct('D7', round);                                   // 检测点 ②
    
    if (toolCalls.length > 1)
      for (dropped) scorer.deduct('D2', round, dropped.toolId);     // 检测点 ③
    
    // ── 无 tool_call 分支 ──
    if (toolCalls.length === 0) {
      if (isMeaninglessAssistantResponse)
        scorer.deduct('D10', round);                                // 检测点 ④
      if (toolIntentDetected)
        scorer.deduct('D8', round);                                 // 检测点 ⑤
      if (isPlannerTextOnlyRetryNeeded)
        scorer.deduct('D9', round);                                 // 检测点 ⑥
      continue;
    }
    
    // ── 工具授权检查 ──
    if (toolDenied)
      scorer.deduct('D6', round, toolId);                           // 检测点 ⑦
    
    // ── 参数 preflight ──
    if (preflightError)
      scorer.deduct('D1', round, toolId);                           // 检测点 ⑧
    
    // ── 重复工具检测 ──
    if (currentToolId === scorer.lastToolId)
      scorer.deduct('D3', round, toolId);                           // 检测点 ⑨
    scorer.trackToolCall(toolId);
    
    // ── 工具执行 ──
    try { result = executeTool(...) }
    catch (err) {
      if (isToolInputErrorMessage)
        scorer.deduct('D5', round, toolId);                         // 检测点 ⑩
      else
        scorer.deduct('D4', round, toolId);                         // 检测点 ⑪
    }
  }
  
  // ── 轮次上限 ──
  if (reachedMaxRounds)
    scorer.deduct('D11', maxToolRounds);                            // 检测点 ⑫
  
  // ── 写入评分 ──
  const summary = scorer.summarize();
  await runScoreService.saveScore(runId, agentId, taskId, summary);
}
```

### 服务层

```
AgentRunScoreService (新增)
├── saveScore(runId, agentId, taskId, scorerOutput)  // 写入 agent_run_scores
├── getScoreByRunId(runId)                            // 单 run 查询
├── getScoresByAgent(agentId, filter)                 // agent 维度列表
└── getAgentScoreStats(agentId, period)               // agent 维度聚合统计
```

### API 接口

| Method | Path | 说明 |
|--------|------|------|
| GET | `/agents/runtime/runs/:runId/score` | 单 run 评分详情 |
| GET | `/agents/runtime/scores?agentId=&from=&to=&minScore=&maxScore=` | 评分列表（分页） |
| GET | `/agents/runtime/scores/stats?agentId=&from=&to=` | agent 维度聚合统计（平均分、规则触发频次 TOP N 等） |

---

## 实现步骤

### Step 1: Schema & Service 基础层
- [ ] 新增 `agent-run-score.schema.ts`（Mongoose schema + 索引）
- [ ] 新增 `task-execution-scorer.ts`（纯逻辑类，含扣分规则定义 + deduct/summarize）
- [ ] 新增 `agent-run-score.service.ts`（CRUD + 聚合查询）
- [ ] Module 注册

### Step 2: Executor 集成
- [ ] 在 `agent-executor.service.ts` 的 `executeWithToolCalling` 中创建 scorer 实例
- [ ] 在 12 个检测点嵌入 `scorer.deduct()` 调用
- [ ] 在任务结束（success / failure / max-rounds）时调用 `runScoreService.saveScore()`
- [ ] 确保 scorer 不影响现有执行流程（deduct 内部无异步操作、无异常外抛）

### Step 3: API 接口
- [ ] 新增 `agent-run-score.controller.ts`（3 个端点）
- [ ] 路由注册

### Step 4: 测试
- [ ] `task-execution-scorer.spec.ts`：单元测试覆盖全部 12 条规则
- [ ] `agent-run-score.service.spec.ts`：CRUD + 聚合查询测试
- [ ] 构建验证（typecheck + lint）

---

## 影响范围

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| 新增 `agent-run-score.schema.ts` | 新增 | Mongoose schema |
| 新增 `task-execution-scorer.ts` | 新增 | 纯逻辑评分类 |
| 新增 `agent-run-score.service.ts` | 新增 | 评分数据 CRUD + 聚合 |
| 新增 `agent-run-score.controller.ts` | 新增 | API 接口 |
| `agent-executor.service.ts` | 修改 | 嵌入 scorer（12 个检测点） |
| agents module 注册文件 | 修改 | 注册 schema / service / controller |

---

## 风险与约束

1. **scorer 内存开销**：每个 run 一个 scorer 实例，deductions 数组在内存中增长。考虑到 maxToolRounds=30，每轮最多几条扣分，单个 scorer 不超过 200 条记录，内存可忽略
2. **写入失败不影响主流程**：`saveScore` 应 catch 异常并 warn 日志，不影响 run 的 success/failure 判定
3. **规则版本化**：初版 ruleVersion="1.0"，后续调整分值时递增版本号，方便区分不同规则下的评分
