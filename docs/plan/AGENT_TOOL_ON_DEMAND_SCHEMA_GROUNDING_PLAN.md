# Agent 工具按需 Schema Grounding 计划（v3）

## 背景

- 当前 Agent 运行时仅注入工具 `id/name/description` 摘要，LLM 在生成 `<tool_call>` 时看不到 inputSchema（required 字段、类型、enum 约束）
- LLM 只能靠训练数据中的模式匹配"猜测"参数结构，高频犯错（如把 `title/description` 嵌套在 `task{}` 中、用 `"create"` 替代 `"new"`）
- 参数错误触发 D1（-5），修正后必须再次调用同工具触发 D3（-10），合计 -15 分的结构性扣分
- 如果将全部已授权工具的 schema 预注入上下文，在工具数量增长后会浪费大量 token

## 核心设计：三层机制

### 机制一：`get-tool-schema` 元工具（LLM 主动查询）

**原则**：LLM 在不确定工具参数格式时，可以主动调用 `get-tool-schema` 查询目标工具的 inputSchema，拿到参数契约后再正确生成 tool_call。

**优势**：
- LLM 自主决策是否需要查询，不浪费 token
- 查询与目标工具是**不同工具**，不触发 D3
- 不依赖上游预判，任何阶段任何工具都能查

### 机制二：上游预激活（Preactivated Tools）

**原则**：上游（编排层/调度层）在创建任务时，预判执行需要的工具 ID 列表，传递给执行层。执行层在 tool-calling 循环开始前，批量加载这些工具的 schema 摘要注入上下文，使 LLM 首轮就能正确生成参数。

### 机制三：Preflight 分层扣分 + 按需 Schema 注入（兜底）

**原则**：LLM 首次调用某工具时，如果参数错误但它**从未见过该工具的 schema**（未通过 get-tool-schema 查询、也未被预激活），不扣 D1，注入 schema 帮助修正；如果已经见过 schema 仍然参数错误，正常扣分。

### 三层关系

```
L1 get-tool-schema（最优路径）
   LLM 主动查 → 拿到 schema → 正确生成 → 0 扣分、0 浪费
   
L2 预激活（确定性场景兜底）
   上游知道用什么工具 → 提前注入 schema → 首轮正确 → 0 扣分
   
L3 按需注入 + 分层扣分（最终兜底）
   既没查也没预激活 → 首次犯错免扣 D1 → 给 schema → 二次犯错才扣
```

三层通过 `schemaInjectedToolIds: Set<string>` 共享状态：
- `get-tool-schema` 返回结果后 → `schemaInjectedToolIds.add(toolId)`
- 预激活加载后 → `schemaInjectedToolIds.add(toolId)`
- 按需注入后 → `schemaInjectedToolIds.add(toolId)`
- preflight 检查时：在 Set 中 → 正常扣 D1；不在 Set 中 → 免扣，注入 schema

## Agent 默认内置免授权工具

### 设计原则

免授权工具不应硬编码在 `agent-role.service.ts` 中，而应**在工具定义层标记**，由运行时动态读取。

### `authFree` 字段

在 `builtin-tool-catalog.ts` 的工具定义中新增 `authFree: boolean` 字段，标记该工具为"所有 Agent 默认携带，无需授权分配"。

**免授权工具列表**（`authFree: true`）：

| 工具 | ID | 说明 |
|------|-----|------|
| `search-memo` | `builtin.sys-mg.internal.memory.search-memo` | 检索 Agent 记忆（现有，从硬编码迁移） |
| `append-memo` | `builtin.sys-mg.internal.memory.append-memo` | 追加 Agent 记忆（现有，从硬编码迁移） |
| `get-tool-schema` | `builtin.sys-mg.internal.tool-meta.get-tool-schema` | 查询工具参数契约（新增） |
| `send-internal-message` | `builtin.sys-mg.mcp.inner-message.send-internal-message` | Agent 间内部消息（新增） |

### 涉及改动

#### 1. `builtin-tool-catalog.ts` — 工具定义层标记

```typescript
// 免授权工具标记示例
{
  id: 'builtin.sys-mg.internal.memory.search-memo',
  name: 'Memo MCP Search',
  authFree: true,   // ← 新增字段
  // ...其余字段不变
}
```

所有 4 个免授权工具均加 `authFree: true`，其余工具不加此字段（默认 false）。

#### 2. `builtin-tool-catalog.ts` — 静态派生集合

与 `TERMINAL_TOOL_IDS` 相同的模式，从 catalog 静态过滤：

