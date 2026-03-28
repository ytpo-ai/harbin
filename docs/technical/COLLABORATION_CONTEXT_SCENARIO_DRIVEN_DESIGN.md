# CollaborationContext 场景化重构 + JSON 输出强制 — 技术设计文档

## 1. 概述

本文档是 `COLLABORATION_CONTEXT_SCENARIO_DRIVEN_REFACTOR_PLAN` 的配套技术设计，定义完整的类型系统、数据流、API 改动和代码改动索引。

**关联文档**：
- Plan: `docs/plan/COLLABORATION_CONTEXT_SCENARIO_DRIVEN_REFACTOR_PLAN.md`
- 现有架构: `docs/technical/SESSION_CONTEXT_ARCHITECTURE.MD`（六层上下文模型 L4）
- Prompt 链路: `docs/technical/AGENTS_PROMPT_CONTEXT_CALLCHAIN.md`

## 2. 当前架构问题分析

### 2.1 collaborationContext 全链路数据流（现状）

```
[7 个构建点]                         [传输]                              [消费]
                                                                    
planner.service.ts                  agentClientService               agent-executor.service.ts
 ├ generateNextTask()     ─┐         .executeTask()                   ├ scenarioType 推导
 ├ executePreTask()        │           │                              │  meetingId → 'meeting'
 ├ executePostTask()       │           │                              │  planId → 'orchestration'
 └ planByAgent()           │           │                              │  else → 'chat'
                           │           ▼                              │
orchestration-context.svc  ├──→  agent-task.worker.ts         collaboration-context.builder.ts
 buildOrchCollabCtx() ─────┤     (嵌套包装问题)                  ├ meeting 分支 (prompt)
                           │           │                         ├ orchestration 分支
step-dispatcher.svc        │           ▼                         │  + format=json → JSON-ONLY
 ensurePlannerSession() ───┤     runtime-persistence.svc         └ chat 分支 (raw dump)
                           │     ensureSession()                       │
plan-management.svc        │     getOrCreatePlanSession()              ▼
 replan session ───────────┤           │                         LLM (system messages)
                           │           ▼
meeting-orchestration.svc  │     AgentSession (MongoDB)
 buildMeetingTeamCtx() ────┤     { collaborationContext: Record<string, unknown> }
                           │
inner-message bridge       │     另外消费:
 resolveTeamContext() ─────┘     - ContextFingerprintService (scope key)
                                 - ContextStrategyService (skillActivation)
                                 - Tool handlers (meetingId, actor 提取)
                                 - AgentExecutorRuntimeService (metadata)
                                 - AgentActionLogService (审计, 2层嵌套读取)
```

### 2.2 已识别的 10 个 Gap

| # | Gap | 严重度 | 本次是否修复 |
|---|-----|--------|-------------|
| 1 | 无正式 TypeScript 类型，全部 `Record<string, unknown>` | 高 | **是** |
| 2 | `isMeetingLikeTask()` 不检查 `collaborationContext` | 中 | **是** |
| 3 | Inner message bridge 设置的 collaborationContext 几乎为空 | 高 | **是** |
| 4 | agent-task.worker 产生嵌套 `collaborationContext.collaborationContext` | 中 | 否（独立修复） |
| 5 | Task execution agents 无 `format: 'json'` 传播 | 高 | **是** |
| 6 | 无 `response_format` API 级别强制 | 高 | **是** |
| 7 | `collaborationMode` vs `mode` 字段名不一致 | 中 | **是** |
| 8 | Step dispatcher 创建 session 时缺 `format: 'json'` | 中 | **是** |
| 9 | Chat 场景 raw JSON dump 无过滤 | 低 | 否（低优先级） |
| 10 | orchestration-tool-handler 仍读 `organizationId` | 低 | 否（独立清理） |

## 3. 类型系统设计

### 3.1 新增类型文件

**文件位置**: `backend/libs/contracts/src/collaboration-context.types.ts`

