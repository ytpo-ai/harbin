 
Here are the detailed findings for all three questions:
 
 
---
 
 
## Question 1: How does `buildPhaseInitializePrompt()` output get injected into the LLM context?
 
 
### The Prompt Placement Mechanism
 
 
**File:** `/Users/van/Workspace/harbin/backend/src/modules/orchestration/planner.service.ts`
 
 
At **lines 367-376**, the output of `buildPhaseInitializePrompt()` is placed into `task.description`:
 
 
```typescript
 
 
const prompt = this.buildPhaseInitializePrompt({...});   // line 367
 
 
const task: AgentExecutionTask = {
 
 
title: `[Incremental Planning] ${plan.title} initialize`,
 
 
description: prompt,         // <--- HERE: the prompt goes into description
 
 
type: 'planning',
 
 
...
 
 
messages: [],                // <--- EMPTY: no user messages
 
 
};
 
 
```
 
 
The task is then sent via `agentClientService.executeTask(plannerAgentId, task, { collaborationContext, sessionContext })` at **line 385**.
 
 
### How `description` enters the LLM context
 
 
The `description` does **NOT** become an explicit `user` message in the messages array sent to the LLM. Here is what actually happens:
 
 
1. **`AgentClientService.executeTask()`** (`/Users/van/Workspace/harbin/backend/src/modules/agents-client/agent-client.service.ts`, line 304) sends the task via HTTP POST to the agents service.
 
 
2. **`AgentExecutorService.executeTaskDetailed()`** (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/agent-executor.service.ts`, line 233) receives it. At **line 262-264**, the `agentContext` is built with `previousMessages: task.messages || []` (which is `[]` for the planner case).
 
 
3. **`buildMessages()`** (line 1865) assembles the message array via `ContextAssemblerService.assemble()` (line 1948). The assembler runs 6 context block builders in order. The `previousNonSystemMessages` (from `task.messages = []`) is empty.
 
 
4. **`TaskContextBuilder`** (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/context/task-context.builder.ts`, lines 26-66) detects that there is a description but no user messages exist (`descriptionWillBePrompt = true` at line 36), and **SUPPRESSES** the description from its task-info system message (line 45, `shouldSuppressDescription = true`). The system message only contains title/type/priority:
 
 
```
 
 
任务信息:
 
 
标题: [Incremental Planning] xxx initialize
 
 
类型: planning
 
 
优先级: high
 
 
```
 
 
5. **Runtime persistence** (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/runtime/runtime-orchestrator.service.ts`, lines 222-246) creates a user message in the database with `content: input.userContent || input.taskDescription` (which resolves to the full `task.description`). However, this persisted user message is **NOT** added to the in-memory `messages` array sent to the model.
 
 
6. **The model call** (`agent-executor.service.ts`, line 1213) passes only the assembled `messages` (all system messages) to `modelService.chat()`.
 
 
**Conclusion:** The `buildPhaseInitializePrompt()` output goes into `task.description`, but it ends up in the LLM context **only as system-level metadata** (with the full text suppressed in the task-info block). The actual full prompt text is **not** injected as a user message into the LLM messages array. The `TaskContextBuilder` suppresses it under the assumption (`descriptionWillBePrompt`) that something else would provide it as a user prompt, but nothing does. The Vercel AI SDK (`generateText`) and the raw Anthropic provider handle the all-system-messages array according to their own logic (Anthropic provider falls back to `{ role: 'user', content: 'Hello' }` at line 179-181 of `anthropic-provider.ts` when `chatMessages.length === 0`).
 
 
### Same Pattern for All Four Planner Methods
 
 
All four planner methods use the **identical injection pattern** -- prompt goes into `task.description`, `task.messages = []`:
 
 
| Method | File:Line | `description` source | `roleInPlan` | `phase` |
 
 
|--------|-----------|---------------------|--------------|---------|
 
 
| `initializePlan()` | planner.service.ts:374-376 | `buildPhaseInitializePrompt()` | `planner_initialize` | `initialize` |
 
 
| `generateNextTask()` | planner.service.ts:192-200 | `buildIncrementalPlannerPrompt()` | `planner` | `generating` |
 
 
| `executePreTask()` | planner.service.ts:304-312 | `taskContext` (raw string) | `planner_pre_execution` | `pre_execute` |
 
 
| `executePostTask()` | planner.service.ts:432-441 | `executionResult` (raw string) | `planner_post_execution` | `post_execute` |
 
 
---
 
 
## Question 2: Exact Ordering of Context Assembly in the Agent-Executor Pipeline
 
 
### The Context Assembler
 
 
**File:** `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/context/context-assembler.service.ts`
 
 
The `ContextAssemblerService.assemble()` method (line 32) iterates through builders **in a fixed, deterministic order** defined by the `builders` getter (line 21-30):
 
 
```typescript
 
 
private get builders(): ContextBlockBuilder[] {
 
 
return [
 
 
this.identityBuilder,       // Layer 1: identity
 
 
this.toolsetBuilder,        // Layer 2: toolset
 
 
this.domainBuilder,         // Layer 3: domain
 
 
this.collaborationBuilder,  // Layer 4: collaboration
 
 
this.taskBuilder,           // Layer 5: task
 
 
this.memoryBuilder,         // Layer 6: memory
 
 
];
 
 
}
 
 
```
 
 
After all builders run, `previousNonSystemMessages` (non-system messages from `context.previousMessages`) are appended at **line 53-54**.
 
 
### Exact Message Ordering
 
 
The final `messages` array sent to the LLM is ordered as follows:
 
 
| Position | Layer | Builder | File | Role | Content |
 
 
|----------|-------|---------|------|------|---------|
 
 
| 1 | `identity` | `IdentityContextBuilder` | `identity-context.builder.ts` | `system` | Agent working guideline (from `AGENT_PROMPTS.agentWorkingGuideline`) |
 
 
| 2 | `identity` | (same) | (same) | `system` | Agent's `systemPrompt` (if >= 5 chars) |
 
 
| 3 | `identity` | (same) | (same) | `system` | Agent's `promptTemplateRef` resolved content (if any) |
 
 
| 4 | `identity` | (same) | (same) | `system` | Identity memos (if any) |
 
 
| 5 | `toolset` | `ToolsetContextBuilder` | `toolset-context.builder.ts` | `system` | Enabled skills list |
 
 
| 6+ | `toolset` | (same) | (same) | `system` | **Skill content blocks** (one per activated skill, with `phaseInitialize` section stripped for planner roles) -- content from skill documents, resolved via `promptTemplateRef` if configured |
 
 
| N | `toolset` | (same) | (same) | `system` | Tool injection instruction (from `AGENT_PROMPTS.toolInjectionInstruction`) |
 
 
| N+1 | `toolset` | (same) | (same) | `system` | Tool strategy wrapper (from `AGENT_PROMPTS.toolStrategyWrapper`) |
 
 
| N+2 | `domain` | `DomainContextBuilder` | `domain-context.builder.ts` | `system` | Domain context (domainType, description, constraints, knowledge refs) -- only if persisted domain context exists |
 
 
| N+3 | `collaboration` | `CollaborationContextBuilder` | `collaboration-context.builder.ts` | `system` | Working Environment Context (Orchestration/Meeting/Chat/Inner-Message JSON) + response directive constraints |
 
 
| N+4 | `task` | `TaskContextBuilder` | `task-context.builder.ts` | `system` | Task info (title, type, priority; description suppressed when `descriptionWillBePrompt`) **OR** meeting execution policy |
 
 
| N+5 | `memory` | `MemoryContextBuilder` | `memory-context.builder.ts` | `system` | Run summaries (last 8 historical runs) |
 
 
| N+6 | `memory` | (same) | (same) | `system` | Relevant memos from memo search |
 
 
| Last | -- | Assembler | `context-assembler.service.ts:53-54` | `user`/`assistant` | `previousNonSystemMessages` from `context.previousMessages` (i.e., `task.messages`) |
 
 
### Conditional Injection
 
 
Each builder has a `shouldInject()` guard:
 
 
- **identity**: Always injects (line 22-24 of identity-context.builder.ts)
 
 
- **toolset**: Always injects (line 21-23 of toolset-context.builder.ts)
 
 
- **domain**: Only if persisted `domainContext.domainType` or `domainContext.description` exists (line 13-14 of domain-context.builder.ts)
 
 
- **collaboration**: For `orchestration`, `meeting`, or `inner-message` scenarios always; for `chat` only if collaboration context exists (line 25-30 of collaboration-context.builder.ts)
 
 
- **task**: Only for `orchestration` or `meeting` scenarios (line 18-19 of task-context.builder.ts)
 
 
- **memory**: If there are run summaries or an agent ID (line 13-14 of memory-context.builder.ts)
 
 
### Context Block Metadata
 
 
Each builder declares metadata (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/context/context-block-builder.interface.ts`, lines 8-17):
 
 
- **scope**: `'run'` (per-run) or `'session'` (per-session)
 
 
- **stability**: `'static'` (rarely changes), `'semi-static'` (changes occasionally), `'dynamic'` (changes per run)
 
 
| Builder | Scope | Stability |
 
 
|---------|-------|-----------|
 
 
| identity | run | semi-static |
 
 
| toolset | run | dynamic |
 
 
| domain | run | static |
 
 
| collaboration | run | semi-static |
 
 
| task | run | semi-static |
 
 
| memory | run | dynamic |
 
 
### Fingerprinting / Deduplication
 
 
The `ContextFingerprintService` (`context-fingerprint.service.ts`) is used by most builders to avoid re-injecting identical system blocks across runs in the same session. It compares content snapshots and can emit delta-only updates instead of full content.
 
 
---
 
 
## Question 3: Prompt Registry and Planner-Specific Prompts
 
 
### Existing Prompts in the Catalog
 
 
**File:** `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/prompt-registry/agent-prompt-catalog.ts`
 
 
The catalog contains **13 prompt templates** (lines 23-169). **None** of them have slugs containing "planner", "initialize", or "orchestration". The complete slug list:
 
 
| Key | Slug | Scene | Role |
 
 
|-----|------|-------|------|
 
 
| `agentWorkingGuideline` | `agent-working-guideline` | `working-guideline` | `agent-runtime-baseline` |
 
 
| `defaultMeetingExecutionPolicyPrompt` | `meeting-execution-policy` | `meeting` | `meeting-execution-policy` |
 
 
| `createAgentDefaultSystemPrompt` | `create-agent-system-prompt-fallback` | `agent-management` | `create-agent-default-system-prompt` |
 
 
| `toolInjectionInstruction` | `tool-injection-instruction` | `agent-runtime` | `tool-injection-instruction` |
 
 
| `toolStrategyWrapper` | `tool-strategy-wrapper` | `agent-runtime` | `tool-strategy-wrapper` |
 
 
| `emptyMeetingResponseFallback` | `meeting-empty-response-fallback` | `meeting` | `empty-response-fallback` |
 
 
| `generationErrorRetryInstruction` | `generation-error-retry` | `meeting` | `generation-error-retry` |
 
 
| `emptyResponseRetryInstruction` | `empty-response-retry` | `meeting` | `empty-response-retry` |
 
 
| `forcedToolCallInstruction` | `forced-tool-call` | `agent-runtime` | `forced-tool-call` |
 
 
| `toolDeniedInstruction` | `tool-denied` | `agent-runtime` | `tool-denied` |
 
 
| `toolFailedInstruction` | `tool-failed` | `agent-runtime` | `tool-failed` |
 
 
| `toolIntentRetryInstruction` | `tool-intent-retry` | `agent-runtime` | `tool-intent-retry` |
 
 
| `toolRoundLimitMessage` | `tool-round-limit` | `agent-runtime` | `tool-round-limit` |
 
 
| `testConnectionDefaultSystemPrompt` | `test-connection-system-prompt-fallback` | `agent-test-connection` | `system-prompt` |
 
 
| `testConnectionUserMessage` | `test-connection-user-message` | `agent-test-connection` | `verification-user-message` |
 
 
### How Prompt-Registry Prompts Are Injected vs. Skill Content
 
 
**Prompt-registry prompts** and **skill content** are injected through fundamentally different mechanisms:
 
 
**Prompt-Registry Prompts:**
 
 
1. Each `AgentPromptTemplate` in `AGENT_PROMPTS` has a `buildDefaultContent()` function that provides a code-default fallback.
 
 
2. When used, the template is resolved via `ContextPromptService.resolvePromptContent()` (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/agents/context/context-prompt.service.ts`, lines 28-31), which calls `PromptResolverService.resolve()` (`/Users/van/Workspace/harbin/backend/apps/agents/src/modules/prompt-registry/prompt-resolver.service.ts`, line 59).
 
 
3. Resolution priority: `session_override` > `db_published` (MongoDB lookup) > `redis_cache` > `code_default` (the hardcoded fallback).
 
 
4. The resolved content is then injected as a `system` message by whichever context builder uses it. For example:
 
 
- `agentWorkingGuideline` -> injected by `IdentityContextBuilder` (line 28, 52-58 of identity-context.builder.ts)
 
 
- `toolInjectionInstruction` -> injected by `ToolsetContextBuilder` (line 81, 117-124 of toolset-context.builder.ts)
 
 
- `defaultMeetingExecutionPolicyPrompt` -> injected by `TaskContextBuilder` (line 69-92 of task-context.builder.ts)
 
 
5. The `metadata.promptSlug` field is attached to the system message for tracing.
 
 
**Skill Content:**
 
 
1. Skills are loaded from the `Skill` MongoDB collection for each enabled skill (`agent-executor.service.ts`, lines 1911-1937).
 
 
2. Each skill can optionally have a `promptTemplateRef` (scene + role), which causes its content to be resolved through the same `PromptResolverService`. This means skill content CAN be overridden via the prompt registry DB/Redis.
 
 
3. Skill content is injected as `system` messages by `ToolsetContextBuilder` (lines 42-69 of toolset-context.builder.ts), wrapped with `【enabled skill - {skillName}】
 
 
{content}`.
 
 
4. Skill activation is conditional, controlled by `ContextStrategyService.shouldActivateSkillContent()` (`context-strategy.service.ts`, line 99), which evaluates:
 
 
- `skillActivation.mode === 'precise'`: only whitelist skills activate
 
 
- Activation tags on skills (e.g., `roleInPlan:planner,planner_initialize:must` or `phase:initialize:enable`)
 
 
- Legacy matching: task type, meeting signals, or semantic text matching
 
 
5. For planner roles, the `ToolsetContextBuilder` strips the `## phaseInitialize` section from skill content (lines 141-165 of toolset-context.builder.ts) for ALL planner roles, including `planner_initialize` (to avoid conflict with `buildPhaseInitializePrompt()`).
 
 
**Key difference:** Prompt-registry prompts are structural/framework prompts (tool format, guidelines, policies) used by the context builders. Skill content is domain/capability-specific knowledge that the agent uses to perform tasks. Both end up as `system` messages, but prompt-registry prompts are framework-level while skill content is agent-specific behavioral guidance.
 
 