```typescript
/**
 * 免授权工具 ID 集合：所有 Agent 默认携带，无需 MCP Profile 或角色授权。
 * 从 BUILTIN_TOOLS 静态过滤，避免运行时 DB 查询。
 */
export const AUTH_FREE_TOOL_IDS: ReadonlySet<string> = new Set(
  BUILTIN_TOOLS.filter((t) => (t as any).authFree === true).map((t) => t.id),
);
```

#### 3. `tool.schema.ts` — Mongoose Schema 持久化

```typescript
/**
 * 免授权标记：该工具默认分配给所有 Agent，无需角色/Profile 授权。
 */
@Prop({ default: false })
authFree?: boolean;
```

#### 4. `tool-registry.service.ts` — seed 时同步 authFree

在 `initializeBuiltinTools` 的 `$set` 中追加 `authFree`：

```typescript
$set: {
  ...metadata,
  // ...现有字段
  authFree: (toolData as any).authFree ?? false,  // ← 新增
}
```

#### 5. `agent-role.service.ts` — 动态读取替代硬编码

```typescript
// 现有（硬编码）
const merged = uniqueStrings(
  agent.tools || [],
  profile.tools || [],
  [MEMO_MCP_SEARCH_TOOL_ID, MEMO_MCP_APPEND_TOOL_ID],
).map(normalizeToolId);

// 改为（数据驱动）
import { AUTH_FREE_TOOL_IDS } from '@agent/modules/tools/builtin-tool-catalog';

const merged = uniqueStrings(
  agent.tools || [],
  profile.tools || [],
  [...AUTH_FREE_TOOL_IDS],
).map(normalizeToolId);
```

**这样以后新增免授权工具只需在 `builtin-tool-catalog.ts` 中加 `authFree: true`，无需改动任何其他文件。**

#### 6. `agent.constants.ts` — 清理常量

`MEMO_MCP_SEARCH_TOOL_ID` 和 `MEMO_MCP_APPEND_TOOL_ID` 仍保留（可能被其他模块引用），但 `getAllowedToolIds` 不再直接引用它们。新增：

```typescript
export const GET_TOOL_SCHEMA_TOOL_ID = 'builtin.sys-mg.internal.tool-meta.get-tool-schema';
export const SEND_INTERNAL_MESSAGE_TOOL_ID = 'builtin.sys-mg.mcp.inner-message.send-internal-message';
```

## 实施步骤

### 步骤 1：新增 `get-tool-schema` 元工具

#### 1a. 工具定义（`builtin-tool-catalog.ts`）

```typescript
{
  id: 'builtin.sys-mg.internal.tool-meta.get-tool-schema',
  name: 'Get Tool Schema',
  description: '查询指定工具的参数契约（inputSchema），返回 required 字段、属性类型和枚举约束。在调用不熟悉的工具前，先用此工具查询参数格式。',
  prompt: '当你不确定某个工具的参数格式时，先调用 get-tool-schema 查询其 inputSchema，然后根据返回的参数契约正确构造 tool_call。不要猜测参数结构。',
  type: 'api_call' as const,
  category: 'System',
  authFree: true,
  requiredPermissions: [],
  tokenCost: 1,
  implementation: {
    type: 'built_in' as const,
    parameters: {
      type: 'object',
      required: ['toolId'],
      properties: {
        toolId: {
          type: 'string',
          description: '要查询的工具 ID（如 builtin.sys-mg.mcp.orchestration.submit-task）',
        },
      },
    },
  },
}
```

#### 1b. 工具执行 handler

**新增文件/方法**：在 `tool-execution-dispatcher.service.ts` 中增加 case 路由，实际执行委托给 `ToolRegistryService.getToolInputContract`。

```typescript
// tool-execution-dispatcher.service.ts
case 'builtin.sys-mg.internal.tool-meta.get-tool-schema':
  return this.toolMetaHandler.getToolSchema(parameters);

// 新增 tool-meta-handler.service.ts（或直接内联）
async getToolSchema(params: { toolId?: string }): Promise<any> {
  const toolId = String(params?.toolId || '').trim();
  if (!toolId) {
    throw new Error('get-tool-schema requires toolId');
  }
  const contract = await this.toolRegistryService.getToolInputContract(toolId);
  if (!contract?.schema) {
    return {
      toolId,
      found: false,
      message: `工具 ${toolId} 未找到或没有参数定义`,
    };
  }
  // 返回结构化的 schema 摘要
  return {
    toolId: contract.toolId,
    found: true,
    schema: contract.schema,
    hint: buildToolSchemaHint(contract.toolId, contract.schema),
  };
}
```

#### 1c. 安全约束

