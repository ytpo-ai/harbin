# 工具系统统一化架构技术设计

## 1. 设计目标

本设计用于统一当前两类工具形态：

- 工具包型（Composio: Slack/Gmail/GitHub）
- 原子工具型（内建 memo/skill 等）

核心目标：

1. 统一调用单元为 `Tool`，降低模型选工具复杂度。
2. 保留 `Toolkit` 作为治理与运维边界，不丢失 provider 能力。
3. 建立统一执行链路与统一可观测性。
4. 支持短窗口迁移，完成后下线旧工具体系。

## 2. 逻辑架构

采用三层模型：

1. **Toolkit 层（管理层）**
   - 负责 provider、认证、配额、版本、生命周期状态。
2. **Tool 层（执行层）**
   - 面向 LLM/调用方的统一原子工具。
3. **Adapter 层（接入层）**
   - 将外部 SDK/内部实现转换为统一协议。

执行链路：

`discover -> select -> authorize -> validate -> execute -> normalize -> audit -> observe`

## 3. 统一元模型

### 3.1 Toolkit

```ts
type Toolkit = {
  id: string;
  provider: 'composio' | 'internal' | 'mcp';
  name: string;
  version: string;
  authStrategy: 'oauth2' | 'apiKey' | 'none';
  status: 'active' | 'disabled' | 'deprecated';
  rateLimitPolicyId?: string;
  defaultTimeoutMs?: number;
  metadata?: Record<string, unknown>;
};
```

### 3.2 Tool

```ts
type ToolDefinition = {
  id: string; // e.g. github.issues.list / internal.memo.search
  toolkitId: string;
  namespace: string; // github / slack / internal
  resource: string; // issues / memo
  action: string; // list / search
  title: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema: Record<string, unknown>; // JSON Schema
  requiredScopes: string[]; // e.g. github.issues.read
  tags: string[];
  capabilitySet: string[];
  status: 'active' | 'hidden' | 'deprecated';
  deprecated?: boolean;
  replacedBy?: string;
  aliases?: string[]; // old ids
};
```

### 3.3 ToolExecution

```ts
type ToolExecutionRecord = {
  executionId: string;
  toolId: string;
  organizationId: string;
  actorId: string;
  traceId: string;
  toolCallId?: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout';
  durationMs?: number;
  retryCount: number;
  errorCode?: string;
  errorMessage?: string;
  inputPreview?: unknown;
  outputPreview?: unknown;
  createdAt: string;
  updatedAt: string;
};
```

## 4. Registry 设计

建议最小集合：

1. `toolkits`
2. `tools`
3. `tool_versions`（可选）
4. `tool_execution_logs`

关键索引：

- `tools.id` 唯一索引
- `tools.toolkitId + status`
- `tools.namespace + resource + action`
- `tool_execution_logs.traceId`
- `tool_execution_logs.organizationId + createdAt`

## 5. Adapter 规范

每个 Adapter 必须实现：

```ts
interface ToolAdapter {
  discoverTools(): Promise<ToolDefinition[]>;
  validateInput(tool: ToolDefinition, input: unknown): Promise<void>;
  execute(ctx: ExecutionContext, tool: ToolDefinition, input: unknown): Promise<unknown>;
  normalizeError(error: unknown): NormalizedToolError;
}
```

### 5.1 Composio Adapter

- 启动阶段读取 toolkit 方法列表并展开为 `ToolDefinition`。
- 每个方法映射为一个 `toolId`。
- 统一处理分页与游标字段（如 `nextCursor`）。
- 统一错误码（`AUTH_FAILED`, `RATE_LIMITED`, `TIMEOUT`, `UPSTREAM_ERROR`）。

### 5.2 Internal Adapter

- 将 memo/skill 等现有单工具统一注册到 Registry。
- 输入输出必须带 Schema。
- 统一上下文字段：`organizationId/agentId/sessionId/traceId`。

## 6. 路由与选择策略

采用两级路由：

1. **域路由（Domain Routing）**
   - 根据用户意图、上下文标签、权限范围，先选 domain（github/slack/internal）。
2. **动作路由（Action Routing）**
   - 在 domain 内按语义匹配 + 历史成功率排序，输出 Top-K。

推荐评分函数：

`score = semanticScore * 0.5 + successRate * 0.2 + latencyScore * 0.1 + policyBoost * 0.2`

其中 `policyBoost` 可用于安全白名单与业务优先级兜底。

## 7. 权限模型

权限下沉到 action 级：

- `tool:execute:<toolId>`
- `tool:read:<namespace>`
- `tool:admin:<toolkitId>`