```typescript
// ============================================================
// ResponseDirective — 控制 LLM 输出格式
// ============================================================

/**
 * 响应格式指令。
 * - 'json-only': 强制 JSON 输出（prompt + API response_format 双重保障）
 * - 'json-preferred': JSON 优先，允许降级到文本（仅 prompt 层提示，不设 API 参数）
 * - 'text': 正常文本输出，不注入任何格式约束
 */
export type ResponseDirective = 'json-only' | 'json-preferred' | 'text';

// ============================================================
// ScenarioMode — 业务场景标识
// ============================================================

/**
 * 场景模式。决定 collaborationContext 的形态和默认 responseDirective。
 */
export type ScenarioMode = 'meeting' | 'orchestration' | 'inner-message' | 'chat';

// ============================================================
// CollaborationContext — Discriminated Union
// ============================================================

/** 基础字段，所有场景共享 */
export interface CollaborationContextBase {
  /** 场景标识（discriminant field） */
  scenarioMode: ScenarioMode;
  /** 输出格式指令 */
  responseDirective: ResponseDirective;
}

/** 会议场景 */
export interface MeetingCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'meeting';
  // responseDirective 默认 'text'，允许覆写

  // --- 会议核心字段 ---
  meetingId: string;
  meetingTitle?: string;
  meetingDescription?: string;
  meetingType?: string;
  agenda?: string;
  participants?: Array<{
    id: string;
    name?: string;
    type?: 'employee' | 'agent';
    role?: 'host' | 'participant';
  }>;
  participantProfiles?: Array<Record<string, unknown>>;

  // --- 指令优先级 ---
  commandPriority?: {
    highestAuthority: string;
    exclusiveAssistantOverride: boolean;
  };

  // --- 会议协作模式标记 ---
  collaborationMode?: 'meeting';
  initiatorId?: string;
}

/** 编排场景（Planner + Executor） */
export interface OrchestrationCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'orchestration';
  responseDirective: 'json-only'; // 编排场景强制 json-only

  // --- 编排核心字段 ---
  planId: string;
  roleInPlan: 'planner' | 'executor' | 'planner_pre_execution' | 'planner_post_execution';

  // --- 团队协作信息 ---
  agentTier?: 'leadership' | 'operations' | 'temporary';
  collaborators?: Array<{
    agentId: string;
    name?: string;
    tier?: string;
    roleInPlan?: string;
    relationship?: 'upstream' | 'downstream' | 'parallel';
  }>;
  delegationRules?: {
    canDelegateTo?: string[];
    cannotDelegateTo?: string[];
  };

  // --- 任务执行上下文 ---
  currentTaskId?: string;
  currentTaskTitle?: string;
  executorAgentId?: string;
  dependencies?: unknown;
  upstreamOutputs?: unknown;

  // --- 技能激活策略 ---
  skillActivation?: { mode: 'standard' | 'precise' };

  // --- 向后兼容（过渡期保留，3个月后清理） ---
  /** @deprecated 使用 responseDirective 替代 */
  format?: 'json';
  /** @deprecated 使用 scenarioMode 替代 */
  mode?: 'planning' | 'orchestration';
}

/** 内部消息场景 */
export interface InnerMessageCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'inner-message';
  responseDirective: 'json-only' | 'text'; // 默认 json-only，可按需设为 text

  // --- 消息元数据 ---
  messageId?: string;
  eventType?: string;
  senderAgentId?: string;
  triggerSource?: string;

  // --- 可选关联 ---
  meetingId?: string;        // 会议触发的内部消息
  planId?: string;           // 编排触发的内部消息
  scheduleId?: string;       // 定时任务触发

  // --- 执行上下文 ---
  runtimeTaskType?: 'internal_message' | 'scheduled_task';
}

/** 聊天场景 */
export interface ChatCollaborationContext extends CollaborationContextBase {
  scenarioMode: 'chat';
  responseDirective: 'text';

  // --- 发起人信息 ---
  initiator?: {
    id: string;
    name: string;
    type: 'employee' | 'agent';
  };
}

/** Discriminated Union */
export type CollaborationContext =
  | MeetingCollaborationContext
  | OrchestrationCollaborationContext
  | InnerMessageCollaborationContext
  | ChatCollaborationContext;

// ============================================================
// Type Guards
// ============================================================

export function isMeetingContext(ctx: CollaborationContext): ctx is MeetingCollaborationContext {
  return ctx.scenarioMode === 'meeting';
}

export function isOrchestrationContext(ctx: CollaborationContext): ctx is OrchestrationCollaborationContext {
  return ctx.scenarioMode === 'orchestration';
}

export function isInnerMessageContext(ctx: CollaborationContext): ctx is InnerMessageCollaborationContext {
  return ctx.scenarioMode === 'inner-message';
}

export function isChatContext(ctx: CollaborationContext): ctx is ChatCollaborationContext {
  return ctx.scenarioMode === 'chat';
}

export function isJsonOutputRequired(ctx: CollaborationContext): boolean {
  return ctx.responseDirective === 'json-only';
}
```

