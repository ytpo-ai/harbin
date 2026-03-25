# USAGE BILLING ARCHITECTURE

## 架构总览

```
models.dev/api.json (主数据源，104 providers / 3898 models)
        │
        ▼
┌─────────────────────────────────┐
│  ModelPricingService            │
│  ─ 启动时拉取 + 本地缓存       │
│  ─ 定时刷新（每小时）           │
│  ─ ModelRegistry 覆盖优先       │
├─────────────────────────────────┤
│  cost 字段:                     │
│    input / output / cache_read  │
│    cache_write / reasoning      │
│  (USD per 1M tokens)            │
└────────────┬────────────────────┘
             │ getPricing(provider, model)
             ▼
┌─────────────────────────────────┐
│  ModelService.chat() (统一收口)  │
│  ─ provider 返回 cost? 直接用   │
│  ─ 否则: tokens × pricing 计算  │
└────────────┬────────────────────┘
             │ cost 字段已填充
             ▼
┌─────────────────────────────────┐
│  AgentExecutor → Persistence    │
│  (现有链路，无需改动)            │
│  → agent_messages.cost 落库     │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  UsageAggregationService        │
│  ─ 实时聚合: aggregate pipeline │
│  ─ 每日快照: cron → snapshots   │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Usage API → Frontend Page      │
│  ─ 概览/趋势/按Agent/按Model    │
│  ─ recharts 图表展示            │
└─────────────────────────────────┘
```

## 定价数据源 — models.dev

### API 结构

`https://models.dev/api.json` 返回以 provider ID 为 key 的平铺对象，每个 provider 下包含 `models` 子对象。

```json
{
  "anthropic": {
    "id": "anthropic",
    "name": "Anthropic",
    "models": {
      "claude-sonnet-4-6": {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "cost": { "input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75 },
        "limit": { "context": 1000000, "output": 64000 }
      }
    }
  },
  "openai": {
    "id": "openai",
    "models": {
      "gpt-4o": {
        "cost": { "input": 2.5, "output": 10, "cache_read": 1.25 },
        "limit": { "context": 128000, "output": 16384 }
      }
    }
  }
}
```

### Cost 字段定义

所有价格单位为 **USD per 1M tokens**。

| 字段 | 含义 |
|------|------|
| `input` | 每百万 input token 价格 |
| `output` | 每百万 output token 价格 |
| `cache_read` | 每百万缓存读取 token 价格 |
| `cache_write` | 每百万缓存写入 token 价格 |
| `reasoning` | 每百万 reasoning token 价格 |
| `context_over_200k` | 超 200k context 的分段加价（可选） |

### 数据规模

- 104 个 provider
- 3898 个 model
- 同一逻辑模型可能在多个 provider 下有不同定价（如 Claude 同时出现在 anthropic、openrouter、amazon-bedrock）

---

## 定价三层 Fallback 机制

```
优先级 1: ModelRegistry.cost（用户手动覆盖）
    │
    │  若无覆盖
    ▼
优先级 2: 本地缓存文件（data/cache/models-pricing.json）
    │
    │  若缓存缺失或过期
    ▼
优先级 3: 远程 models.dev/api.json
```

### ModelPricingService 核心逻辑

```typescript
interface ModelCost {
  input: number;       // USD per 1M tokens
  output: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
}

class ModelPricingService implements OnModuleInit {
  // 内存缓存: key = "provider:model"
  private pricingCache: Map<string, ModelCost>;
  
  async onModuleInit() {
    await this.loadFromLocalCache();       // 读本地 JSON 文件
    this.refreshFromRemote();              // 异步拉取（不阻塞启动）
    this.startPeriodicRefresh();           // setInterval 1h
  }
  
  // 对外统一入口
  async getPricing(provider: string, model: string): Promise<ModelCost | undefined> {
    // 1. 查 ModelRegistry 手动覆盖
    const override = await this.getRegistryOverride(provider, model);
    if (override) return override;
    // 2. 查内存缓存（来自 models.dev）
    return this.pricingCache.get(`${provider}:${model}`);
  }
  
  // 计费公式
  calculateCost(pricing: ModelCost, tokens: NormalizedTokens): number {
    return (
      (tokens.input  || 0) * pricing.input  / 1_000_000 +
      (tokens.output || 0) * pricing.output / 1_000_000 +
      (tokens.cacheRead  || 0) * (pricing.cache_read  ?? pricing.input)  / 1_000_000 +
      (tokens.cacheWrite || 0) * (pricing.cache_write ?? pricing.input)  / 1_000_000 +
      (tokens.reasoning  || 0) * (pricing.reasoning   ?? pricing.output) / 1_000_000
    );
  }
}
```

