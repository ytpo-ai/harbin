# tool.service.ts 拆分 & 内部工具 builtin 目录统一 — 技术设计

## 1. 现状分析

### 1.1 当前文件职责分布

`backend/apps/agents/src/modules/tools/tool.service.ts`（2664 行 / 87 方法）承担了 6 类职责：

| 职责域 | 方法数 | 行数 | 典型方法 |
|--------|--------|------|----------|
| A. Tool Identity 解析 & 元数据 | 11 | ~150 | `parseToolIdentity`, `inferXxx`, `buildBuiltinToolMetadata` |
| B. Registry CRUD/查询/路由/种子 | 20 | ~500 | `seedBuiltinTools`, `getAllTools`, `getToolRegistry`, `getTopKToolRoutes` |
| C. 执行引擎（鉴权/校验/重试/归一化） | 15 | ~500 | `executeTool`, `authorizeToolExecution`, `validateToolInput` |
| D. 分发路由 | 5 | ~200 | `executeToolImplementation`, `dispatchXxxToolImplementation` |
| E. 内联工具实现（未抽 handler） | 25 | ~900 | Agent CRUD, Agent Role CRUD, Memo, 通讯, RD Intelligence |
| F. 执行历史/统计 | 3 | ~80 | `getToolExecutions`, `getToolExecutionStats` |

### 1.2 Constructor 依赖（22 个注入）

**Injected Models（8 个）：** Tool, Toolkit, ToolExecution, Agent, AgentProfile, AgentRole, ApiKey, Skill

**Injected Services（14 个）：** ComposioService, WebToolsService, ModelManagementService, MemoService, MemoWriteQueueService, RedisService, InternalApiClient, ToolGovernanceService, OrchestrationToolHandler, RequirementToolHandler, RepoToolHandler, ModelToolHandler, SkillToolHandler, AuditToolHandler, MeetingToolHandler, PromptRegistryToolHandler

### 1.3 已有 Handler 模式

项目已有 8 个 `*-tool-handler.service.ts`（orchestration/requirement/repo/model/skill/audit/meeting/prompt-registry），遵循统一模式：
- `@Injectable()` 类
- 注入 `InternalApiClient` 或其他基础设施 service
- 暴露领域方法供 `tool.service.ts` 的 dispatch 调用

### 1.4 已确认死代码

以下 10 个方法在 `tool.service.ts` 中存在，但 dispatch 路由已绕过它们直接调用 handler，属于遗留死代码：

| 方法 | 行号 | 遗留原因 |
|------|------|----------|
| `getCodeDocsReader` | 2487 | dispatch 直接调 `repoToolHandler.getCodeDocsReader` |
| `getCodeUpdatesReader` | 2494 | 同上 |
| `executeDocsWrite` | 2501 | 同上 |
| `executeRepoRead` | 2510 | 同上 |
| `listMeetings` | 2641 | dispatch 直接调 `meetingToolHandler` |
| `sendMeetingMessage` | 2649 | 同上 |
| `updateMeetingStatus` | 2657 | 同上 |
| `listSkillsByTitle` | 1876 | dispatch 直接调 `skillToolHandler` |
| `createSkillByMcp` | 1888 | 同上 |
| `debugOrchestrationTask` | 1801 | 与 `orchestrationToolHandler.debugOrchestrationTask` 重复 |

---

## 2. 目标目录结构