### 3.2 ScenarioType 扩展

**文件**: `backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts`

```typescript
// 现有:
export type ScenarioType = 'orchestration' | 'meeting' | 'chat';

// 改为:
export type ScenarioType = 'orchestration' | 'meeting' | 'inner-message' | 'chat';
```

### 3.3 AgentContext 类型更新

**文件**: `backend/apps/agents/src/modules/agents/agent.types.ts`

```typescript
// 现有:
export interface AgentContext {
  collaborationContext?: Record<string, unknown>;
  // ...
}

// 改为:
import { CollaborationContext } from '@libs/contracts';

export interface AgentContext {
  collaborationContext?: CollaborationContext | Record<string, unknown>; // union 确保向后兼容
  // ...
}
```

## 4. CollaborationContextFactory 设计

**文件位置**: `backend/libs/contracts/src/collaboration-context.factory.ts`

> 放在 `@libs/contracts` 中，因为 backend 主应用和 agents app 都需要调用。

### 4.1 核心实现

```typescript
import {
  CollaborationContext,
  MeetingCollaborationContext,
  OrchestrationCollaborationContext,
  InnerMessageCollaborationContext,
  ChatCollaborationContext,
  ResponseDirective,
} from './collaboration-context.types';

export class CollaborationContextFactory {

  static orchestration(params: {
    planId: string;
    roleInPlan: OrchestrationCollaborationContext['roleInPlan'];
    skillActivation?: { mode: 'standard' | 'precise' };
    agentTier?: string;
    collaborators?: OrchestrationCollaborationContext['collaborators'];
    delegationRules?: OrchestrationCollaborationContext['delegationRules'];
    currentTaskId?: string;
    currentTaskTitle?: string;
    executorAgentId?: string;
    dependencies?: unknown;
    upstreamOutputs?: unknown;
  }): OrchestrationCollaborationContext {
    return {
      scenarioMode: 'orchestration',
      responseDirective: 'json-only',
      ...params,
    };
  }

  static meeting(params: {
    meetingId: string;
    meetingTitle?: string;
    meetingDescription?: string;
    meetingType?: string;
    agenda?: string;
    participants?: MeetingCollaborationContext['participants'];
    participantProfiles?: MeetingCollaborationContext['participantProfiles'];
    commandPriority?: MeetingCollaborationContext['commandPriority'];
    initiatorId?: string;
    responseDirective?: ResponseDirective; // 允许覆写，默认 'text'
  }): MeetingCollaborationContext {
    const { responseDirective = 'text', ...rest } = params;
    return {
      scenarioMode: 'meeting',
      responseDirective,
      collaborationMode: 'meeting',
      ...rest,
    };
  }

  static innerMessage(params: {
    messageId?: string;
    eventType?: string;
    senderAgentId?: string;
    triggerSource?: string;
    meetingId?: string;
    planId?: string;
    scheduleId?: string;
    runtimeTaskType?: 'internal_message' | 'scheduled_task';
    requireJsonResponse?: boolean; // 默认 true → json-only
  }): InnerMessageCollaborationContext {
    const { requireJsonResponse = true, ...rest } = params;
    return {
      scenarioMode: 'inner-message',
      responseDirective: requireJsonResponse ? 'json-only' : 'text',
      ...rest,
    };
  }

  static chat(params?: {
    initiator?: ChatCollaborationContext['initiator'];
  }): ChatCollaborationContext {
    return {
      scenarioMode: 'chat',
      responseDirective: 'text',
      ...(params || {}),
    };
  }

  /**
   * 向后兼容：将旧格式 Record<string, unknown> 转换为新类型。
   * 检测策略：有 scenarioMode → 已是新格式；无 scenarioMode → 根据字段推导。
   */
  static fromLegacy(raw: Record<string, unknown>): CollaborationContext {
    // 已经是新格式
    if (raw.scenarioMode && typeof raw.scenarioMode === 'string') {
      return raw as unknown as CollaborationContext;
    }

    // 会议场景：有 meetingId + (collaborationMode === 'meeting' 或 meetingTitle 存在)
    if (raw.meetingId && (raw.collaborationMode === 'meeting' || raw.meetingTitle)) {
      return {
        scenarioMode: 'meeting',
        responseDirective: 'text',
        ...raw,
      } as MeetingCollaborationContext;
    }

    // 编排场景：有 planId
    if (raw.planId) {
      const roleInPlan = String(raw.roleInPlan || 'executor');
      return {
        scenarioMode: 'orchestration',
        responseDirective: 'json-only',
        planId: String(raw.planId),
        roleInPlan: roleInPlan as OrchestrationCollaborationContext['roleInPlan'],
        ...raw,
      } as OrchestrationCollaborationContext;
    }

    // 默认 chat
    return {
      scenarioMode: 'chat',
      responseDirective: 'text',
      ...raw,
    } as ChatCollaborationContext;
  }
}
```

