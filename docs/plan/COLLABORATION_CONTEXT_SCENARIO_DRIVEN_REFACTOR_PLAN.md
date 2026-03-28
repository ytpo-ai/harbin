# CollaborationContext 场景化重构 + JSON 输出强制策略 Plan

## 背景

### 问题来源
`docs/issue/TODO.md` — 优化系统提示词设计、注入时机和注入条件。

### 核心问题

1. **collaborationContext 在 planner 处理中未发挥场景约束作用**：当前 `collaborationContext` 类型为 `Record<string, unknown>`，各入口手动拼字段，无类型约束，字段名不统一（`mode` vs `collaborationMode`、`format: 'json'` 手动设置）。
2. **JSON 输出不稳定**：`[SYSTEM OVERRIDE] JSON-only` 指令散落在 3 个文件中重复注入，且完全依赖 prompt 工程——无 API 级别 `response_format` 支持。
3. **提示词冲突导致计划编排失败率高**：sourcePrompt 要求工具调用 + JSON-only 要求纯 JSON + 首步豁免要求生成任务——三条指令互相矛盾。

### 目标

以 `collaborationContext` 为核心载体，实现场景化的输出格式控制，覆盖 3 个业务场景：

| 场景 | 本质 | 默认输出格式 |
|------|------|-------------|
| **会议（Meeting）** | 沟通 + 执行简短任务 | text |
| **计划编排（Orchestration）** | 任务执行与合作，planner/executor 角色分化 | json-only |
| **内部消息（Inner Message）** | 直接触发 agent 执行操作 | json-only（可降级为 text） |

## 前置参考文档

- `docs/technical/SESSION_CONTEXT_ARCHITECTURE.MD` — 六层上下文模型，L4 Collaboration Context 设计
- `docs/technical/AGENTS_PROMPT_CONTEXT_CALLCHAIN.md` — Prompt 注入链路全景
- `docs/issue/fix/2026-03-28-planner-skill-injection-causes-confirmation-output.md` — 提示词措辞触发确认行为的教训
- `docs/issue/fix/2026-03-28-replan-requirementid-lost-in-planner-context.md` — JSON-only 与工具调用冲突问题
- `docs/issue/fix/2026-03-28-orchestration-plan-first-step-failure-investigation.md` — 首步失败五层根因

## 计划步骤

### 步骤 1：定义 CollaborationContext 类型系统

**目标**：将 `Record<string, unknown>` 替换为 discriminated union，用 `scenarioMode` 做判别字段。

**改动范围**：
- `backend/libs/contracts/src/` — 新增 `collaboration-context.types.ts`
- `backend/apps/agents/src/modules/agents/agent.types.ts` — `AgentContext.collaborationContext` 类型更新
- `backend/apps/agents/src/schemas/agent-session.schema.ts` — `collaborationContext` 类型更新
- `backend/apps/agents/src/modules/tools/tool-execution-context.type.ts` — 同步更新

**类型设计**：

```typescript
type ResponseDirective = 'json-only' | 'json-preferred' | 'text';
type ScenarioMode = 'meeting' | 'orchestration' | 'inner-message' | 'chat';

interface CollaborationContextBase {
  scenarioMode: ScenarioMode;
  responseDirective: ResponseDirective;
}

interface MeetingCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'meeting';
  meetingId: string;
  meetingTitle?: string;
  meetingDescription?: string;
  meetingType?: string;
  agenda?: string;
  participants?: Array<Record<string, unknown>>;
  participantProfiles?: Array<Record<string, unknown>>;
  commandPriority?: Record<string, unknown>;
}

interface OrchestrationCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'orchestration';
  responseDirective: 'json-only';
  planId: string;
  roleInPlan: 'planner' | 'executor' | 'planner_pre_execution' | 'planner_post_execution';
  agentTier?: string;
  collaborators?: Array<Record<string, unknown>>;
  delegationRules?: Record<string, unknown>;
  upstreamOutputs?: unknown;
  currentTaskId?: string;
  currentTaskTitle?: string;
  executorAgentId?: string;
  dependencies?: unknown;
  skillActivation?: { mode: 'standard' | 'precise' };
}

interface InnerMessageCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'inner-message';
  responseDirective: 'json-only' | 'text';
  messageId?: string;
  eventType?: string;
  triggerSource?: string;
  senderAgentId?: string;
  meetingId?: string; // 会议触发的内部消息场景
}

interface ChatCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'chat';
  responseDirective: 'text';
  initiator?: { id: string; name: string; type: string };
}

type CollaborationContext =
  | MeetingCollaborationContext
  | OrchestrationCollaborationContext
  | InnerMessageCollaborationContext
  | ChatCollaborationContext;
```