```
backend/apps/agents/src/modules/tools/
├── builtin/                                     # ← 所有内部工具 handler 统一放入
│   ├── index.ts                                 # barrel export
│   │
│   │  # ── 已有 handler（迁移入）──────────────
│   ├── orchestration-tool-handler.service.ts
│   ├── requirement-tool-handler.service.ts
│   ├── repo-tool-handler.service.ts
│   ├── model-tool-handler.service.ts
│   ├── skill-tool-handler.service.ts
│   ├── audit-tool-handler.service.ts
│   ├── meeting-tool-handler.service.ts
│   ├── prompt-registry-tool-handler.service.ts
│   ├── web-tools.service.ts
│   │
│   │  # ── 新建 handler（从 tool.service.ts 抽出）──
│   ├── agent-master-tool-handler.service.ts
│   ├── agent-role-tool-handler.service.ts
│   ├── memo-tool-handler.service.ts
│   ├── communication-tool-handler.service.ts
│   └── rd-intelligence-tool-handler.service.ts
│
│  # ── 拆分后的核心 service ──────────────────────
├── tool-identity.util.ts                        # 纯函数：Tool ID 解析 & 元数据构建
├── tool-registry.service.ts                     # Registry CRUD / 查询 / 路由 / 种子 / 执行历史
├── tool-execution.service.ts                    # 执行引擎：调度、鉴权、校验、重试、归一化
├── tool-execution-dispatcher.service.ts         # 分发路由：tool ID → handler 方法映射
├── tool.service.ts                              # Facade（~100 行，保持外部接口兼容）
│
│  # ── 不变的文件 ─────────────────────────────────
├── tool.controller.ts
├── tool.module.ts                               # 需更新 import + provider 注册
├── tool-execution-context.type.ts
├── tool-governance.service.ts
├── builtin-tool-catalog.ts
├── builtin-tool-definitions.ts
├── composio.service.ts
├── exa.service.ts
├── internal-api-client.service.ts
├── agent-tool-auth.guard.ts
├── agent-tool-auth.service.ts
├── local-repo-docs-reader.util.ts
└── local-repo-updates-reader.util.ts
```

---

## 3. 各文件设计细节

### 3.1 `tool-identity.util.ts` — 纯函数工具类

**设计原则：** 无状态、无 DI、纯函数导出，可被任何 service 直接 import。

```typescript
// ── 类型 ──
export interface ParsedToolIdentity {
  provider: string;
  executionChannel: string;
  namespace: string;
  toolkit: string;
  toolkitId: string;
  resource: string;
  action: string;
}

// ── 核心解析 ──
export function parseToolIdentity(toolId: string): ParsedToolIdentity { ... }

// ── 快捷访问器 ──
export function inferProviderFromToolId(toolId: string): string { ... }
export function inferExecutionChannel(toolId: string): string { ... }
export function inferNamespaceFromToolId(toolId: string): string { ... }
export function inferToolkitFromToolId(toolId: string): string { ... }
export function inferToolkitIdFromToolId(toolId: string): string { ... }
export function inferResourceAndAction(toolId: string): { resource: string; action: string } { ... }

// ── 元数据构建 ──
export function getToolkitDisplayName(toolkit: string): string { ... }
export function buildBuiltinToolMetadata(toolData: { id: string; category: string; implementation?: { parameters?: Record<string, unknown> } }): { ... } { ... }
export function inferToolkitAuthStrategy(provider: string, namespace: string, toolkit?: string): 'oauth2' | 'apiKey' | 'none' { ... }

// ── 分类判定 ──
export function isSystemManagementTool(toolId: string): boolean { ... }
```

**迁移方式：** 将 `ToolService` 中 11 个 `private` 方法原样提取，去掉 `this` 引用，改为顶层导出函数。内部类型 `ParsedToolIdentity` 也随之迁出。

---

### 3.2 `tool-registry.service.ts` — Registry 服务

**职责：** Tool/Toolkit 的种子初始化、CRUD、多维查询、路由评分、执行历史聚合、View 转换。

**Constructor 依赖：**

```typescript
@Injectable()
export class ToolRegistryService {
  constructor(
    @InjectModel(Tool.name)        private toolModel: Model<ToolDocument>,
    @InjectModel(Toolkit.name)     private toolkitModel: Model<ToolkitDocument>,
    @InjectModel(ToolExecution.name) private executionModel: Model<ToolExecutionDocument>,
  ) {}
}
```

**方法清单（从 tool.service.ts 迁入）：**