### 4.2 调用改造点（7 处）

| # | 文件 | 函数/位置 | 现有构建方式 | 改为 |
|---|------|----------|-------------|------|
| 1 | `planner.service.ts` L169 | `generateNextTask()` | `{ planId, mode:'planning', format:'json', roleInPlan:'planner', skillActivation? }` | `CollaborationContextFactory.orchestration({ planId, roleInPlan:'planner', skillActivation })` |
| 2 | `planner.service.ts` L259 | `executePreTask()` | `{ planId, mode:'planning', format:'json', roleInPlan:'planner_pre_execution', skillActivation? }` | `CollaborationContextFactory.orchestration({ planId, roleInPlan:'planner_pre_execution', skillActivation })` |
| 3 | `planner.service.ts` L314 | `executePostTask()` | `{ planId, mode:'planning', format:'json', roleInPlan:'planner_post_execution', skillActivation? }` | `CollaborationContextFactory.orchestration({ planId, roleInPlan:'planner_post_execution', skillActivation })` |
| 4 | `orchestration-context.service.ts` L319 | `buildOrchestrationCollaborationContext()` | `{ mode:'orchestration', roleInPlan:'execute_assigned_task', currentTaskId, ... }` | `CollaborationContextFactory.orchestration({ planId, roleInPlan:'executor', currentTaskId, ... })` |
| 5 | `orchestration-step-dispatcher.service.ts` L553 | `ensurePlannerSession()` | `{ mode:'planning', roleInPlan:'planner', planId, skillActivation? }` | `CollaborationContextFactory.orchestration({ planId, roleInPlan:'planner', skillActivation })` |
| 6 | `meeting-orchestration.service.ts` L80 | `buildMeetingTeamContext()` | `{ meetingId, initiatorId, meetingType, collaborationMode:'meeting', ... }` | `CollaborationContextFactory.meeting({ meetingId, meetingTitle, ... })` |
| 7 | `inner-message-agent-runtime-bridge.service.ts` L63 | `processMessage()` | `{ ...(resolveTeamContext(payload) \|\| {}) }` → 几乎为空 | `CollaborationContextFactory.innerMessage({ messageId, eventType, senderAgentId, ... })` |

## 5. LLM Provider 层 response_format 支持

### 5.1 Options 类型扩展

**文件**: `backend/libs/models/src/v1/base-provider.ts`

```typescript
// 新增 options 类型定义（当前为 any）
export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** 输出格式控制。仅 OpenAI 兼容接口支持。 */
  responseFormat?: { type: 'json_object' | 'text' };
}
```

### 5.2 OpenAI Provider 改造

**文件**: `backend/libs/models/src/v1/openai-provider.ts`

