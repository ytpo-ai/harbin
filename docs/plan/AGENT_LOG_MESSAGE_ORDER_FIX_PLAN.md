# Agent 日志消息展示顺序修复计划

## 问题描述

Agent 详情页 → 日志 Tab → 执行流程（flow）视图中，每一轮的消息展示顺序不正确：
- **现象**：`S 系统`（工具调用结果）显示在 `A Agent`（tool_call 指令）**上方**
- **正确顺序**：`A Agent`（tool_call）应在前，`S 系统`（调用结果）在后

## 根因分析

### 1. sequence 编号体系不兼容

| 消息类型 | sequence 公式 | 示例值 |
|---------|-------------|--------|
| assistant (tool_call) | `initialCount + round + 2` | 11, 12, 13, 14... |
| system (tool result) | `initialCount + (round+2)*100 + offset` | 210, 310, 410, 510... |

两套编号空间各自递增，但 assistant 的值（11-20 范围）和 system 的值（200+ 范围）之间没有交叉关联。

### 2. 写入时序倒置

在 `agent-executor.service.ts` 的每轮执行中：
1. LLM 返回 tool_call 响应
2. 执行工具 → 得到结果
3. **先写入** system 消息（工具调用结果） → `persistIntermediateSystemMessage()` (line 1860)
4. **后写入** assistant 消息（含 tool_call 内容） → `persistStepMessage()` (line 1888)

导致 system 的 `createdAt` 比 assistant 早 3-5ms。

### 3. 查询排序以 createdAt 为主键

`runtime-persistence.service.ts` 中所有查询使用 `.sort({ createdAt: 1, sequence: 1 })`，createdAt 不同时 sequence 不生效，结果是 system(result) 排在 assistant(call) 前面。

## 修复方案

### 步骤 1：修改 assistant 消息的 sequence 编号公式

**文件**: `backend/apps/agents/src/modules/agents/agent-executor.service.ts`

- 新增方法 `computeAssistantSequence(base, round)` → `base + (round + 2) * 100 - 1`
- 修改 line 1095，使用新公式

效果：assistant sequence 变为 199, 299, 399...，始终在同一轮的 system 210, 310, 410... 之前。

### 步骤 2：修改后端查询排序逻辑

**文件**: `backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

将 `listRunMessagesWithParts` 方法的排序从 `{ createdAt: 1, sequence: 1 }` 改为 `{ sequence: 1, createdAt: 1 }`，让 sequence 成为主排序键。

### 步骤 3：历史数据兼容性

已有数据中 assistant 的 sequence 仍为 11, 12, 13...，与 system 的 210, 310... 混排时 assistant 会全部排在前面。
这对历史数据而言是"assistant 聚合在前、system 聚合在后"，虽非理想顺序但比当前"结果在调用前面"更合理。
新数据将完全正确排序。

## 影响范围

- **后端**: agent-executor.service.ts（sequence 编号）、runtime-persistence.service.ts（查询排序）
- **前端**: 无需改动（LogTab flow 视图直接按 API 返回顺序渲染）
- **影响面**: Agent 详情日志 Tab、决策回溯（执行时间线）、Session 详情等消息展示视图
