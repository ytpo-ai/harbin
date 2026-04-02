# Fix 记录：tool-registry toJsonSchemaObject 简写格式解析失败 & 预激活 schema 未持久化

## 1. 基本信息

- 标题：tool-registry toJsonSchemaObject 简写格式 schema 解析失败 + 预激活 schema hint 消息未持久化
- 日期：2026-04-02
- 负责人：Van
- 关联需求/会话：AGENT_TOOL_ON_DEMAND_SCHEMA_GROUNDING_PLAN.md（方案已完成，运行时发现 pre_execute 阶段工具参数错误）
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：前端 agent session 详情页中看不到工具参数 schema hint 消息；pre_execute 阶段 LLM 输出的工具参数格式错误（将 tool_call 和纯文本 JSON 混合输出），说明 LLM 没有收到工具 schema 信息
- 触发条件：任何使用简写格式（`{ paramName: 'string' }`）定义 `implementation.parameters` 的工具，在预激活（preactivation）、`get-tool-schema` 查询、preflight 校验场景中均受影响
- 影响范围：**广泛** — 包括 `requirement.*`、`meeting.*`、`orchestration.*` 等大量工具；覆盖所有编排阶段（pre_execute / generating / post_execute / initialize）的预激活和 preflight 机制
- 严重程度：高

## 3. 根因分析

### 直接原因

`tool-registry.service.ts` 的 `toJsonSchemaObject()` 方法在遍历工具参数时，无法处理简写字符串格式：

```typescript
// Bug 代码（line 637）
if (!value || typeof value !== 'object') return acc;  // "string" 不是 object → 被跳过
```

当工具定义为 `{ requirementId: 'string', status: 'string' }` 时，所有属性值都是字符串 `"string"`，不满足 `typeof value === 'object'` 条件，全部被跳过，最终产出空 schema：

```json
{ "type": "object", "properties": {} }
```

随后 `hasEffectiveSchema({ properties: {} })` 返回 `false`，schema hint 不生成、不注入。

### 深层原因

1. **同名函数实现不一致**：`tool-execution.service.ts` 中的 `toJsonSchemaObject()` 正确处理了 `typeof value === 'string'` 的分支（line 390），但 `tool-registry.service.ts` 中的版本遗漏了这个分支。两个文件在不同时期编写，schema grounding 方案实施时复用了 `tool-registry.service.ts` 的版本作为 `getToolInputContract` 的底层，未发现与 `tool-execution.service.ts` 的差异。

2. **预激活消息未持久化**：`agent-executor.service.ts` 中 `persistIntermediateSystemMessage` 闭包定义在预激活循环**之后**（line 977），预激活循环（line 961-975）只做了 `messages.push()` 推入内存，没有调用持久化。因此即使 schema 被注入给 LLM，前端 session 详情页也无法展示。

### 相关模块/文件

| 文件 | 角色 |
|------|------|
| `backend/apps/agents/src/modules/tools/tool-registry.service.ts` | 工具 schema 解析（被 getToolInputContract 使用） |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | 预激活 schema 注入 + 持久化 |
| `backend/apps/agents/src/modules/tools/tool-execution.service.ts` | 对比参考（正确实现） |

## 4. 修复动作

### 修复方案

**Fix 1：`tool-registry.service.ts` — 补充简写字符串格式解析**

在 `toJsonSchemaObject` 的属性遍历中，增加对 `typeof value === 'string'` 的处理分支，与 `tool-execution.service.ts` 对齐：

```typescript
// 修复后
if (typeof value === 'string') {
  acc[normalizedKey] = { type: value.trim().toLowerCase() || 'string' };
  return acc;
}
if (!value || typeof value !== 'object') return acc;
```

**Fix 2：`agent-executor.service.ts` — 预激活 schema hint 消息持久化**

将 `persistIntermediateSystemMessage` 闭包定义提前到预激活循环之前，并在注入 schema hint 后调用持久化：

```typescript
await persistIntermediateSystemMessage(-1, preactivationOffset++, schemaHint, {
  source: 'preactivation.tool-schema-injected',
  toolId,
});
```

`round = -1` 表示在 tool-calling 循环之前，`offset` 递增保证多个预激活工具的 sequence 不冲突。

### 代码改动点

| 文件 | 行号 | 改动 |
|------|------|------|
| `tool-registry.service.ts` | 632-648 | `toJsonSchemaObject` reduce 回调补充 string 分支 + key 归一化 |
| `agent-executor.service.ts` | 959-1004 | `persistIntermediateSystemMessage` 定义上移；预激活循环增加持久化调用 |
| `tool-registry.service.spec.ts` | 新增 | 2 个测试用例：简写格式 + 混合格式 |

### 兼容性处理

- 简写格式和对象格式均可正确解析，不影响已有的标准 JSON Schema 格式工具
- 预激活持久化使用 `round = -1`，不影响 tool-calling 循环内已有消息的 sequence 计算
- 前端 `getSystemMessageTag` 中 `source.includes('tool-calling-loop')` 匹配不受影响，新增的 `preactivation.*` source 会被前端正常展示

## 5. 验证结果

- 验证步骤：
  1. `pnpm test "tool-registry.service.spec"` — 3 passed（含 2 个新增用例）
  2. `pnpm test "tool-execution-dispatcher.service.spec"` — 8 passed
  3. `pnpm test "agent-executor.service.spec"` — 14 passed
  4. `pnpm test "tool-execution"` — 9 passed（2 suites）
  5. `pnpm test "agent-executor"` — 16 passed（2 suites）
- 验证结论：通过
- 测试与检查：所有相关测试通过，无回归

## 6. 风险与后续

- 已知风险：
  - 前端 `getSystemMessageTag` 对 `preactivation.*` source 可能显示为通用标签而非专属标签，可后续优化
  - `tool-registry.service.ts` 和 `tool-execution.service.ts` 存在两套 `toJsonSchemaObject` 实现，长期应统一为一个共享函数
- 后续优化：
  - 建议统一两处 `toJsonSchemaObject` 实现到共享 utility，消除重复
  - 建议在 `builtin-tool-catalog.ts` 中逐步将简写格式升级为标准 JSON Schema（含 required、additionalProperties），特别是高频工具
- 是否需要补充功能文档/API文档：否（已有 AGENT_TOOL.md 覆盖三层机制说明）