**向后兼容**：保留对旧格式 `{ format: 'json', mode: 'planning' }` 的运行时检测，在工厂函数中自动转换。

**影响点**：后端类型系统，无 API/前端影响。

---

### 步骤 2：实现 CollaborationContextFactory 工厂

**目标**：统一所有 `collaborationContext` 的构建入口，消除手动拼字段。

**改动范围**：
- `backend/apps/agents/src/modules/agents/context/` — 新增 `collaboration-context.factory.ts`
- `backend/src/modules/orchestration/planner.service.ts` — 4 处构建点改为调用工厂
- `backend/src/modules/orchestration/services/orchestration-context.service.ts` — `buildOrchestrationCollaborationContext()` 改为调用工厂
- `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` — `ensurePlannerSession()` 改为调用工厂
- `backend/src/modules/orchestration/services/plan-management.service.ts` — replan session 改为调用工厂
- `backend/src/modules/meetings/services/meeting-orchestration.service.ts` — `buildMeetingTeamContext()` 改为调用工厂
- `backend/apps/agents/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts` — `processMessage()` 改为调用工厂

**工厂接口设计**：

```typescript
class CollaborationContextFactory {
  static orchestration(params: {
    planId: string;
    roleInPlan: OrchestrationCollaborationContext['roleInPlan'];
    skillActivation?: { mode: 'standard' | 'precise' };
    // ... 其他可选字段
  }): OrchestrationCollaborationContext;

  static meeting(params: {
    meetingId: string;
    meetingTitle?: string;
    // ... 其他可选字段
  }): MeetingCollaborationContext;

  static innerMessage(params: {
    messageId?: string;
    eventType?: string;
    requireJsonResponse?: boolean; // true → json-only, false → text
    meetingId?: string; // 关联会议时设置
    // ... 其他可选字段
  }): InnerMessageCollaborationContext;

  static chat(params?: {
    initiator?: { id: string; name: string; type: string };
  }): ChatCollaborationContext;

  /** 向后兼容：将旧格式转换为新格式 */
  static fromLegacy(raw: Record<string, unknown>): CollaborationContext;
}
```

**关键规则**：
- `orchestration()` 自动设置 `responseDirective: 'json-only'`（planner 和 executor 均为 json-only）
- `meeting()` 自动设置 `responseDirective: 'text'`
- `innerMessage()` 根据 `requireJsonResponse` 参数设置，默认 `json-only`
- `chat()` 自动设置 `responseDirective: 'text'`

**影响点**：后端 orchestration/meeting/inner-message 各服务层。

---

### 步骤 3：LLM Provider 层支持 `response_format`

**目标**：在 API 级别强制 JSON 输出，与 prompt 层形成双重保障。

**改动范围**：
- `backend/libs/models/src/v1/base-provider.ts` — `options` 类型增加 `responseFormat`
- `backend/libs/models/src/v1/openai-provider.ts` — `chatWithMeta()` 和 `streamingChat()` 透传 `response_format`
- `backend/libs/models/src/v1/moonshot-provider.ts` — 同样支持（OpenAI 兼容接口）
- `backend/libs/models/src/aiv2-provider.ts` — `buildCallOptions()` 透传
- `backend/apps/agents/src/modules/models/model.service.ts` — `chat()` 和 `streamingChat()` 透传 `responseFormat`
- `backend/apps/agents/src/modules/agents/agent-executor.service.ts` — 从 `collaborationContext.responseDirective` 推导 `responseFormat`
- `backend/apps/agents/src/modules/agents/executor-engines/native-streaming-agent-executor.engine.ts` — 透传