**Fallback 策略说明：**
- `cache_read` 未定义时，fallback 到 `input` 价格（保守计费）
- `cache_write` 未定义时，fallback 到 `input` 价格
- `reasoning` 未定义时，fallback 到 `output` 价格（reasoning 通常与 output 同价或更贵）

### 本地缓存机制

- 缓存文件：`data/cache/models-pricing.json`
- 启动顺序：读缓存文件 → 异步拉远程 → 远程成功后覆写缓存文件
- 定时刷新：每小时执行一次，刷新成功后更新内存 + 写文件
- 手动刷新：`POST /usage/pricing/refresh` 触发

---

## 统一计费收口 — ModelService.chat()

### 现有数据流（改造前）

```
Provider.chatWithMeta()    → { response, usage?, cost: undefined }
    ↓
ModelService.normalizeUsage()  → { inputTokens, outputTokens, reasoningTokens, cacheRead, cacheWrite, totalTokens }
    ↓
ModelService.chat() 返回   → { response, usage, finishReason, cost: undefined }
    ↓
AgentExecutor              → 捕获 usage + cost，传入 persistStepMessage
    ↓
RuntimePersistence         → 写入 agent_messages { tokens, cost: null }
```

### 改造后数据流

```
Provider.chatWithMeta()    → { response, usage?, cost: undefined }
    ↓
ModelService.normalizeUsage()  → { inputTokens, outputTokens, ... }
    ↓
【新增】ModelPricingService.getPricing(provider, model) → ModelCost
【新增】ModelPricingService.calculateCost(pricing, tokens) → 0.00234
    ↓
ModelService.chat() 返回   → { response, usage, finishReason, cost: 0.00234 }
    ↓
AgentExecutor              → 捕获 usage + cost（已有值），传入 persistStepMessage
    ↓
RuntimePersistence         → 写入 agent_messages { tokens, cost: 0.00234 }
```

**关键：下游 AgentExecutor → Persistence 链路零改动**，只需在 `ModelService.chat()` 中插入约 15 行代码。

### 集成代码示意

```typescript
// model.service.ts :: chat() 方法
async chat(modelId: string, messages: ChatMessage[], options?: any): Promise<ModelChatResult> {
  const provider = this.getProvider(modelId);
  const result = await provider.chatWithMeta(messages, options);
  const providerName = String(provider.modelInfo.provider || '').toLowerCase();
  const usage = this.normalizeUsage(providerName, result.usage);
  
  // --- 统一计费收口 ---
  let cost = typeof result.cost === 'number' && Number.isFinite(result.cost) 
    ? result.cost 
    : undefined;
  
  if (cost === undefined && usage) {
    const pricing = await this.modelPricingService.getPricing(
      providerName,
      provider.modelInfo.model,
    );
    if (pricing) {
      cost = this.modelPricingService.calculateCost(pricing, {
        input: usage.inputTokens,
        output: usage.outputTokens,
        reasoning: usage.reasoningTokens,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      });
    }
  }
  // --- 收口结束 ---
  
  return {
    response: result.response,
    usage,
    finishReason: this.normalizeFinishReason(result.finishReason),
    cost,
  };
}
```

---

## Token 数据流完整链路

### Provider → Message 映射关系

