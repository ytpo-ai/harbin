# AgentService 拆分 Plan：curl 行为 vs execute 行为

## 背景

`AgentService`（2857行）承载了过多职责，需要将其中的 **curl 行为**（外部 HTTP 调用、角色/权限管理）和 **execute 行为**（Agent 执行、tool calling、prompt 构建）拆分为两个独立 Service，使 AgentService 瘦身为 CRUD + 门面委派。

## 目标

- 提高可维护性，降低单文件复杂度
- 职责清晰：curl 归 curl，execute 归 execute，CRUD 归 AgentService
- 外部接口（Controller/Worker）无感知变化

## 拆分方案

### 1. 创建 `AgentRoleService`（curl/HTTP 行为）

**文件**: `agent-role.service.ts`

提取以下方法：

| 方法 | 类型 | 说明 |
|------|------|------|
| `getAvailableRoles()` | public | axios GET /roles |
| `getRoleById()` | public | axios GET /roles/:id |
| `assertRoleExists()` | public | 依赖 getRoleById |
| `getRoleMapByIds()` | public | 批量 getRoleById |
| `inheritRoleProfilePermissions()` | public | 依赖 assertRoleExists + MCP profile |
| `ensureToolsWithinRolePermissionWhitelist()` | public | 依赖 assertRoleExists + MCP profile |
| `getAllowedToolIds()` | public | 依赖 getRoleById + MCP profile |
| `getMcpAgents()` | public | 组合 DB 查询 + role HTTP + MCP profile |
| `getMcpAgent()` | public | 单个 Agent MCP profile 构建 |
| `getToolPermissionSets()` | public | 依赖 getAvailableRoles |
| `upsertToolPermissionSet()` | public | 依赖 getAvailableRoles |
| `resetToolPermissionSetsBySystemRoles()` | public | 依赖 getAvailableRoles |

**依赖注入**:
- `AgentMcpProfileService`（已有）
- `ToolService`
- MongoDB Model: `Agent`, `AgentProfile`

**成员字段**:
- `legacyBaseUrl` / `roleRequestTimeoutMs` 移入此 Service

### 2. 创建 `AgentExecutorService`（execute 行为）

**文件**: `agent-executor.service.ts`

提取以下方法：

| 方法 | 类型 | 说明 |
|------|------|------|
| `executeTask()` | public | 简单封装 |
| `executeTaskDetailed()` | public | 核心非流式执行 |
| `executeTaskWithStreaming()` | public | 核心流式执行 |
| `testAgentConnection()` | public | 模型连接测试 |
| `cancelRuntimeRun()` | public | 取消运行 |
| `cancelOpenCodeSession()` | public | 取消 OpenCode session |
| `executeWithToolCalling()` | private | 原生 tool-calling 循环 |
| `buildMessages()` | private | 消息构建 |
| `buildToolPromptMessages()` | private | 工具 prompt 构建 |
| `getEnabledSkillsForAgent()` | private | 技能加载 |
| `shouldActivateSkillContent()` | private | 技能激活判断 |
| `resolveSystemContextScope()` | private | 上下文 scope 解析 |
| `resolveSystemContextBlockContent()` | private | 指纹去重 |
| `resolveOpenCodeRuntimeOptions()` | private | OpenCode runtime 解析 |
| `resolveLatestUserContent()` | private | 最新用户消息 |
| `resolveCustomApiKey()` | private | 自定义 API Key |
| `extractToolCall()` / `parseToolCallPayload()` | private | tool call 解析 |
| `stripToolCallMarkup()` | private | 清理标记 |
| `shouldForceModelManagementGrounding()` | private | 模型管理 grounding |
| `tryHandleModelManagementDeterministically()` | private | 确定性模型管理 |
| `extractRequestedModelsFromConversation()` | private | 提取模型 ID |
| `inferProviderFromModelId()` / `toModelDisplayName()` | private | 模型工具方法 |
| `isMeetingLikeTask()` / `isMeaninglessAssistantResponse()` | private | 会议判断 |
| `shouldRetryGenerationError()` / `isModelTimeoutError()` | private | 重试判断 |
| `buildTaskInfoDelta()` / `buildIdentityMemoDelta()` | private | 增量构建 |
| `ensureTaskRuntime()` / `runMemoOperation()` | private | 运行时辅助 |
| `renderAgentPrompt()` | private | prompt 渲染 |