| 方法 | 原行号 | 说明 |
|------|--------|------|
| `seedBuiltinTools(mode)` | 145 | public 入口 |
| `initializeBuiltinTools(mode)` | 475 | 核心种子逻辑 |
| `syncToolkitsFromTools(mode)` | 349 | Toolkit 同步 |
| `upsertToolkit(data)` | 313 | Toolkit upsert |
| `alignStoredToolMetadata()` | 435 | 元数据对齐 |
| `getAllTools()` | 567 | |
| `getAllToolsView()` | 571 | |
| `getToolkits(query)` | 576 | |
| `getToolkit(id)` | 588 | |
| `getToolRegistry(query)` | 594 | |
| `getTopKToolRoutes(query)` | 664 | |
| `getTool(toolId)` | 742 | |
| `getToolView(toolId)` | 750 | |
| `getToolInputContract(toolId)` | 756 | |
| `getToolsByIds(toolIds)` | 767 | |
| `createTool(data)` | 778 | |
| `updateTool(toolId, updates)` | 803 | |
| `deleteTool(toolId)` | 809 | |
| `getToolExecutions(agentId, toolId)` | 2564 | |
| `getToolExecutionStats()` | 2574 | |
| `buildToolkitView(toolkit)` | 300 | private |
| `toToolView(tool)` | 415 | private |
| `toExecutionView(execution)` | 458 | private |

**对 `tool-identity.util.ts` 的依赖：** 直接 import 纯函数，不通过 DI。

**对 `tool-execution-dispatcher.service.ts` 的依赖：** `initializeBuiltinTools` 内校验 `getImplementedToolIds()`，需 import dispatcher 或将 ID 列表提取为常量。建议后者——将 `IMPLEMENTED_TOOL_IDS` 保留在 `builtin-tool-catalog.ts` 中（当前已在该文件）。

---

### 3.3 `tool-execution.service.ts` — 执行引擎

**职责：** 工具执行的主逻辑入口，包含鉴权链、输入校验、重试机制、结果/错误归一化。

**Constructor 依赖：**

```typescript
@Injectable()
export class ToolExecutionService {
  private readonly rolePermissionCache = new Map<string, { roleCode?: string; permissions: string[]; expiresAt: number }>();

  constructor(
    @InjectModel(Tool.name)           private toolModel: Model<ToolDocument>,
    @InjectModel(ToolExecution.name)  private executionModel: Model<ToolExecutionDocument>,
    @InjectModel(Agent.name)          private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name)   private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentRole.name)      private agentRoleModel: Model<AgentRoleDocument>,
    private toolGovernanceService: ToolGovernanceService,
    private dispatcher: ToolExecutionDispatcherService,
    private registry: ToolRegistryService,   // 仅用于 getTool
  ) {}
}
```

**方法清单（从 tool.service.ts 迁入）：**

| 方法 | 原行号 | 访问级别 | 说明 |
|------|--------|----------|------|
| `executeTool(toolId, agentId, params, taskId?, ctx?)` | 814 | public | 主入口 |
| `authorizeToolExecution(tool, agentId, ctx?)` | 931 | private | 鉴权链 |
| `resolveRoleAndProfilePermissions(roleId?)` | 1004 | private | 权限解析（带缓存） |
| `validateToolInput(params, inputSchema?)` | 1062 | private | 输入校验 |
| `normalizeToolInputSchema(inputSchema?, implParams?)` | 1122 | private | Schema 归一 |
| `toJsonSchemaObject(raw)` | 1130 | private | JSON Schema 转换 |
| `normalizeToolResult(rawResult, traceId)` | 1186 | private | 结果归一 |
| `sanitizeToolOutput(rawResult, depth?)` | 1194 | private | 输出净化 |
| `normalizeToolError(error)` | 1231 | private | 错误归一 |
| `inferExecutionErrorCode(error)` | 1241 | private | 错误码推断 |

**关键交互：**
- `executeTool` 内部先调 `registry.getTool()` 获取工具定义
- 执行具体逻辑时调 `dispatcher.executeToolImplementation(tool, params, agentId, ctx)`
- 使用 `tool-identity.util.ts` 中的 `isSystemManagementTool` 等函数

**辅助函数（迁入或共享）：**

| 函数 | 原行号 | 处理方式 |
|------|--------|----------|
| `normalizeBooleanQuery` | 391 | 迁入或放 util |
| `parsePositiveInt` | 400 | 迁入或放 util |
| `normalizeErrorToCode` | 406 | 迁入 |
| `isRetryableError` | 410 | 迁入 |
| `normalizeStringArray` | 1907 | 放入 `tool-identity.util.ts` 或独立共享 util |

