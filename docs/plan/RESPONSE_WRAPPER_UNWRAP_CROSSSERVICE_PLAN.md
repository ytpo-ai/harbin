# Plan: 跨服务 HTTP 调用统一响应包装解包适配

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | 基础设施 / 跨服务通信 |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-04-19 |

## 2. 背景

系统中 6 个 app（legacy、agents、gateway、ei、channel、ws）均已全局注册 `ResponseInterceptor`（`backend/src/shared/common/interceptors/response.interceptor.ts`），所有 HTTP API 成功响应自动包装为：

```json
{
  "code": 0,
  "message": "success",
  "data": "<实际业务数据>",
  "timestamp": "...",
  "requestId": "..."
}
```

但跨服务 HTTP 调用的两个核心客户端（`InternalApiClient`、`AgentClientService`）大部分方法直接 `return response.data`，返回的是整个 `{ code, message, data }` 包装体，而上层 tool-handler 和消费者**假设拿到的就是裸业务数据**，导致字段读取静默失败（取到 `undefined`、数组判断变空结果等），且不抛异常，极难排查。

### 现状梳理

#### 统一响应拦截器注册情况

| App | main.ts 路径 | 端口 | 已注册拦截器 |
|-----|-------------|------|-------------|
| legacy | `backend/src/main.ts` | 3001 | 是 |
| agents | `backend/apps/agents/src/main.ts` | 3002 | 是 |
| ws | `backend/apps/ws/src/main.ts` | 3003 | 是 |
| ei | `backend/apps/ei/src/main.ts` | 3004 | 是 |
| channel | `backend/apps/channel/src/main.ts` | 3006 | 是 |
| gateway | `backend/apps/gateway/src/main.ts` | 3100 | 是 |

#### 跨服务客户端 response 解析模式分布

| 模式 | 说明 | 使用者 | 风险 |
|------|------|-------|------|
| **A: 直接 `response.data`** | 不做任何解包 | `AgentClientService` 大部分方法、`InternalApiClient.callApi`、`OpenCodeAdapter`、`OpencodeService` | **高** — 拿到的是包装体而非实际数据 |
| **B: `unwrapApiResponseData`** | 检查 `.data` 属性自动解包 | `AgentClientService` 仅 `createAsyncAgentTask`、`getAsyncAgentTask` | 安全但仅 2 处使用 |
| **C: 手动兼容** | `result?.data \|\| result` | `MeetingToolHandler`(3处)、`CommunicationToolHandler`(1处)、`AgentClientService.sendDirectInnerMessage` | 逻辑分散、写法不一致 |
| **D: 双层取值** | `response.data.data` | `AgentClientService.listInnerMessages` | 精确匹配信封格式 |

## 3. 目标

1. 在 `InternalApiClient` 和 `AgentClientService` 两个核心跨服务客户端中**统一解包** `{ code, message, data }` 响应包装，使所有返回值为裸业务数据
2. 清理 tool-handler 中已有的零散解包兼容代码，消除双重解包风险
3. 保证向后兼容：若目标服务未启用拦截器（如外部服务、OpenCode server），解包逻辑应安全降级

## 4. 执行步骤

1. [x] **步骤 1**: `InternalApiClient` 统一解包 — 在 `callApi` 返回前增加 `unwrapResponseEnvelope` 方法，`postEngineeringStatistics`、`postDocsHeatRefresh` 同步处理
2. [x] **步骤 2**: `AgentClientService` 统一解包 — 将已有的 `unwrapApiResponseData` 增强为 `unwrapResponseEnvelope`（识别 `code` + `message` + `data` 三字段共存），应用到所有直接 `return response.data` 的方法
3. [x] **步骤 3**: 处理 `AgentClientService` 中已有的特殊解包逻辑 — `executeTaskDetailed`(L306-314)、`sendDirectInnerMessage`(L701-714)、`listInnerMessages`(L759) 已有手动解包，需与统一解包对齐，避免双重解包
4. [x] **步骤 4**: 清理 tool-handler 零散解包代码 — `meeting-tool-handler.service.ts`(3处 `result?.data || result`)、`communication-tool-handler.service.ts`(1处 `response?.data || response`)，改为直接使用返回值
5. [x] **步骤 5**: 修复 `runtime-ei-sync.service.ts` — `response?.data?.duplicate` 适配包装结构
6. [x] **步骤 6**: 运行 lint + typecheck 验证