**依赖注入**:
- `AgentRoleService`（新建）
- `AgentExecutionService`（已有）
- `AgentOrchestrationIntentService`（历史项，文件已于 2026-03-19 删除）
- `AgentOpenCodePolicyService`（已有）
- `ModelService`、`ApiKeyService`、`ToolService`
- `MemoService`、`MemoEventBusService`
- `RuntimeOrchestratorService`、`RuntimeEiSyncService`
- `OpenCodeExecutionService`
- `RedisService`
- MongoDB Model: `Skill`

### 3. 瘦身 `AgentService`（保留 CRUD + 门面委派）

保留方法：
- `createAgent()` / `getAgent()` / `getAgentByName()` / `getAllAgents()` / `getActiveAgents()` / `updateAgent()` / `deleteAgent()`
- `migrateAllToolIdsToCanonical()`
- `seedMcpProfileSeeds()`
- `getAgentCapabilities()` / `isAgentAvailable()`
- `getMcpProfiles()` / `getMcpProfile()` / `upsertMcpProfile()`
- 工具方法：`normalizeAgentConfig()`, `normalizeToolId()`, `normalizeToolIds()`, `normalizeSkillIds()`, `ensureSkillsExist()`, `normalizeAgentEntity()`, `uniqueStrings()`, `buildAgentLookupQuery()`

门面委派（保持 public 接口向后兼容）：
- `executeTask()` → `agentExecutorService.executeTask()`
- `executeTaskDetailed()` → `agentExecutorService.executeTaskDetailed()`
- `executeTaskWithStreaming()` → `agentExecutorService.executeTaskWithStreaming()`
- `testAgentConnection()` → `agentExecutorService.testAgentConnection()`
- `cancelRuntimeRun()` → `agentExecutorService.cancelRuntimeRun()`
- `cancelOpenCodeSession()` → `agentExecutorService.cancelOpenCodeSession()`
- `getAvailableRoles()` → `agentRoleService.getAvailableRoles()`
- `getRoleById()` → `agentRoleService.getRoleById()`
- `getMcpAgents()` → `agentRoleService.getMcpAgents()`
- `getMcpAgent()` → `agentRoleService.getMcpAgent()`
- `getToolPermissionSets()` → `agentRoleService.getToolPermissionSets()`
- `upsertToolPermissionSet()` → `agentRoleService.upsertToolPermissionSet()`
- `resetToolPermissionSetsBySystemRoles()` → `agentRoleService.resetToolPermissionSetsBySystemRoles()`

**依赖注入**:
- `AgentRoleService`（新建）
- `AgentExecutorService`（新建）
- `AgentMcpProfileService`（已有）
- `MemoEventBusService`
- MongoDB Model: `Agent`, `AgentProfile`, `Skill`

### 4. 共享常量/接口

将以下内容提取到现有或新文件中供多个 Service 共享：
- 接口类型：`AgentContext`, `ExecuteTaskResult`, `AgentMcpProfile`, `AgentBusinessRole`, `AgentToolPermissionSet`, `AgentMcpMapProfile` 等 → 保留在 `agent.service.ts` 导出或新建 `agent.types.ts`
- 常量：`LEGACY_TOOL_ID_ALIASES`, `ORCHESTRATION_TOOL_IDS`, `MEMO_MCP_*_TOOL_ID` 等 → 保留在 `agent.service.ts` 或新建 `agent.constants.ts`
- 工具方法：`normalizeToolId()`, `uniqueStrings()`, `compactLogText()`, `toLogError()`, `hashFingerprint()` → 可在多处使用，提取为共享工具

### 5. Module 更新

`agent.module.ts` providers 新增 `AgentRoleService` 和 `AgentExecutorService`。

### 6. 测试迁移

`agent.service.spec.ts` 中：
- `buildToolPromptMessages` / `resolveOpenCodeRuntimeOptions` → 迁移到 `agent-executor.service.spec.ts`
- `buildAgentLookupQuery` → 保留在 `agent.service.spec.ts`
- `isMeaninglessAssistantResponse` / `buildTaskInfoDelta` → 迁移到 `agent-executor.service.spec.ts`

## 关键影响点

- **后端**: agents 模块内部重构
- **API**: 无变更，Controller 接口保持不变
- **外部消费者**: `AgentService` 仍然导出，门面委派保证向后兼容

## 执行顺序

1. 创建 `agent.types.ts` + `agent.constants.ts`（共享类型和常量）
2. 创建 `AgentRoleService`
3. 创建 `AgentExecutorService`
4. 瘦身 `AgentService`（保留 CRUD + 门面委派）
5. 更新 `AgentModule`
6. 更新测试
7. 运行 lint + typecheck 验证
