# Session Token Cost 展示 Plan

## 需求背景

当前系统中 token cost 数据仅存储在 `agent_messages` 级别（每条 message 有 `tokens` 和 `cost` 字段），Session（`agent_sessions`）上没有汇总字段。在 session 列表和详情中无法直观看到该 session 的总消耗。

**目标**：在 session 列表和 session 详情中展示 token cost 汇总信息，覆盖后端 API 和前端 UI。

## 方案选择

**采用方案 B：Schema 冗余 + 增量更新**

| 对比维度 | 方案 A（查询时聚合） | 方案 B（Schema 冗余）✅ |
|---|---|---|
| 列表性能 | 每次查询需聚合，N 个 session 需批量聚合 | 直接读取，零额外开销 |
| 数据精度 | 始终精确 | 精确（增量 $inc 保证一致性） |
| Schema 变更 | 无 | 需新增字段 |
| 历史数据 | 无需处理 | 需回填 |
| 写入开销 | 无 | message 写入时多一次 $inc（极低） |
| 可排序/筛选 | 需额外处理 | 天然支持 |

## 执行步骤

### Step 1：Schema 变更

**文件**：`backend/apps/agents/src/schemas/agent-session.schema.ts`

新增字段：
```typescript
@Prop({
  type: {
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    reasoning: { type: Number, default: 0 },
    cacheRead: { type: Number, default: 0 },
    cacheWrite: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  _id: false,
  default: () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
})
totalTokens?: {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

@Prop({ type: Number, default: 0 })
totalCost?: number;
```

**影响**：向后兼容，新字段有默认值，已有文档查询不受影响。

### Step 2：增量更新 — message 写入链路

**文件**：`backend/apps/agents/src/modules/runtime/runtime-persistence.service.ts`

在 `createMessage` 方法中，当 message 携带 `tokens` 或 `cost` 时，对所属 session 执行 `$inc` 操作：

```typescript
// 在 createMessage 中，save 后追加：
if (input.sessionId && (input.tokens || input.cost)) {
  const inc: Record<string, number> = {};
  if (input.cost && Number.isFinite(input.cost)) {
    inc.totalCost = input.cost;
  }
  if (input.tokens) {
    if (Number.isFinite(input.tokens.input))      inc['totalTokens.input'] = input.tokens.input!;
    if (Number.isFinite(input.tokens.output))     inc['totalTokens.output'] = input.tokens.output!;
    if (Number.isFinite(input.tokens.reasoning))  inc['totalTokens.reasoning'] = input.tokens.reasoning!;
    if (Number.isFinite(input.tokens.cacheRead))  inc['totalTokens.cacheRead'] = input.tokens.cacheRead!;
    if (Number.isFinite(input.tokens.cacheWrite)) inc['totalTokens.cacheWrite'] = input.tokens.cacheWrite!;
    if (Number.isFinite(input.tokens.total))      inc['totalTokens.total'] = input.tokens.total!;
  }
  if (Object.keys(inc).length > 0) {
    await this.sessionModel.updateOne({ id: input.sessionId }, { $inc: inc }).exec();
  }
}
```

**关键点**：
- 仅当 message 有 `sessionId` 且有 cost/tokens 数据时才更新
- 使用 `$inc` 保证并发安全
- `bulkCreateMessageWithParts` 内部调用 `createMessage`，无需额外处理

### Step 3：Session 详情 API 补充汇总

**文件**：`runtime-persistence.service.ts` — `getSessionDetailById`

当前返回的 `AgentSessionDetailView` 已经是 `AgentSession & { messages, parts }`，session 文档上的 `totalTokens` 和 `totalCost` 会自然透传，无需额外改动。

需要在 `AgentSessionDetailView` 类型声明中确认 `totalTokens` 和 `totalCost` 可见。

### Step 4：Session 列表 API 补充汇总

**文件**：`runtime-persistence.service.ts` — `listSessions`

当前 `listSessions` 返回 `AgentSession[]`，schema 新增字段后自然包含 `totalTokens` 和 `totalCost`，无需额外改动。

### Step 5：历史数据回填脚本

编写一次性 MongoDB aggregation 脚本，按 `sessionId` 从 `agent_messages` 聚合历史 tokens/cost，用 `$set` 覆盖写入对应 session。

```javascript
// 伪代码
db.agent_messages.aggregate([
  { $match: { sessionId: { $exists: true, $ne: null }, cost: { $exists: true } } },
  { $group: {
      _id: '$sessionId',
      totalCost: { $sum: '$cost' },
      inputTokens: { $sum: '$tokens.input' },
      outputTokens: { $sum: '$tokens.output' },
      reasoningTokens: { $sum: '$tokens.reasoning' },
      cacheReadTokens: { $sum: '$tokens.cacheRead' },
      cacheWriteTokens: { $sum: '$tokens.cacheWrite' },
      totalTokens: { $sum: '$tokens.total' },
  }},
]).forEach(doc => {
  db.agent_sessions.updateOne(
    { id: doc._id },
    { $set: {
        totalCost: doc.totalCost,
        totalTokens: {
          input: doc.inputTokens,
          output: doc.outputTokens,
          reasoning: doc.reasoningTokens,
          cacheRead: doc.cacheReadTokens,
          cacheWrite: doc.cacheWriteTokens,
          total: doc.totalTokens,
        },
    }},
  );
});
```

**风险控制**：回填使用 `$set`（覆盖式），回填完成后新增量通过 `$inc` 自然累加，不会重复计算。