```typescript
// chatWithMeta() — L72-79 改为:
async chatWithMeta(messages: ChatMessage[], options?: LLMCallOptions): Promise<ProviderChatResult> {
  const response = await this.client.chat.completions.create({
    model: this.model.model,
    messages: this.formatMessages(messages),
    ...this.buildTokenLimitParams(options),
    temperature: options?.temperature || this.model.temperature || 0.7,
    top_p: options?.topP || this.model.topP || 1,
    ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
  });
  // ... 其余不变
}

// streamingChat() — L113-120 同理追加 response_format
```

### 5.3 AIV2 Provider 改造

**文件**: `backend/libs/models/src/aiv2-provider.ts`

```typescript
// buildCallOptions() — L119-140 扩展:
private buildCallOptions(options?: LLMCallOptions): Record<string, any> {
  // ... 现有逻辑 ...

  // response_format 支持
  const responseFormat = options?.responseFormat;
  if (responseFormat?.type === 'json_object') {
    // OpenAI 兼容: 直接传 response_format
    // Anthropic: 不支持, 跳过
    // Google: 通过 providerOptions 传 responseMimeType
    if (this.providerName === 'openai' || this.providerName === 'moonshot' || this.providerName === 'kimi'
        || this.providerName === 'alibaba' || this.providerName === 'qwen') {
      result.responseFormat = responseFormat; // Vercel AI SDK 会透传
    }
    if (this.providerName === 'google') {
      result.providerOptions = {
        ...result.providerOptions,
        google: { responseMimeType: 'application/json' },
      };
    }
    // anthropic: 不支持 response_format, 仅依赖 prompt 层
  }

  return result;
}
```

### 5.4 ModelService 透传

**文件**: `backend/apps/agents/src/modules/models/model.service.ts`

```typescript
// chat() 和 streamingChat() 的 options 参数已是 any，直接透传即可。
// 无需改动接口，只需确保调用方传入 responseFormat。
```

### 5.5 Agent Executor 推导 responseFormat

**文件**: `backend/apps/agents/src/modules/agents/agent-executor.service.ts`

在 `executeWithToolCalling` 调用 `modelService.chat()` 处：

```typescript
// L1176-1179 改为:
const responseFormat = this.resolveResponseFormat(agentContext.collaborationContext);

const modelResult = await this.modelService.chat(modelConfig.id, messages, {
  temperature: modelConfig.temperature,
  maxTokens: modelConfig.maxTokens,
  ...(responseFormat ? { responseFormat } : {}),
});

// 新增私有方法:
private resolveResponseFormat(
  collaborationContext?: CollaborationContext | Record<string, unknown>,
): { type: 'json_object' | 'text' } | undefined {
  if (!collaborationContext) return undefined;

  // 新格式
  if ('responseDirective' in collaborationContext) {
    const directive = (collaborationContext as CollaborationContext).responseDirective;
    if (directive === 'json-only') {
      return { type: 'json_object' };
    }
    return undefined; // json-preferred 和 text 不设 API 参数
  }

  // 旧格式兼容
  if (String((collaborationContext as any).format || '').trim() === 'json') {
    return { type: 'json_object' };
  }

  return undefined;
}
```

同样的逻辑需要在 `NativeStreamingAgentExecutorEngine.streamOnce()` 中透传。

### 5.6 模型兼容性矩阵

| Provider | 支持 response_format | 传递方式 | 不支持时的 fallback |
|----------|---------------------|---------|-------------------|
| OpenAI | 是（GPT-4o, GPT-4-turbo, GPT-3.5-turbo, GPT-5） | `response_format: { type: 'json_object' }` | N/A |
| Moonshot/Kimi | 是（OpenAI 兼容） | 同 OpenAI | N/A |
| Alibaba/Qwen | 是（OpenAI 兼容） | 同 OpenAI | N/A |
| Anthropic | 否 | 跳过 | 仅 prompt 层 |
| Google Gemini | 部分支持 | `responseMimeType: 'application/json'` via providerOptions | 仅 prompt 层 |
| DeepSeek | 是（OpenAI 兼容） | 同 OpenAI | N/A |

