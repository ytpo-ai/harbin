# CollaborationContext 场景化重构 + JSON 输出强制策略

## 1. 基本信息

- 标题：CollaborationContext 场景化重构与 JSON 输出双重强制
- 日期：2026-03-28
- 负责人：AI Agent (review + 修复) / coder-van (实现)
- 关联需求/会话：`docs/issue/TODO.md` — 优化系统提示词设计、注入时机和注入条件
- 是否落盘（用户确认）：是
- 关联 Commits：`e01a7cf`（主体实现）、`ff4e2fb`（review 修复 + 文档落盘）

## 2. 问题现象

- 用户侧表现：计划编排过程中 Agent 输出不稳定，planner 经常返回非 JSON 内容（问候语、确认文字、markdown 包裹的 JSON），导致编排失败率高
- 触发条件：
  1. collaborationContext 为 `Record<string, unknown>` 无类型约束，各入口手动拼字段，字段名不一致（`mode` vs `collaborationMode`、`format: 'json'`）
  2. `[SYSTEM OVERRIDE] JSON-only` 指令散落在 3 个文件中重复注入，且措辞触发 LLM 确认行为
  3. 完全依赖 prompt 工程控制 JSON 输出，无 API 级别 `response_format` 支持
  4. inner-message bridge 的 collaborationContext 几乎为空，场景无法被正确识别
- 影响范围：orchestration planner/executor、inner-message agent 执行、meeting agent 执行
- 严重程度：高

## 3. 根因分析

- 直接原因：JSON 格式约束散落在多处（`orchestration-context.service.ts` 的 pre/post task、`planner.service.ts` 的 incremental prompt、`collaboration-context.builder.ts`），措辞不一致且互相冲突；无 API 级别强制
- 深层原因：`collaborationContext` 作为核心场景载体缺乏类型系统，导致各处手动拼字段无法统一管控输出格式策略；场景推导依赖字段存在性猜测（`meetingId` → meeting、`planId` → orchestration）而非显式标识
- 相关模块/文件（10 个 Gap 详见技术设计文档 §2.2）：
  - `backend/libs/contracts/src/` — 无 CollaborationContext 类型定义
  - `backend/apps/agents/src/modules/agents/context/collaboration-context.builder.ts` — JSON 注入点之一
  - `backend/src/modules/orchestration/planner.service.ts` — JSON 注入点之二（4 处构建点）
  - `backend/src/modules/orchestration/services/orchestration-context.service.ts` — JSON 注入点之三
  - `backend/libs/models/src/v1/` — Provider 层不支持 `response_format`
  - `backend/apps/agents/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts` — collaborationContext 几乎为空

## 4. 修复动作

### 4.1 类型系统（步骤 1）

新增 `@libs/contracts` 中的 discriminated union 类型：
- `CollaborationContext = MeetingCollaborationContext | OrchestrationCollaborationContext | InnerMessageCollaborationContext | ChatCollaborationContext`
- `ResponseDirective = 'json-only' | 'json-preferred' | 'text'`
- `ScenarioMode = 'meeting' | 'orchestration' | 'inner-message' | 'chat'`
- 5 个 type guard 函数

**文件**：`backend/libs/contracts/src/collaboration-context.types.ts`（新增）

### 4.2 工厂函数（步骤 2）

新增 `CollaborationContextFactory`，提供 4 个静态工厂方法 + `fromLegacy()` 向后兼容转换：
- `orchestration()` → 自动设置 `responseDirective: 'json-only'`
- `meeting()` → 自动设置 `responseDirective: 'text'`
- `innerMessage()` → 根据 `requireJsonResponse` 参数决定
- `chat()` → 自动设置 `responseDirective: 'text'`

**文件**：`backend/libs/contracts/src/collaboration-context.factory.ts`（新增）

### 4.3 LLM Provider 层 response_format（步骤 3）

- 新增 `LLMCallOptions` 接口（替代 `any`），包含 `responseFormat?: { type: 'json_object' | 'text' }`
- OpenAI Provider / Moonshot Provider：`chatWithMeta()` 和 `streamingChat()` 透传 `response_format`
- AIV2 Provider：按 providerName 区分处理——OpenAI 兼容系直传、Google 通过 `providerOptions.google.responseMimeType` 转写、Anthropic 跳过
- 新增 `resolveResponseFormatFromCollaborationContext()` 从 collaborationContext 推导 responseFormat，含推理模型保护（o1/o3/o4/gpt-5 跳过）

**文件**：`base-provider.ts`、`openai-provider.ts`、`moonshot-provider.ts`、`aiv2-provider.ts`、`agent-executor.helpers.ts`、`agent-executor.service.ts`、`native-streaming-agent-executor.engine.ts`