- `get-tool-schema` 只能查询**当前 Agent 已授权**的工具，防止信息泄露
- 在 handler 中校验 `toolId in assignedToolIds`
- 返回值中不包含 `implementation` 等内部信息，只暴露 `inputSchema` 摘要

#### 1d. 与 schemaInjectedToolIds 的联动

在 `agent-executor.service.ts` 的 tool-calling 循环中，当 `get-tool-schema` 执行成功返回后，将查询的 `toolId` 加入 `schemaInjectedToolIds`：

```typescript
// 在工具执行成功后（trackToolSuccess 之后）
if (normalizedToolCallId === GET_TOOL_SCHEMA_TOOL_ID) {
  const queriedToolId = normalizeToolId(String(toolCall.parameters?.toolId || ''));
  if (queriedToolId) {
    schemaInjectedToolIds.add(queriedToolId);
  }
}
```

### 步骤 2：`send-internal-message` 升级为默认免授权

#### 2a. 常量定义（`agent.constants.ts`）

```typescript
export const GET_TOOL_SCHEMA_TOOL_ID = 'builtin.sys-mg.internal.tool-meta.get-tool-schema';
export const SEND_INTERNAL_MESSAGE_TOOL_ID = 'builtin.sys-mg.mcp.inner-message.send-internal-message';
```

#### 2b. 免授权注册（`agent-role.service.ts`）

```typescript
// getAllowedToolIds() 中合并默认工具
const AGENT_DEFAULT_TOOL_IDS = [
  MEMO_MCP_SEARCH_TOOL_ID,
  MEMO_MCP_APPEND_TOOL_ID,
  GET_TOOL_SCHEMA_TOOL_ID,
  SEND_INTERNAL_MESSAGE_TOOL_ID,
];

const merged = uniqueStrings(
  agent.tools || [],
  profile.tools || [],
  AGENT_DEFAULT_TOOL_IDS,
).map(normalizeToolId);
```

#### 2c. 从现有 MCP Profile 中清理 `send-internal-message`

`send-internal-message` 改为默认免授权后，需要检查 `mcp-profile.ts` 种子数据中是否有冗余配置，保持一致性。不影响功能（工具在 assignedToolIds 中出现多次会被 Set 去重）。

### 步骤 3：新增 `buildToolSchemaHint` 工具函数

**文件**：`agent-executor.helpers.ts`

```typescript
export function buildToolSchemaHint(
  toolId: string,
  schema: Record<string, unknown>,
): string | null {
  const properties = (schema as any)?.properties;
  if (!properties || typeof properties !== 'object') return null;

  const required = new Set(
    Array.isArray((schema as any).required)
      ? (schema as any).required.map((r: unknown) => String(r || ''))
      : [],
  );

  const propEntries = Object.entries(properties as Record<string, any>);
  if (propEntries.length === 0) return null;

  const lines: string[] = [`工具参数契约 ${toolId}:`];

  if (required.size > 0) {
    lines.push(`required: [${[...required].join(', ')}]`);
  }

  const additionalProperties = (schema as any)?.additionalProperties;
  if (additionalProperties === false) {
    lines.push('additionalProperties: false（禁止传入未定义的字段）');
  }

  lines.push('properties:');
  for (const [key, spec] of propEntries) {
    const type = spec?.type || 'any';
    const enumValues = Array.isArray(spec?.enum) ? `, enum=${JSON.stringify(spec.enum)}` : '';
    const desc = spec?.description ? ` — ${spec.description}` : '';
    const req = required.has(key) ? ' (必填)' : '';
    lines.push(`  ${key}: ${type}${enumValues}${req}${desc}`);
  }

  return lines.join('\n');
}

export function hasEffectiveSchema(schema: Record<string, unknown>): boolean {
  const properties = (schema as any)?.properties;
  if (!properties || typeof properties !== 'object') return false;
  return Object.keys(properties).length > 0;
}
```

### 步骤 4：改造 preflight 分支（分层扣分）

**文件**：`agent-executor.service.ts`

**声明**：循环开始前

```typescript
const schemaInjectedToolIds = new Set<string>();
```

**preflight 分支改造**（line ~1663-1710）：

```
获取 inputContract（保持不变）
preflightError 存在时：
  ├─ toolId NOT IN schemaInjectedToolIds
  │  → 不扣 D1
  │  → 构建 schema hint + error 提示，注入 messages
  │  → schemaInjectedToolIds.add(toolId)
  │  → continue
  │
  └─ toolId IN schemaInjectedToolIds
     → 扣 D1（已给过 schema 仍然错误）
     → 构建 repair 指令，注入 messages
     → continue

preflightError 不存在时：
  → schemaInjectedToolIds.add(toolId)
  → 正常执行工具
```