**responseDirective → response_format 映射**：

| responseDirective | prompt 层注入 | API response_format | 说明 |
|---|---|---|---|
| `json-only` | 注入 JSON-ONLY 声明 | `{ type: 'json_object' }`（OpenAI 兼容模型） | 双重保障 |
| `json-preferred` | 注入"优先 JSON"提示 | 不设置 | 允许降级到文本 |
| `text` | 不注入 | 不设置 | 正常文本输出 |

**模型兼容性处理**：
- OpenAI 系列（含 Moonshot/Kimi 等 OpenAI 兼容接口）：支持 `response_format: { type: 'json_object' }`
- Anthropic：不支持 `response_format`，仅依赖 prompt 层
- Google Gemini：支持 `responseMimeType: 'application/json'`，通过 Vercel AI SDK `providerOptions` 透传
- Alibaba/Qwen：OpenAI 兼容接口，支持 `response_format`

**影响点**：`@libs/models` 库、agents app 的 executor 层。

---

### 步骤 4：统一 JSON 注入点，清除散落的 `[SYSTEM OVERRIDE]`

**目标**：将 JSON 格式约束的 prompt 注入收敛到 `collaboration-context.builder.ts` 单一入口。

**需移除的重复注入点**：

| 文件 | 位置 | 当前内容 | 处理方式 |
|---|---|---|---|
| `orchestration-context.service.ts` | `buildPreTaskContext()` L235-252 | `[SYSTEM OVERRIDE] 你当前处于 Planner JSON-only 模式` | 移除 JSON 格式约束部分，保留业务逻辑（pre-task 决策 schema） |
| `orchestration-context.service.ts` | `buildPostTaskContext()` L300-316 | `[SYSTEM OVERRIDE] 你当前处于 Planner JSON-only 模式` | 同上 |
| `planner.service.ts` | `buildIncrementalPlannerPrompt()` L478-486 | `[SYSTEM OVERRIDE]` + JSON schema | 移除 JSON 格式约束前缀，保留 JSON schema 定义作为业务规范 |
| `planner.service.ts` | `buildIncrementalPlannerPrompt()` L502 | `[SYSTEM OVERRIDE — 首步豁免]` | 保留首步豁免逻辑，但措辞从 SYSTEM OVERRIDE 改为中性声明 |

**统一注入点（collaboration-context.builder.ts）重写**：

当 `responseDirective === 'json-only'` 时，在 orchestration/inner-message 分支注入：
```
[输出格式约束] 当前为结构化 JSON 输出模式。
回复必须是合法 JSON 对象，以 { 开头 } 结尾。
非 JSON 内容将被系统丢弃。
```

**措辞原则**（来自 fix 文档教训）：
- 声明式 > 命令式：说"当前为 X 模式"而非"你必须做 X"
- 中性 > 强势：避免 `[SYSTEM OVERRIDE]`、`强制`、`严格遵循` 等触发确认行为的措辞
- 精简 > 冗长：3 行以内，减少 system message 对 JSON 合规性的干扰

**影响点**：orchestration 服务层的 prompt 构建、agents app 的 collaboration builder。

---

### 步骤 5：场景推导逻辑重构

**目标**：`scenarioType` 直接从 `collaborationContext.scenarioMode` 读取，不再靠字段存在性猜测。

**改动范围**：
- `backend/apps/agents/src/modules/agents/agent-executor.service.ts` L1737-1742 — scenarioType 推导逻辑
- `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts` — 新增 inner-message 分支
- `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts` L20-28 — `isMeetingLikeTask()` 补充 collaborationContext 检查
- `backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts` — `ScenarioType` 扩展为 4 值