### 4.4 统一 JSON 注入点（步骤 4）

- 移除 `orchestration-context.service.ts` 中 `buildPreTaskContext()` 和 `buildPostTaskContext()` 的 3 处 `[SYSTEM OVERRIDE]` JSON 格式约束
- 移除 `planner.service.ts` 中 `buildIncrementalPlannerPrompt()` 的冗余格式约束（开头 6 行硬性规则 + 输出规则第 1-2 条 + 尾部"再次强调"），保留 JSON schema 定义和业务逻辑条目
- 统一收敛到 `collaboration-context.builder.ts`，根据 `responseDirective` 注入声明式约束（`JSON_ONLY_DIRECTIVE` / `JSON_PREFERRED_DIRECTIVE`）

**文件**：`orchestration-context.service.ts`、`planner.service.ts`、`collaboration-context.builder.ts`

### 4.5 场景推导重构（步骤 5）

- `ScenarioType` 扩展为 4 值：`'orchestration' | 'meeting' | 'inner-message' | 'chat'`
- `resolveScenarioType()` 优先从 `collaborationContext.scenarioMode` 读取，向后兼容字段推导
- `isMeetingLikeTask()` 补充 collaborationContext 检查
- `collaboration-context.builder.ts` 重构为 4 分支（meeting / orchestration / inner-message / chat）
- 上下文标签统一为英文：`Working Environment Context (Meeting/Orchestration/Inner Message/Chat)`

**文件**：`context-block-builder.interface.ts`、`agent-executor.service.ts`、`agent-executor.helpers.ts`、`collaboration-context.builder.ts`

### 4.6 调用方改造（9 处）

| # | 文件 | 改造点 |
|---|------|--------|
| 1 | `planner.service.ts` | `generateNextTask()` → `CollaborationContextFactory.orchestration()` |
| 2 | `planner.service.ts` | `executePreTask()` → 同上 |
| 3 | `planner.service.ts` | `executePostTask()` → 同上 |
| 4 | `planner.service.ts` | `planByAgent()` → 同上（`planId: 'legacy-planning-session'`） |
| 5 | `orchestration-context.service.ts` | `buildOrchestrationCollaborationContext()` → `CollaborationContextFactory.orchestration()` |
| 6 | `orchestration-step-dispatcher.service.ts` | `ensurePlannerSession()` → 同上 |
| 7 | `plan-management.service.ts` | replan session → 同上 |
| 8 | `meeting-orchestration.service.ts` | `buildMeetingTeamContext()` → `CollaborationContextFactory.meeting()` |
| 9 | `inner-message-agent-runtime-bridge.service.ts` | `processMessage()` → `CollaborationContextFactory.innerMessage()`，移除 `resolveTeamContext()` |

### 4.7 附带修复

- `planner.service.ts` `resolvePlannerTaskCandidate()`：新增 root-level fallback，当 LLM 省略 `task` 包装层直接返回 `{ title, description, ... }` 时也能正确解析

## 5. 验证结果

- 验证步骤：TypeScript 编译（`npx tsc --noEmit`）通过，0 错误
- 验证结论：通过
- 测试与检查：
  - 编译验证：全量 TypeScript 编译通过
  - 待运行时验证：计划编排首步生成、planner pre/post 决策、executor 任务执行、内部消息触发、会议场景（按 TODO.md 验证策略）

## 6. 风险与后续

- 已知风险：
  - `response_format: json_object` 与推理模型不兼容 — 已通过 `isReasoningModel()` 保护
  - 非 OpenAI 模型（Anthropic）不支持 `response_format` — 仅依赖 prompt 层约束
  - `fromLegacy()` 对仅有 `meetingId` 但无 `collaborationMode`/`meetingTitle` 的旧格式可能误分类为 chat — inner-message bridge 已改为工厂调用，残留调用方需排查
  - `CollaborationContextBase` 的 `[key: string]: unknown` index signature 弱化了类型窄化 — 过渡期妥协，3 个月后移除
- 后续优化：
  - 过渡期结束后（预计 2026-07）移除旧字段（`format`、`mode`、`collaborationMode`）和 `fromLegacy()` 兼容逻辑
  - `agent-task.worker.ts` 嵌套 `collaborationContext.collaborationContext` 问题需独立修复
  - `orchestration-tool-handler.service.ts` 中 `organizationId` 残留需独立清理
- 是否需要补充功能文档/API文档：否（无外部 API 变更）
- 关联设计文档：
  - `docs/plan/COLLABORATION_CONTEXT_SCENARIO_DRIVEN_REFACTOR_PLAN.md`
  - `docs/technical/COLLABORATION_CONTEXT_SCENARIO_DRIVEN_DESIGN.md`