### 步骤 5：预激活机制

#### 5a. 数据传递（`orchestration-execution-engine.service.ts`）

在 `sessionContext` 中追加 `preactivatedToolIds`：

```typescript
sessionContext: {
  ...existing,
  preactivatedToolIds: resolvedPreactivatedToolIds,
}
```

#### 5b. 编排阶段内置预激活规则

| 阶段 | 预激活工具 |
|------|-----------|
| generating | `submit-task` |
| pre_execute | outline 中 `preExecuteActions[].tool` |
| post_execute | `report-task-run-result` |
| initialize | `plan-initialize` + `list-agents` |

#### 5c. 执行层加载（`agent-executor.service.ts`）

```typescript
// executeWithToolCalling() 开始时
const preactivatedToolIds = this.extractPreactivatedToolIds(executionContext);
for (const toolId of preactivatedToolIds) {
  const contract = await this.toolService.getToolInputContract(toolId);
  if (contract?.schema && hasEffectiveSchema(contract.schema)) {
    const hint = buildToolSchemaHint(toolId, contract.schema);
    if (hint) {
      messages.push({ role: 'system', content: hint, timestamp: new Date() });
      schemaInjectedToolIds.add(toolId);
    }
  }
}
```

### 步骤 6：修复 Composio 工具简写 schema

**文件**：`builtin-tool-catalog.ts`

将简写格式升级为标准 JSON Schema，使 `get-tool-schema` 和 preflight 都能正确消费。

```typescript
// web-search.serp
parameters: {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', description: '搜索关键词' },
    maxResults: { type: 'number', description: '最大结果数' },
  },
}

// slack.send-message
parameters: {
  type: 'object',
  required: ['channel', 'text'],
  properties: {
    channel: { type: 'string', description: 'Slack 频道名称或 ID' },
    text: { type: 'string', description: '消息内容' },
  },
}

// gmail.send-email
parameters: {
  type: 'object',
  required: ['to', 'subject', 'body'],
  properties: {
    to: { type: 'string', description: '收件人邮箱' },
    subject: { type: 'string', description: '邮件主题' },
    body: { type: 'string', description: '邮件正文' },
    action: { type: 'string', enum: ['send', 'draft'], description: '发送或存为草稿' },
  },
}
```

### 步骤 7：更新 toolset-context 中对默认工具的 prompt 注入

**文件**：`toolset-context.builder.ts`

`get-tool-schema` 和 `send-internal-message` 作为默认工具会出现在工具列表中。`get-tool-schema` 自带的 `prompt` 字段（"当你不确定某个工具的参数格式时..."）会通过 `toolStrategyWrapper` 注入，引导 LLM 形成"不确定就查"的行为习惯。

### 步骤 8：generating prompt 中放宽工具约束

**文件**：`orchestration-prompt-catalog.ts`

generating 阶段当前约束"仅允许调用 submit-task"。需要放宽为允许 `get-tool-schema`：

```typescript
// DEFAULT_PLANNER_GENERATING_PROMPT 中修改
'- 允许调用 `builtin.sys-mg.mcp.orchestration.submit-task` 和 `builtin.sys-mg.internal.tool-meta.get-tool-schema`。',
'- 如果不确定 submit-task 的参数格式，先调用 get-tool-schema 查询。',
```

同理更新 pre_execute / post_execute / initialize 的 prompt。

### 步骤 9：D3 豁免 `get-tool-schema`

`get-tool-schema` 作为查询型元工具，连续调用（如查询多个工具 schema）不应触发 D3。在 D3 检测处增加豁免：

```typescript
// agent-executor.service.ts D3 检测处
const isMetaTool = normalizedToolCallId === GET_TOOL_SCHEMA_TOOL_ID;
if (scorer.lastToolId === normalizedToolCallId && !isMetaTool) {
  scorer.deduct('D3', round, { ... });
}
```

### 步骤 10：测试覆盖

- `get-tool-schema` handler 单元测试：正常查询、工具不存在、未授权工具拒绝
- `agent-executor.service.spec.ts`：
  - 验证 get-tool-schema 返回后 schemaInjectedToolIds 被更新
  - 验证预激活注入 + 首次按需不扣分
  - 验证 D3 豁免 get-tool-schema
- `tool-registry.service.spec.ts`：验证升级后 Composio schema 可被正确解析

### 步骤 11：更新文档

- `docs/feature/AGENT_RUNTIME.md`：D1 分层扣分 + get-tool-schema 机制 + 默认免授权工具列表
- `docs/feature/AGENT_TOOL.md`：按需 schema grounding 三层机制