### Step 6：前端类型定义更新

**文件**：`frontend/src/services/agentService.ts` — `AgentRuntimeSession` 接口

新增字段对齐后端返回：
```typescript
export interface AgentRuntimeSession {
  // ...existing fields...
  totalTokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
  totalCost?: number;
}
```

### Step 7：Session 列表 — 卡片展示 token cost

**文件**：`frontend/src/components/agent-detail/SessionTab.tsx`

**展示位置**：每个 session 卡片底部状态栏（与 `status`、`lastActiveAt` 同一行）。

**展示内容**：
- 总 tokens 数（`totalTokens.total`），使用 `Intl.NumberFormat` 格式化
- 总 cost（`totalCost`），格式化为 `$X.XXXX`（4 位小数）
- 当 `totalTokens` 或 `totalCost` 为 0 或不存在时不展示，避免噪音

**样式**：复用项目已有的 badge 风格（pill badge, `text-[11px]`），与现有 status/time 信息对齐。
- tokens badge: `bg-slate-100 text-slate-500`（与卡片信息层级一致，辅助信息色调）
- cost badge: `bg-emerald-50 text-emerald-600`（复用 SessionDrawer 中 CostBadge 的色系）

**示例效果**：
```
┌──────────────────────────────────────────┐
│ Session Title                    [task]  │
│ session-abc-123...                       │
│ 最近一条消息内容预览...                    │
│ active   12,340 tokens  $0.0185   14:30  │
└──────────────────────────────────────────┘
```

### Step 8：Session 详情 — 基础信息区域展示 token cost

**文件**：`frontend/src/components/agent-detail/SessionDrawer.tsx`

**展示位置**：基础信息区域的 3 列 grid 下方，新增一行 2 列 grid 展示汇总数据。

**展示内容**：
- 左侧卡片：Token 消耗明细 — 展示 input/output/reasoning/cacheRead/cacheWrite/total
- 右侧卡片：总费用 — 展示 `totalCost`，格式 `$X.XXXXXX`（6 位小数，与逐条 message 的 CostBadge 精度一致）

**样式**：复用详情页已有的 `rounded-xl border border-slate-200/60 bg-slate-50/50 px-4 py-3` 信息卡片样式。

**示例效果**：
```
┌─ Token 消耗 ──────────────┐  ┌─ 总费用 ──────────────┐
│ Input     8,200            │  │                        │
│ Output    3,450            │  │  $0.018520              │
│ Reasoning   690            │  │                        │
│ Cache Read  0              │  │                        │
│ Cache Write 0              │  │                        │
│ Total    12,340            │  │                        │
└────────────────────────────┘  └────────────────────────┘
```

**边界处理**：
- `totalTokens` 或 `totalCost` 不存在或全为 0 时，整行不渲染
- 各子项为 0 时仍显示 `0`（与为 undefined 不展示区分）

### Step 9：文档更新

- 更新 `docs/feature/AGENT_RUNTIME.md` 中 session 相关描述
- 记录 dailylog

## 实现状态

| 步骤 | 状态 | 备注 |
|---|---|---|
| Step 1: Schema 变更 | ✅ 已完成 | commit f754cdb |
| Step 2: 增量更新 | ✅ 已完成 | commit f754cdb |
| Step 3: 详情 API | ✅ 已完成 | 自然透传，无需额外改动 |
| Step 4: 列表 API | ✅ 已完成 | 自然透传，无需额外改动 |
| Step 5: 回填脚本 | ✅ 已完成 | commit f754cdb |
| Step 6: 前端类型定义 | ✅ 已完成 | `agentService.ts` 已新增 `totalTokens/totalCost` |
| Step 7: 列表 UI | ✅ 已完成 | `SessionTab.tsx` 卡片底部新增 tokens/cost badges |
| Step 8: 详情 UI | ✅ 已完成 | `SessionDrawer.tsx` 新增 token 分项与总费用卡片 |
| Step 9: 文档更新 | ✅ 已完成 | 已更新 `AGENT_RUNTIME.md` 与 dailylog |

## 关键影响点

| 影响域 | 说明 |
|---|---|
| Schema | `agent-session.schema.ts` 新增 `totalTokens` + `totalCost`（已完成） |
| Service | `runtime-persistence.service.ts` — `createMessage` 新增 `$inc` 逻辑（已完成） |
| API 返回 | session 列表/详情返回结构新增字段（向后兼容，已完成） |
| 数据库 | 历史 session 需要回填（脚本已完成） |
| 前端类型 | `agentService.ts` — `AgentRuntimeSession` 接口新增字段 |
| 前端列表 | `SessionTab.tsx` — session 卡片底部新增 tokens/cost badges |
| 前端详情 | `SessionDrawer.tsx` — 基础信息区新增 token 消耗明细 + 总费用卡片 |

## 风险与缓解

| 风险 | 缓解方案 |
|---|---|
| 回填期间新 message 写入导致计数偏差 | 回填用 `$set` 覆盖，之后增量 `$inc` 自动累加；如需精确可在回填后跑一次校验 |
| `$inc` 并发写入性能 | MongoDB 原子操作，单字段 `$inc` 性能极好 |
| 历史 message 无 sessionId | 仅聚合有 sessionId 的 message，无 sessionId 的忽略 |
| 前端向后兼容 | 新字段为 optional，未回填或无数据时 UI 不展示，不影响现有功能 |