**o1/o3/o4 推理模型注意**：这些模型不支持 `response_format`，在 `resolveResponseFormat()` 中需检测 `isReasoningModel` 并跳过。

## 6. Prompt 注入统一方案

### 6.1 统一注入点

**唯一注入文件**: `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts`

### 6.2 JSON 约束注入措辞

```typescript
// json-only 模式注入（声明式、中性、精简）
const JSON_ONLY_DIRECTIVE = [
  '[输出格式约束] 当前为结构化 JSON 输出模式。',
  '回复必须是合法 JSON 对象，以 { 开头 } 结尾。',
  '非 JSON 内容将被系统丢弃。',
].join('\n');

// json-preferred 模式注入
const JSON_PREFERRED_DIRECTIVE = [
  '[输出格式偏好] 优先以 JSON 对象格式回复。',
  '如确需自然语言说明，可在 JSON 的 "message" 字段中附加。',
].join('\n');
```

### 6.3 需移除的冗余注入

| 文件 | 位置 | 移除的内容 | 保留的内容 |
|------|------|-----------|-----------|
| `orchestration-context.service.ts` | `buildPreTaskContext()` L235-252 | `[SYSTEM OVERRIDE] 你当前处于 Planner JSON-only 模式。...` | pre-task 决策 JSON schema 定义 |
| `orchestration-context.service.ts` | `buildPostTaskContext()` L300-316 | `[SYSTEM OVERRIDE] 你当前处于 Planner JSON-only 模式。...` | post-task 决策 JSON schema 定义 |
| `planner.service.ts` | `buildIncrementalPlannerPrompt()` L478-486 | `[SYSTEM OVERRIDE]` 前缀 + JSON 格式约束声明 | JSON schema 定义（作为业务规范而非格式约束） |
| `collaboration-context.builder.ts` | orchestration 分支 L79-88 | 现有 `[JSON-ONLY MODE]` 指令 | 替换为新的 `JSON_ONLY_DIRECTIVE`（根据 responseDirective） |

### 6.4 collaboration-context.builder.ts 四分支重构

```typescript
async build(input: ContextBuildInput): Promise<ChatMessage[]> {
  const ctx = this.resolveContext(input);
  if (!ctx) return [];

  // 优先用 scenarioMode，向后兼容用 scenarioType
  const scenario = ctx.scenarioMode || input.scenarioType;

  switch (scenario) {
    case 'meeting':
      return this.buildMeetingBlock(input, ctx);

    case 'orchestration':
      return this.buildOrchestrationBlock(input, ctx);

    case 'inner-message':
      return this.buildInnerMessageBlock(input, ctx);

    case 'chat':
    default:
      return this.buildChatBlock(input, ctx);
  }
}

private buildOrchestrationBlock(input, ctx): ChatMessage[] {
  const contentParts: string[] = [
    `协作上下文(编排): ${JSON.stringify({
      agentTier: ctx.agentTier || 'operations',
      roleInPlan: ctx.roleInPlan || 'execute_assigned_task',
      collaborators: ctx.collaborators || [],
      delegationRules: ctx.delegationRules || { ... },
      upstreamOutputs: ctx.upstreamOutputs || '',
    })}`,
  ];

  // 根据 responseDirective 注入格式约束
  if (ctx.responseDirective === 'json-only') {
    contentParts.push(JSON_ONLY_DIRECTIVE);
  } else if (ctx.responseDirective === 'json-preferred') {
    contentParts.push(JSON_PREFERRED_DIRECTIVE);
  }
  // text: 不注入

  // ... fingerprint 逻辑 ...
  return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
}

private buildInnerMessageBlock(input, ctx): ChatMessage[] {
  const contentParts: string[] = [
    `协作上下文(内部消息): ${JSON.stringify({
      eventType: ctx.eventType,
      triggerSource: ctx.triggerSource,
      senderAgentId: ctx.senderAgentId,
    })}`,
  ];

  if (ctx.responseDirective === 'json-only') {
    contentParts.push(JSON_ONLY_DIRECTIVE);
  }

  // ... fingerprint 逻辑 ...
  return [{ role: 'system', content: resolvedContent, timestamp: new Date() }];
}
```

## 7. 场景推导逻辑