```
LLM API 原始响应
  ↓ (各 Provider 适配)
ProviderUsage {
  inputTokens, outputTokens, totalTokens,
  reasoningTokens?, cachedInputTokens?, cacheWriteTokens?
}
  ↓ (ModelService.normalizeUsage)
ModelChatResult.usage {
  inputTokens, outputTokens, totalTokens,
  reasoningTokens?, cacheRead?, cacheWrite?
}
  ↓ (AgentExecutor.persistStepMessage 映射)
agent_messages.tokens {
  input, output, total,
  reasoning?, cacheRead?, cacheWrite?
}
```

### Provider 口径差异处理

| Provider | input 含 cache? | 修正逻辑 |
|----------|-----------------|----------|
| Anthropic | 否（独立字段） | 直接使用 |
| OpenAI | 是（input 包含 cache） | `adjustedInput = input - cacheRead - cacheWrite` |
| OpenRouter | 是（同 OpenAI） | 同上 |
| Google | 无 cache 字段 | 直接使用 |
| DeepSeek | 否（独立字段） | 直接使用 |

此修正在 `normalizeUsage()` 中完成（`model.service.ts:49-52`）。

---

## ModelRegistry Cost 覆盖层

### Schema 扩展

```typescript
// model-registry.schema.ts 新增字段
@Prop({
  type: {
    input: { type: Number },
    output: { type: Number },
    cache_read: { type: Number },
    cache_write: { type: Number },
    reasoning: { type: Number },
  },
  _id: false,
  default: undefined,
})
cost?: {
  input?: number;       // USD per 1M tokens
  output?: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
};
```

### 使用场景

- 通过非标准 API 代理访问模型（如 OpenRouter 转发 Claude，价格与官方不同）
- 私有部署模型（models.dev 不收录）
- 国产模型 models.dev 缺失定价时手动补充

---

## Usage 聚合层

### 实时聚合 — MongoDB Aggregation Pipeline

```javascript
// 按日期 + agentId 分组聚合（示例）
db.agent_messages.aggregate([
  { $match: {
    role: 'assistant',
    createdAt: { $gte: ISODate('2026-03-01'), $lt: ISODate('2026-04-01') },
    cost: { $exists: true, $ne: null }
  }},
  { $group: {
    _id: {
      date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      agentId: '$agentId',
    },
    totalCost: { $sum: '$cost' },
    inputTokens: { $sum: '$tokens.input' },
    outputTokens: { $sum: '$tokens.output' },
    reasoningTokens: { $sum: '$tokens.reasoning' },
    cacheReadTokens: { $sum: '$tokens.cacheRead' },
    cacheWriteTokens: { $sum: '$tokens.cacheWrite' },
    totalTokens: { $sum: '$tokens.total' },
    requestCount: { $sum: 1 },
  }},
  { $sort: { '_id.date': 1 } }
])
```

### 每日快照 Schema

```typescript
// collection: agent_usage_daily_snapshots
{
  date: string;              // '2026-03-22'
  agentId?: string;          // 按 Agent 聚合（null 表示全局行）
  modelId?: string;          // 按模型聚合
  
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  
  totalCost: number;         // USD
  requestCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}
```

### 查询策略

```
查询范围在"今天"内 → 走实时 aggregation pipeline
查询范围为历史日期  → 走 daily snapshot 表
跨越今天的范围     → snapshot + 实时 混合查询
```

---

## Usage API 端点设计

| 方法 | 路径 | 请求参数 | 返回 |
|------|------|----------|------|
| GET | `/usage/overview` | `?period=month\|week` | `{ totalCost, totalTokens, requestCount, activeModels, previousPeriod }` |
| GET | `/usage/daily-trend` | `?from=&to=` | `[{ date, cost, tokens, requests }]` |
| GET | `/usage/by-agent` | `?from=&to=&limit=10` | `[{ agentId, agentName, cost, tokens, requests }]` |
| GET | `/usage/by-model` | `?from=&to=&limit=10` | `[{ modelId, modelName, provider, cost, tokens, requests }]` |
| GET | `/usage/pricing/status` | - | `{ lastRefresh, modelCount, overrideCount, source }` |
| POST | `/usage/pricing/refresh` | - | `{ success, modelCount, refreshedAt }` |

---