---

### 3.4 `tool-execution-dispatcher.service.ts` — 分发路由

**职责：** 将工具 ID 映射到具体的 handler 方法调用。

**Constructor 依赖：**

```typescript
@Injectable()
export class ToolExecutionDispatcherService {
  constructor(
    private orchestrationToolHandler: OrchestrationToolHandler,
    private requirementToolHandler: RequirementToolHandler,
    private repoToolHandler: RepoToolHandler,
    private modelToolHandler: ModelToolHandler,
    private skillToolHandler: SkillToolHandler,
    private auditToolHandler: AuditToolHandler,
    private meetingToolHandler: MeetingToolHandler,
    private promptRegistryToolHandler: PromptRegistryToolHandler,
    private webToolsService: WebToolsService,
    // ── 新增 handler ──
    private agentMasterToolHandler: AgentMasterToolHandler,
    private agentRoleToolHandler: AgentRoleToolHandler,
    private memoToolHandler: MemoToolHandler,
    private communicationToolHandler: CommunicationToolHandler,
    private rdIntelligenceToolHandler: RdIntelligenceToolHandler,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 说明 |
|------|--------|------|
| `executeToolImplementation(tool, params, agentId?, ctx?)` | 1275 | 中央 switch/dispatch |
| `dispatchRepoToolImplementation(toolId, params)` | 1363 | Repo 分支 |
| `dispatchPromptRegistryToolImplementation(toolId, params)` | 1380 | Prompt Registry 分支 |
| `dispatchOrchestrationToolImplementation(toolId, params, agentId?, ctx?)` | 1396 | Orchestration 分支 |
| `dispatchRequirementToolImplementation(toolId, params, agentId?, ctx?)` | 1428 | Requirement 分支 |
| `getImplementedToolIds()` | 1456 | 返回已实现 ID 列表 |

**dispatch 改造要点：**

原 `executeToolImplementation` 中的 `switch` 分支需将内联调用（如 `this.sendSlackMessage`, `this.getAgentsMcpList`）改为委托新 handler：

```typescript
// Before (内联调用)
case 'composio.communication.mcp.slack.send-message':
  return this.sendSlackMessage(parameters, agentId);

// After (委托 handler)
case 'composio.communication.mcp.slack.send-message':
  return this.communicationToolHandler.sendSlackMessage(parameters, agentId);