### 7.1 核心推导函数

**文件**: `backend/apps/agents/src/modules/agents/agent-executor.service.ts`

```typescript
/**
 * 从 collaborationContext 推导场景类型。
 * 优先级：显式 scenarioMode > 字段存在性推导 > 默认 chat
 */
private resolveScenarioType(
  collaborationContext?: CollaborationContext | Record<string, unknown>,
  task?: Task,
): ScenarioType {
  // 1. 优先从显式 scenarioMode 读取（新格式）
  if (collaborationContext && 'scenarioMode' in collaborationContext) {
    const mode = (collaborationContext as CollaborationContext).scenarioMode;
    if (['meeting', 'orchestration', 'inner-message', 'chat'].includes(mode)) {
      return mode as ScenarioType;
    }
  }

  // 2. 向后兼容：从字段存在性推导
  const ctx = collaborationContext as Record<string, unknown> | undefined;
  if (ctx?.meetingId) return 'meeting';
  if (ctx?.planId) return 'orchestration';

  // 3. 从 task.type 推导
  if (task?.type === 'internal_message') return 'inner-message';

  return 'chat';
}
```

### 7.2 isMeetingLikeTask 修复

**文件**: `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts`

```typescript
// 现有 (L20-28):
export function isMeetingLikeTask(task, context): boolean {
  return task?.type === 'meeting' || context?.taskType === 'meeting';
}

// 改为:
export function isMeetingLikeTask(task, context): boolean {
  if (task?.type === 'meeting' || context?.taskType === 'meeting') return true;
  // 补充 collaborationContext 检查
  const cc = context?.collaborationContext;
  if (cc?.scenarioMode === 'meeting') return true;
  if (cc?.meetingId && cc?.collaborationMode === 'meeting') return true; // 旧格式兼容
  return false;
}
```

## 8. 完整改动文件索引

### 8.1 新增文件

| 文件 | 说明 |
|------|------|
| `backend/libs/contracts/src/collaboration-context.types.ts` | 类型定义 + type guards |
| `backend/libs/contracts/src/collaboration-context.factory.ts` | 工厂函数 |

### 8.2 修改文件

| 文件 | 改动说明 |
|------|---------|
| **类型层** | |
| `backend/libs/contracts/src/index.ts` | 导出新类型 |
| `backend/apps/agents/src/modules/agents/agent.types.ts` | `collaborationContext` 类型更新 |
| `backend/apps/agents/src/schemas/agent-session.schema.ts` | `collaborationContext` 类型更新 |
| `backend/apps/agents/src/modules/tools/tool-execution-context.type.ts` | `collaborationContext` 类型更新 |
| `backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts` | `ScenarioType` 扩展为 4 值 |
| **LLM Provider 层** | |
| `backend/libs/models/src/v1/base-provider.ts` | 新增 `LLMCallOptions` 接口 |
| `backend/libs/models/src/v1/openai-provider.ts` | `chatWithMeta()` / `streamingChat()` 透传 `response_format` |
| `backend/libs/models/src/v1/moonshot-provider.ts` | 同 OpenAI |
| `backend/libs/models/src/aiv2-provider.ts` | `buildCallOptions()` 支持 `responseFormat` |
| **Executor 层** | |
| `backend/apps/agents/src/modules/agents/agent-executor.service.ts` | 新增 `resolveResponseFormat()` + `resolveScenarioType()` 重构 + LLM 调用透传 |
| `backend/apps/agents/src/modules/agents/executor-engines/native-streaming-agent-executor.engine.ts` | `streamOnce()` 透传 `responseFormat` |
| `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts` | `isMeetingLikeTask()` 补充 collaborationContext 检查 |
| **Context Builder 层** | |
| `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts` | 四分支重构 + 统一 JSON 约束注入 |
| **Orchestration 层** | |
| `backend/src/modules/orchestration/planner.service.ts` | 4 处 collaborationContext 构建改为工厂 + 移除 `[SYSTEM OVERRIDE]` JSON 格式约束 |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | `buildOrchestrationCollaborationContext()` 改为工厂 + `buildPreTaskContext()` / `buildPostTaskContext()` 移除 JSON 格式约束 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | `ensurePlannerSession()` 改为工厂 |
| `backend/src/modules/orchestration/services/plan-management.service.ts` | replan session 改为工厂 |
| **Meeting 层** | |
| `backend/src/modules/meetings/services/meeting-orchestration.service.ts` | `buildMeetingTeamContext()` 改为工厂 |
| **Inner Message 层** | |
| `backend/apps/agents/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts` | `processMessage()` 改为工厂 |