## 前端 Usage 页面设计

### 路由与导航

- 路由：`/usage`
- 侧边栏位置：系统管理分组，插入在"API密钥"之后

### 页面布局

```
┌─────────────────────────────────────────────────────┐
│  用量与计费                               [本月 ▾]   │
├────────────┬────────────┬────────────┬──────────────┤
│  本月总费用  │  总 Tokens  │  请求次数    │  活跃模型    │
│  $12.45     │  2.3M       │  1,284      │  5           │
│  ↑12% MoM   │  ↑8% MoM   │  ↑15% MoM   │              │
├────────────┴────────────┴────────────┴──────────────┤
│                                                       │
│  每日费用趋势 (Area Chart)                             │
│  ┌───────────────────────────────────────────────┐   │
│  │     ██                                        │   │
│  │  ██ ██ ██                                     │   │
│  │  ██ ██ ██ █████ ████ ███████ ████             │   │
│  │  3/1  3/5  3/10  3/15  3/20   3/22            │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
├───────────────────────┬─────────────────────────────┤
│  Agent 用量 (Bar)      │  模型用量 (Bar)              │
│  ┌─────────────────┐  │  ┌───────────────────────┐  │
│  │ ████ Agent-A     │  │  │ ████████ claude-4s    │  │
│  │ ███  Agent-B     │  │  │ █████    gpt-4o       │  │
│  │ ██   Agent-C     │  │  │ ███      deepseek     │  │
│  └─────────────────┘  │  └───────────────────────┘  │
├───────────────────────┴─────────────────────────────┤
│  定价源: models.dev  |  上次刷新: 2026-03-22 14:00    │
│  覆盖模型: 2 个       |              [手动刷新]        │
└─────────────────────────────────────────────────────┘
```

### 技术选型

- **图表库**：recharts（React-first，轻量 ~150KB，与 Tailwind 兼容）
- **数据获取**：react-query useQuery，与项目现有模式一致
- **时间范围选择**：本月 / 近 7 天 / 近 30 天 / 自定义

---

## 关键文件清单

### 新增文件

| 文件 | 职责 |
|------|------|
| `backend/apps/agents/src/modules/models/model-pricing.service.ts` | 定价拉取、缓存、覆盖、计算 |
| `backend/apps/agents/src/modules/usage/usage-aggregation.service.ts` | Usage 聚合查询与快照 |
| `backend/apps/agents/src/modules/usage/usage.controller.ts` | Usage API 端点 |
| `backend/apps/agents/src/modules/usage/usage.module.ts` | Usage 模块注册 |
| `backend/apps/agents/src/schemas/usage-daily-snapshot.schema.ts` | 每日快照 Schema |
| `frontend/src/pages/Usage.tsx` | Usage 前端页面 |
| `frontend/src/services/usageService.ts` | Usage API 前端封装 |
| `data/cache/models-pricing.json` | 定价本地缓存（运行时生成） |

### 修改文件

| 文件 | 改动说明 |
|------|----------|
| `backend/apps/agents/src/modules/models/model.service.ts` | chat() 接入计费收口（~15 行） |
| `backend/apps/agents/src/modules/models/model.module.ts` | 注入 ModelPricingService |
| `backend/apps/agents/src/schemas/model-registry.schema.ts` | 新增 cost 覆盖字段 |
| `backend/apps/agents/src/modules/models/model-management.service.ts` | CRUD 支持 cost 字段 |
| `frontend/src/App.tsx` | 新增 /usage 路由 |
| `frontend/src/components/Layout.tsx` | 侧边栏新增"用量与计费"入口 |
| `frontend/package.json` | 新增 recharts 依赖 |

### 不需要改动的文件

| 文件 | 原因 |
|------|------|
| `agent-executor.service.ts` | cost 字段流转管道已铺通 |
| `runtime-persistence.service.ts` | createMessage/bulkCreateMessageWithParts 已支持 cost |
| `agent-message.schema.ts` | tokens + cost 字段已存在 |
| `base-provider.ts` / 各 provider | ProviderChatResult.cost 接口已定义 |