运行时校验顺序：

1. 组织级开关
2. 角色权限（RBAC）
3. OAuth/API Scope
4. 高风险动作二次确认（可选）

## 8. 执行治理策略

每个工具可配置：

- `timeoutMs`
- `maxRetries`
- `backoffStrategy`（指数退避）
- `idempotencyKeyResolver`
- `circuitBreakerPolicy`
- `rateLimitPolicy`

默认策略建议：

- 超时：10s（可按工具覆盖）
- 重试：2 次，仅对可重试错误生效
- 熔断：5 次连续失败后熔断 30s

## 9. 可观测性与审计

### 9.1 指标

- `tool_selected_total`
- `tool_execute_total{status}`
- `tool_execute_latency_ms`
- `tool_execute_retry_total`
- `tool_fallback_total`
- `tool_token_cost_total`

### 9.2 审计字段

- `traceId`
- `toolCallId`
- `organizationId`
- `actorId`
- `toolId`
- `inputPreview/outputPreview`
- `errorCode/errorMessage`

### 9.3 日志规范

- 执行开始：`tool.execute.start`
- 执行成功：`tool.execute.succeeded`
- 执行失败：`tool.execute.failed`
- 回退触发：`tool.execute.fallback`

## 10. 兼容迁移设计

目标状态：

- 迁移窗口结束后，运行时仅识别新 `ToolDefinition.id`。
- 旧 id 映射仅在迁移窗口内生效，之后移除 alias 解析。

### 10.1 兼容层

- 为旧 tool id 配置 `aliases`。
- 执行入口接收旧 id 时先查 alias 再路由。
- 返回结果内透出 `resolvedToolId` 便于排障。
- 兼容层生效期为一个迭代周期，超期后关闭。

### 10.2 灰度策略

1. 只读灰度：新 Registry 参与发现，不参与执行。
2. 小流量灰度：5%-20% 流量走新执行链。
3. 全量切换：按 domain 分批切换。
4. 收口清理：旧入口标记 deprecated，观察窗口结束后移除。

### 10.3 旧体系下线清单

1. 删除旧工具注册入口（仅保留 Adapter 注入 Registry）。
2. 删除旧执行分支与旧错误格式返回。
3. 删除旧 id 新增配置能力（仅保留历史查询）。
4. 关闭 alias 解析开关并记录最终下线时间。

### 10.4 alias 下线阈值规则

1. 观测数据源：`GET /tools/registry/alias-hits`。
2. 判定阈值：连续 **1 天** alias 命中总量为 0（按自然日统计）。
3. 达标动作：关闭 alias 解析开关并发布下线公告。
4. 保护机制：关闭后保留一天只读观察；若出现兼容请求，按版本回滚，不恢复长期双轨。

## 11. API 变更建议（兼容优先）

在保持现有 `/tools` 路径兼容前提下，建议新增：

- `GET /tools/registry`：工具查询（支持 provider/domain/tag/capability）
- `GET /tools/:id`：单工具定义
- `POST /tools/:id/execute`：继续沿用，返回增加 `resolvedToolId/traceId`
- `GET /tools/executions/:executionId`：单次执行明细

下线策略：

- `POST /tools/:id/execute` 保持路径兼容，但仅接受新 id（迁移窗口结束后）。
- 旧 id 请求返回 `410` 或业务错误码 `TOOL_ID_DEPRECATED`（按发布策略二选一）。

错误返回建议统一：

```json
{
  "success": false,
  "error": {
    "code": "TOOL_TIMEOUT",
    "message": "Tool execution timed out",
    "retryable": true
  },
  "traceId": "..."
}
```

## 12. 测试与验收

测试分层：

1. 单元测试：Adapter、Schema 校验、错误归一化。
2. 集成测试：Registry + Router + Executor 全链路。
3. 回归测试：旧 id 兼容、权限边界、灰度回滚。

关键验收：

- 同请求场景下，Composio/内建工具调用契约一致。
- 高风险动作可被权限与策略正确拦截。
- 指标与审计日志能追踪单次调用全过程。
- 迁移窗口结束后，旧入口调用量与 alias 命中量均为 0。

## 13. 相关文档

- 方案计划：`docs/plan/TOOLING_UNIFICATION_ARCHITECTURE_PLAN.md`
- 迁移清单：`docs/plan/TOOLING_UNIFICATION_TOOL_MIGRATION_CHECKLIST.md`
- 功能文档：`docs/feature/AGENT_TOOL.md`
- API 文档：`docs/api/agents-api.md`