## 完整执行流程示例

### 场景 A：generating 阶段（有预激活）

```
Session 初始化:
  工具列表注入: [...所有已授权工具 + get-tool-schema + send-internal-message]
  预激活注入: submit-task 的 schema 摘要
  schemaInjectedToolIds = { 'submit-task' }

Round 0:
  LLM 看到 schema → 正确构造 submit-task 参数 → 成功
  总耗时: 1 轮，0 扣分
```

### 场景 B：generating 阶段（无预激活，LLM 主动查询）

```
Round 0:
  LLM 不确定 submit-task 参数 → 调用 get-tool-schema("submit-task")
  → 返回 schema 摘要
  → schemaInjectedToolIds.add('submit-task')

Round 1:
  LLM 根据 schema 正确构造 submit-task 参数 → 成功
  不触发 D3（get-tool-schema ≠ submit-task）
  总耗时: 2 轮，0 扣分
```

### 场景 C：LLM 未查询、未预激活，直接调用出错（兜底）

```
Round 0:
  LLM 盲猜参数 → submit-task({ task: { title:... } })
  preflight 失败: missing required field 'title'
  'submit-task' NOT IN schemaInjectedToolIds → 不扣 D1
  注入 schema 摘要 + 错误提示
  schemaInjectedToolIds.add('submit-task')

Round 1:
  LLM 看到 schema 和错误提示 → 正确构造参数 → 成功
  总耗时: 2 轮，0 扣分（比现有方案节省 15 分）
```

### 场景 D：已见过 schema 仍然犯错

```
Round 0: get-tool-schema("submit-task") → 拿到 schema
Round 1: submit-task({ action: "create" }) → preflight 失败
         'submit-task' IN schemaInjectedToolIds → 扣 D1（-5）
         注入 repair 指令
Round 2: 修正参数 → 成功
         总耗时: 3 轮，D1(-5) + D3(-10) = -15 扣分（与现有一致，合理）
```

## 关键影响点

| 层级 | 文件 | 改动 |
|------|------|------|
| 工具定义 | `builtin-tool-catalog.ts` | 新增 `authFree` 字段 + `AUTH_FREE_TOOL_IDS` 静态集合 + get-tool-schema 定义 + Composio schema 升级 |
| 工具 Schema | `tool.schema.ts` | 新增 `authFree?: boolean` 字段 |
| 工具注册 | `tool-registry.service.ts` | `initializeBuiltinTools` seed 时同步 `authFree` |
| 常量 | `agent.constants.ts` | 新增 `GET_TOOL_SCHEMA_TOOL_ID` / `SEND_INTERNAL_MESSAGE_TOOL_ID` |
| 免授权 | `agent-role.service.ts` | `getAllowedToolIds` 改为从 `AUTH_FREE_TOOL_IDS` 动态读取，移除硬编码 |
| 工具分发 | `tool-execution-dispatcher.service.ts` | 新增 get-tool-schema case 路由 |
| 工具 handler | 新增 `tool-meta-handler.service.ts`（或内联） | 实现 getToolSchema 查询逻辑 |
| 执行器核心 | `agent-executor.service.ts` | schemaInjectedToolIds + preflight 分层 + 预激活 + D3 豁免 |
| 工具函数 | `agent-executor.helpers.ts` | 新增 `buildToolSchemaHint` / `hasEffectiveSchema` |
| 编排 prompt | `orchestration-prompt-catalog.ts` | 各阶段放宽允许 get-tool-schema |
| 编排调度 | `orchestration-step-dispatcher.service.ts` | 各阶段预激活规则 |
| 编排引擎 | `orchestration-execution-engine.service.ts` | sessionContext 追加 preactivatedToolIds |
| 文档 | `AGENT_RUNTIME.md` / `AGENT_TOOL.md` | 三层机制说明 + authFree 机制 + 默认工具列表 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 不主动调用 get-tool-schema | L2（预激活）和 L3（按需注入）兜底；通过 tool prompt 引导行为 |
| get-tool-schema 消耗额外 1 轮 | 比犯错修正（2 轮 + 扣 15 分）更划算；预激活场景 0 轮消耗 |
| generating 阶段放宽工具约束后 LLM 滥用 get-tool-schema | get-tool-schema 是只读查询，无副作用；D3 豁免仅限此工具 |
| 历史工具 schema 非标准格式 | `hasEffectiveSchema` 兜底；无效 schema 返回 found=false |
| send-internal-message 免授权后被滥用 | 该工具已有 handler 层的业务校验（receiverAgentId/title/content 必填） |