```

---

### 3.5 `builtin/agent-master-tool-handler.service.ts` — Agent 管理 Handler

**Constructor 依赖：**

```typescript
@Injectable()
export class AgentMasterToolHandler {
  constructor(
    @InjectModel(Agent.name)        private agentModel: Model<AgentDocument>,
    @InjectModel(AgentProfile.name) private agentProfileModel: Model<AgentProfileDocument>,
    @InjectModel(AgentRole.name)    private agentRoleModel: Model<AgentRoleDocument>,
    @InjectModel(ApiKey.name)       private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(Skill.name)        private skillModel: Model<SkillDocument>,
    private redisService: RedisService,
    private internalApiClient: InternalApiClient,
    private modelManagementService: ModelManagementService,
    private memoService: MemoService,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 访问级别 |
|------|--------|----------|
| `getAgentsMcpList(params)` | 2253 | public |
| `createAgentByMcp(params)` | 1970 | public |
| `getAgentRuntimeStatusMap(agentIds)` | 2425 | private |
| `getRoleMapByIds(roleIds)` | 2455 | private |
| `resolveDefaultApiKeyId(provider)` | 1917 | private |
| `resolveRoleIdForCreate(roleInput)` | 1937 | private |
| `normalizeProvider(provider)` | 1794 | private |

**共享工具函数引用：** `normalizeStringArray` → 从 `tool-identity.util.ts` 或共享 util import。

---

### 3.6 `builtin/agent-role-tool-handler.service.ts` — Agent Role 管理 Handler

**Constructor 依赖：**

```typescript
@Injectable()
export class AgentRoleToolHandler {
  constructor(
    private internalApiClient: InternalApiClient,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 访问级别 |
|------|--------|----------|
| `listAgentRolesByMcp(params)` | 2103 | public |
| `createAgentRoleByMcp(params)` | 2127 | public |
| `updateAgentRoleByMcp(params)` | 2177 | public |
| `deleteAgentRoleByMcp(params)` | 2238 | public |
| `normalizeRoleMcpPayload(role)` | 2078 | private |

---

### 3.7 `builtin/memo-tool-handler.service.ts` — Memo/Memory Handler

**Constructor 依赖：**

```typescript
@Injectable()
export class MemoToolHandler {
  constructor(
    private memoService: MemoService,
    private memoWriteQueue: MemoWriteQueueService,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 访问级别 |
|------|--------|----------|
| `searchMemoMemory(params, agentId)` | 1460 | public |
| `appendMemoMemory(params, agentId, executionContext?)` | 1485 | public |
| `resolveMemoActorContext(executionContext?)` | 1581 | private |

**上下文辅助函数：** `resolveMeetingContext` 和 `assertExecutionContext` 原用于 Memo 和 Orchestration。建议：
- 将通用部分（`resolveMeetingContext`, `assertExecutionContext`）提取到 `tool-execution-context.util.ts` 或直接放入 `tool-execution-context.type.ts` 中作为工具函数
- 各 handler 按需 import

---

### 3.8 `builtin/communication-tool-handler.service.ts` — 通讯工具 Handler

**Constructor 依赖：**

```typescript
@Injectable()
export class CommunicationToolHandler {
  constructor(
    private composioService: ComposioService,
    private internalApiClient: InternalApiClient,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 访问级别 |
|------|--------|----------|
| `sendSlackMessage(params, agentId?)` | 2514 | public |
| `sendGmail(params, agentId?)` | 2533 | public |
| `sendInternalMessage(params, agentId?)` | 1734 | public |

---

### 3.9 `builtin/rd-intelligence-tool-handler.service.ts` — 研发智能 Handler

**Constructor 依赖：**

```typescript
@Injectable()
export class RdIntelligenceToolHandler {
  constructor(
    private internalApiClient: InternalApiClient,
  ) {}
}
```

**方法清单：**

| 方法 | 原行号 | 访问级别 |
|------|--------|----------|
| `runEngineeringStatistics(params)` | 1688 | public |
| `runDocsHeat(params)` | 1714 | public |

---

### 3.10 `tool.service.ts` — Facade（瘦身后）

**设计原则：** 保持所有现有 public 方法签名不变，内部委托给拆出的 service。外部模块（controller、其他 module）对 `ToolService` 的引用 **零改动**。

```typescript
@Injectable()
export class ToolService {
  constructor(
    private registry: ToolRegistryService,
    private execution: ToolExecutionService,
  ) {}

  // ── Registry 委托 ──
  async seedBuiltinTools(mode?: 'sync' | 'append') {
    return this.registry.seedBuiltinTools(mode);
  }
  async getAllTools() { return this.registry.getAllTools(); }
  async getAllToolsView() { return this.registry.getAllToolsView(); }
  async getToolkits(query?: any) { return this.registry.getToolkits(query); }
  async getToolkit(id: string) { return this.registry.getToolkit(id); }
  async getToolRegistry(query: any) { return this.registry.getToolRegistry(query); }
  async getTopKToolRoutes(query: any) { return this.registry.getTopKToolRoutes(query); }
  async getTool(toolId: string) { return this.registry.getTool(toolId); }
  async getToolView(toolId: string) { return this.registry.getToolView(toolId); }
  async getToolInputContract(toolId: string) { return this.registry.getToolInputContract(toolId); }
  async getToolsByIds(toolIds: string[]) { return this.registry.getToolsByIds(toolIds); }
  async createTool(data: any) { return this.registry.createTool(data); }
  async updateTool(toolId: string, updates: any) { return this.registry.updateTool(toolId, updates); }
  async deleteTool(toolId: string) { return this.registry.deleteTool(toolId); }
  async getToolExecutions(agentId?: string, toolId?: string) { return this.registry.getToolExecutions(agentId, toolId); }
  async getToolExecutionStats() { return this.registry.getToolExecutionStats(); }

  // ── Execution 委托 ──
  async executeTool(toolId: string, agentId: string, params: any, taskId?: string, ctx?: any) {
    return this.execution.executeTool(toolId, agentId, params, taskId, ctx);
  }
}
```

---

## 4. `tool.module.ts` 变更

```typescript
// 迁移后的 import 路径
import { OrchestrationToolHandler } from './builtin/orchestration-tool-handler.service';
import { RequirementToolHandler } from './builtin/requirement-tool-handler.service';
import { RepoToolHandler } from './builtin/repo-tool-handler.service';
// ... 其他已有 handler

// 新增 handler
import { AgentMasterToolHandler } from './builtin/agent-master-tool-handler.service';
import { AgentRoleToolHandler } from './builtin/agent-role-tool-handler.service';
import { MemoToolHandler } from './builtin/memo-tool-handler.service';
import { CommunicationToolHandler } from './builtin/communication-tool-handler.service';
import { RdIntelligenceToolHandler } from './builtin/rd-intelligence-tool-handler.service';

// 新增核心 service
import { ToolRegistryService } from './tool-registry.service';
import { ToolExecutionService } from './tool-execution.service';
import { ToolExecutionDispatcherService } from './tool-execution-dispatcher.service';

@Module({
  providers: [
    // ── 核心 ──
    ToolService,               // Facade
    ToolRegistryService,
    ToolExecutionService,
    ToolExecutionDispatcherService,
    ToolGovernanceService,

    // ── builtin handlers ──
    OrchestrationToolHandler,
    RequirementToolHandler,
    RepoToolHandler,
    ModelToolHandler,
    SkillToolHandler,
    AuditToolHandler,
    MeetingToolHandler,
    PromptRegistryToolHandler,
    WebToolsService,
    AgentMasterToolHandler,     // 新增
    AgentRoleToolHandler,       // 新增
    MemoToolHandler,            // 新增
    CommunicationToolHandler,   // 新增
    RdIntelligenceToolHandler,  // 新增

    // ── 基础设施 ──
    ComposioService,
    ExaService,
    InternalApiClient,
    AgentToolAuthService,
    AgentToolAuthGuard,
  ],
  exports: [
    ToolService,
    ToolRegistryService,        // 新增导出，供其他模块按需引用
    ToolExecutionService,       // 新增导出
    // ... 其他已有导出
  ],
})
export class ToolModule {}
```

---

## 5. 依赖关系图

```
┌─────────────────────────────────────────────────────────┐
│                     tool.controller.ts                   │
│                           │                              │
│                     ToolService (Facade)                 │
│                      ╱            ╲                      │
│          ToolRegistryService   ToolExecutionService      │
│               │                     │                    │
│     tool-identity.util.ts    ToolExecutionDispatcherService
│          (纯函数)                   │                    │
│                          ┌─────────┼──────────┐         │
│                          │         │          │          │
│                    builtin/    builtin/    builtin/      │
│                 (14 handlers)                            │
│                          │         │          │          │
│                    ┌─────┴─────┐   │   ┌──────┴──────┐  │
│                    │InternalApi│   │   │ComposioSvc  │  │
│                    │  Client   │   │   │MemoSvc ...  │  │
│                    └───────────┘   │   └─────────────┘  │
│                         ToolGovernanceService            │
└─────────────────────────────────────────────────────────┘
```

**循环依赖风险：** 无。

- `tool-identity.util.ts` 是纯函数，无 DI 依赖
- `ToolRegistryService` 不依赖 `ToolExecutionService`
- `ToolExecutionService` 依赖 `ToolRegistryService.getTool()` 和 `ToolExecutionDispatcherService`
- `ToolExecutionDispatcherService` 仅依赖各 builtin handler
- 各 builtin handler 仅依赖基础设施 service（InternalApiClient, ComposioService, MemoService 等），不反向依赖核心 service
- `ToolService`（Facade）依赖 `ToolRegistryService` + `ToolExecutionService`

---

## 6. `builtin/index.ts` barrel export

```typescript
// ── 已有 handler（迁移入）──
export { OrchestrationToolHandler } from './orchestration-tool-handler.service';
export { RequirementToolHandler } from './requirement-tool-handler.service';
export { RepoToolHandler } from './repo-tool-handler.service';
export { ModelToolHandler } from './model-tool-handler.service';
export { SkillToolHandler } from './skill-tool-handler.service';
export { AuditToolHandler } from './audit-tool-handler.service';
export { MeetingToolHandler } from './meeting-tool-handler.service';
export { PromptRegistryToolHandler } from './prompt-registry-tool-handler.service';
export { WebToolsService } from './web-tools.service';

// ── 新建 handler ──
export { AgentMasterToolHandler } from './agent-master-tool-handler.service';
export { AgentRoleToolHandler } from './agent-role-tool-handler.service';
export { MemoToolHandler } from './memo-tool-handler.service';
export { CommunicationToolHandler } from './communication-tool-handler.service';
export { RdIntelligenceToolHandler } from './rd-intelligence-tool-handler.service';
```

---

## 7. 测试策略

### 7.1 现有测试拆分

| 原测试文件 | 目标 |
|-----------|------|
| `tool.service.spec.ts`（30216 行） | 拆分为 `tool-registry.service.spec.ts`, `tool-execution.service.spec.ts`, `tool-execution-dispatcher.service.spec.ts`, `tool.service.spec.ts`（Facade 简单委托测试） |

### 7.2 新建测试

| 新 handler | 测试文件 |
|-----------|----------|
| `agent-master-tool-handler.service.ts` | `builtin/agent-master-tool-handler.service.spec.ts` |
| `agent-role-tool-handler.service.ts` | `builtin/agent-role-tool-handler.service.spec.ts` |
| `memo-tool-handler.service.ts` | `builtin/memo-tool-handler.service.spec.ts` |
| `communication-tool-handler.service.ts` | `builtin/communication-tool-handler.service.spec.ts` |
| `rd-intelligence-tool-handler.service.ts` | `builtin/rd-intelligence-tool-handler.service.spec.ts` |

### 7.3 迁移后的已有测试

| 原测试文件 | 处理方式 |
|-----------|----------|
| `meeting-tool-handler.service.spec.ts` | 迁移到 `builtin/` |
| `prompt-registry-tool-handler.service.spec.ts` | 迁移到 `builtin/` |
| `repo-tool-handler.service.spec.ts` | 迁移到 `builtin/` |

### 7.4 验证命令

```bash
# 每个 Phase 完成后执行
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run lint
npm run typecheck
npm run test -- --passWithNoTests
```

---

## 8. 关联文档

- 开发计划：`docs/plan/TOOL_SERVICE_SPLIT_BUILTIN_UNIFICATION_PLAN.md`
- 工具统一化架构：`docs/technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md`
- Tool ID 命名规范：`docs/technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md`
- 鉴权设计：`docs/technical/AGENT_TOOL_AUTH_JWT_CREDENTIAL_TECHNICAL_DESIGN.md`

---

## 9. 落地状态（2026-03-24）

- 已完成 `tool.service.ts` Facade 化（外部 API 保持兼容）。
- 已完成核心拆分：`tool-registry.service.ts`、`tool-execution.service.ts`、`tool-execution-dispatcher.service.ts`、`tool-identity.util.ts`。
- 已完成 builtin 目录统一：历史 handler 与 `web-tools.service.ts` 已迁入 `builtin/`。
- 已完成新增 handler：`agent-master`、`agent-role`、`memo`、`communication`、`rd-intelligence`。
- 已移除 `tool.service.ts` 中 10 个 legacy wrapper（由 dispatcher 直接委托对应 handler）。
- 已补齐/迁移测试：
  - 核心：`tool-registry.service.spec.ts`、`tool-execution.service.spec.ts`、`tool-execution-dispatcher.service.spec.ts`、`tool.service.spec.ts`（Facade）。
  - builtin：`agent-master/agent-role/memo/communication/rd-intelligence` 新增 spec；`meeting/prompt-registry/repo` 迁移到 `builtin/`。