**scenarioType 推导规则**：
```typescript
function resolveScenarioType(collaborationContext?: CollaborationContext): ScenarioType {
  // 优先从显式 scenarioMode 读取
  if (collaborationContext?.scenarioMode) {
    return collaborationContext.scenarioMode === 'inner-message'
      ? 'inner-message'
      : collaborationContext.scenarioMode;
  }
  // 向后兼容：从字段存在性推导
  if (collaborationContext?.meetingId) return 'meeting';
  if (collaborationContext?.planId) return 'orchestration';
  return 'chat';
}
```

**collaboration-context.builder.ts 四分支重构**：
- `meeting`：保持现有会议 prompt 构建
- `orchestration`：保持现有编排 prompt 构建 + responseDirective 驱动的 JSON 约束
- `inner-message`（新增）：注入消息上下文 + 根据 responseDirective 决定是否追加 JSON 约束
- `chat`：保持现有 raw dump

**影响点**：agents app 的 executor、context builders。

---

## 影响矩阵

| 影响领域 | 涉及文件 | 风险等级 |
|---------|---------|---------|
| 类型系统 | `@libs/contracts` 新增类型 | 低 — 纯新增 |
| LLM Provider | `openai-provider.ts`, `aiv2-provider.ts`, `moonshot-provider.ts` | 中 — 需验证各模型兼容性 |
| Orchestration 服务 | `planner.service.ts`, `orchestration-context.service.ts`, `step-dispatcher.service.ts`, `plan-management.service.ts` | 中 — 核心链路 |
| Meeting 服务 | `meeting-orchestration.service.ts` | 低 — 仅构建入口改为工厂 |
| Inner Message | `inner-message-agent-runtime-bridge.service.ts` | 低 — 新增工厂调用 |
| Context Builder | `collaboration-context.builder.ts`, `context-block-builder.interface.ts` | 中 — 核心 prompt 注入点 |
| Agent Executor | `agent-executor.service.ts`, `native-streaming-agent-executor.engine.ts` | 中 — 透传 responseFormat |
| 前端 | 无 | 无 |
| 数据库 Schema | `agent-session.schema.ts` — 类型更新，无结构变更 | 低 |

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| `response_format: json_object` 与工具调用冲突 | OpenAI API 实际支持同时使用；若特定模型冲突，executor 层检测到 tool_calls 时临时降级为 prompt-only |
| 非 OpenAI 模型不支持 `response_format` | Provider 层做模型能力检测，不支持的模型仅用 prompt 层约束 |
| 旧格式 `{ format: 'json', mode: 'planning' }` 兼容 | `CollaborationContextFactory.fromLegacy()` 自动转换 + 3 个月过渡期后清理 |
| 内部消息某些场景需要文本输出 | 工厂函数提供 `requireJsonResponse: false` 开关，支持灵活切换 |
| 措辞变更影响 LLM 行为 | 按 TODO.md 约束，通过构造 LLM Context 直接测试提示词效果后再上线 |

## 验证策略

参考 `docs/guide/TEST_GUIDELINE.MD`，按以下优先级验证：

1. **计划编排首步生成**：创建新计划 → 首步应稳定输出 JSON 任务
2. **Planner pre/post 决策**：步骤完成后 → planner 应稳定输出 JSON 决策
3. **Executor 任务执行**：executor 接到任务 → 应稳定输出 JSON 结果
4. **内部消息触发**：发送内部消息 → agent 应返回结构化结果
5. **会议场景**：会议中 agent 响应 → 应为自然语言文本，不受 JSON 约束干扰
6. **向后兼容**：旧格式 collaborationContext 应被自动转换，不影响现有流程

## 执行建议

- 步骤 1 → 2 可并行（类型定义 + 工厂函数互为配套）
- 步骤 3 独立完成后可立即用构造 LLM Context 的方式验证 API 级别 JSON 强制效果
- 步骤 4 → 5 顺序执行（先统一注入点，再改推导逻辑）
- 每步完成后进行单步验证，不要批量提交