### 8.3 不修改的文件（本次范围外）

| 文件 | 原因 |
|------|------|
| `agent-task.worker.ts` | 嵌套 collaborationContext 问题需独立修复 |
| `agent-action-log.service.ts` | 依赖 worker 嵌套问题的修复 |
| `orchestration-tool-handler.service.ts` | `organizationId` 清理为独立任务 |

## 9. 时序图：编排场景完整 JSON 强制链路

```
planner.service.ts                    agent-executor.service.ts                OpenAI Provider
       │                                       │                                    │
       │  CollaborationContextFactory           │                                    │
       │  .orchestration({                      │                                    │
       │    planId, roleInPlan:'planner'         │                                    │
       │  })                                    │                                    │
       │  → { scenarioMode:'orchestration',     │                                    │
       │      responseDirective:'json-only',    │                                    │
       │      planId, roleInPlan }              │                                    │
       │                                        │                                    │
       │──── executeTask(agentId, task, ctx) ───>│                                    │
       │                                        │                                    │
       │                              resolveScenarioType()                           │
       │                              → 'orchestration'                               │
       │                                        │                                    │
       │                              collaboration-context.builder                   │
       │                              .build(orchestration branch)                    │
       │                              → system msg with:                              │
       │                                 协作上下文 JSON +                            │
       │                                 [输出格式约束] JSON-ONLY                     │
       │                                        │                                    │
       │                              resolveResponseFormat()                         │
       │                              → { type: 'json_object' }                       │
       │                                        │                                    │
       │                              modelService.chat(                              │
       │                                messages,                                     │
       │                                { temperature, maxTokens,                     │
       │                                  responseFormat: {type:'json_object'} }       │
       │                              )         │                                    │
       │                                        │──── create({ ...,                  │
       │                                        │       response_format:              │
       │                                        │       {type:'json_object'}          │
       │                                        │     }) ───────────────────────────> │
       │                                        │                                    │
       │                                        │ <──── JSON response ───────────────│
       │                                        │                                    │
       │ <──── { response: '{"task":{...}}' } ──│                                    │
```

**双重保障**：
1. **Prompt 层**：`collaboration-context.builder.ts` 注入 `[输出格式约束]` 到 system message
2. **API 层**：`response_format: { type: 'json_object' }` 在 LLM API 调用时传递

即使 prompt 层被其他指令干扰（如 sourcePrompt 中的工具调用要求），API 层仍能保证返回合法 JSON。

## 10. 向后兼容策略

### 10.1 运行时兼容

`CollaborationContextFactory.fromLegacy()` 负责将旧格式自动转换：

| 旧格式特征 | 转换结果 |
|-----------|---------|
| `{ meetingId, collaborationMode:'meeting' }` | `MeetingCollaborationContext` |
| `{ planId, mode:'planning', format:'json' }` | `OrchestrationCollaborationContext` |
| `{ planId, mode:'orchestration' }` | `OrchestrationCollaborationContext` |
| `{}` 或 `{ meetingId }` (仅 meetingId) | `InnerMessageCollaborationContext` 或 `ChatCollaborationContext` |

### 10.2 过渡期

- 旧字段 `format`、`mode`、`collaborationMode` 保留 3 个月
- `collaboration-context.builder.ts` 同时支持 `responseDirective` 和旧 `format === 'json'` 检测
- `resolveScenarioType()` 同时支持 `scenarioMode` 和旧字段推导

### 10.3 清理计划

3 个月后（预计 2026-07）：
- 移除 `fromLegacy()` 中的旧格式转换逻辑
- 移除 `OrchestrationCollaborationContext` 中的 `format?` 和 `mode?` 字段
- 移除 `resolveScenarioType()` 中的字段推导分支