## 5. Requirement 拆解

| 编号 | 需求简述 | 状态 |
|------|----------|------|
| REQ-001 | `InternalApiClient.callApi` 统一解包 + `postEngineeringStatistics`/`postDocsHeatRefresh` 适配 | completed |
| REQ-002 | `AgentClientService` 全量方法统一解包 + 特殊解包逻辑对齐 | completed |
| REQ-003 | Tool-handler 零散解包代码清理 + `runtime-ei-sync` 修复 | completed |
| REQ-004 | Lint + typecheck 验证通过 | completed |

## 6. 关键影响点

- **后端**: `InternalApiClient`（`backend/apps/agents/src/modules/tools/internal-api-client.service.ts`）、`AgentClientService`（`backend/src/modules/agents-client/agent-client.service.ts`）
- **Tool handlers**: 6 个 builtin tool handler 的返回值结构恢复正确
  - `orchestration-tool-handler.service.ts` — 17 个调用点
  - `engineering-requirement-tool-handler.service.ts` — 11 个调用点
  - `engineering-statistics-tool-handler.service.ts` — 2 个调用点
  - `meeting-tool-handler.service.ts` — 5 个调用点（3 处需移除旧解包）
  - `communication-tool-handler.service.ts` — 1 个调用点（需移除旧解包）
  - `agent-tool-handler.service.ts` — 1 个调用点
  - `agent-role-tool-handler.service.ts` — 4 个调用点
- **Orchestration**: 依赖 `AgentClientService` 的 14+ 消费者（`OrchestrationExecutionEngine`、`PlannerService`、`SchedulerService` 等）
- **API**: 无接口变更，纯内部 client 层适配
- **数据库**: 无变更

## 7. 风险与依赖

### 风险

1. **双重解包风险**: `executeTaskDetailed` 等方法已有手动解包逻辑，统一解包后需确保不会二次解包。解包方法需严格检测 `code` + `message` + `data` 三字段共存才判定为包装体，避免误判业务数据。
2. **外部服务兼容**: `OpenCodeAdapter`（调用 OpenCode server）和 `OpencodeService`（EI→OpenCode）的目标服务可能不返回统一包装格式，解包方法需安全降级（不含三字段则原样返回）。
3. **Gateway 透传**: `GatewayProxyService` 作为透明代理直接 `res.send(response.data)`，此处应保持原样不做解包——Gateway 本身不消费数据，由最终消费者处理。

### 依赖

- 所有 6 个 app 的 `ResponseInterceptor` 已全部注册且行为一致（已确认）

## 8. 备注

### 解包方法设计要点

```typescript
/**
 * 检测是否为统一响应包装体 { code, message, data }
 * 严格要求三字段共存 + code 为 number 类型，避免误判业务数据
 */
private unwrapResponseEnvelope<T>(payload: unknown): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload as T;
  }
  const body = payload as Record<string, unknown>;
  if (
    typeof body.code === 'number' &&
    'message' in body &&
    Object.prototype.hasOwnProperty.call(body, 'data')
  ) {
    return body.data as T;
  }
  return payload as T;
}
```

### 受影响文件清单

| 文件 | 变更类型 |
|------|---------|
| `backend/apps/agents/src/modules/tools/internal-api-client.service.ts` | 新增 `unwrapResponseEnvelope`，修改 `callApi` / `postEngineeringStatistics` / `postDocsHeatRefresh` |
| `backend/src/modules/agents-client/agent-client.service.ts` | 增强解包方法，应用到 ~20 个方法 |
| `backend/apps/agents/src/modules/tools/builtin/meeting-tool-handler.service.ts` | 移除 3 处 `result?.data \|\| result` 兼容代码 |
| `backend/apps/agents/src/modules/tools/builtin/communication-tool-handler.service.ts` | 移除 1 处 `response?.data \|\| response` 兼容代码 |
| `backend/apps/agents/src/modules/runtime/runtime-ei-sync.service.ts` | 修复 `duplicate` 取值 |
