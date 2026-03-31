# Fix 记录：Planner Agent 输出"确认接收"而非 JSON — Skill 注入策略与措辞追溯

## 1. 基本信息

- 标题：编排规划中 Planner Agent 输出确认性自然语言而非 task JSON，根因为 Skill 注入策略过于宽泛及注入措辞触发确认行为
- 日期：2026-03-28
- 负责人：AI Agent
- 关联计划：`69c77eed`（测试1-失败）、`69c7bd47`（测试2-失败）、`69c7bde7`（测试3-失败）、`69c7c616`（测试4-成功）
- 是否落盘：是

---

## 2. 问题现象

- **用户侧表现**：创建增量编排计划后，Planner Agent 连续 3 次重试均未生成有效 task JSON，计划停留在 `draft` 状态。
- **Agent 典型错误输出**：
  - 第 1 次：调用 `create-plan`、`search-memo`、`append-memo` 等工具，把 planner prompt 当普通任务执行
  - 第 2 次："已收到并应用更新...orchestration-runtime-tasktype-selection 技能方法论"
  - 第 3 次："已接收并应用本次'身份与职责'增量更新，以及 orchestration-runtime-tasktype-selection 技能方法论"
- **影响范围**：所有使用增量编排的计划，Planner Agent 输出不稳定

---

## 3. 根因追溯

### 3.1 Skill 强制激活策略过于宽泛

**追溯路径**：
```
step-dispatcher.advanceOnce()
  → plannerService.generateNextTask(planId, context, { sessionId })
    → agentClientService.executeTask(agentId, task, { collaborationContext })
      → agents app: buildMessages()
        → ToolsetContextBuilder.build()
          → contextStrategyService.shouldActivateSkillContent(skill, task, context)
```

**`context-strategy.service.ts` 中存在三层激活逻辑**：

| 层级 | 代码位置 | 逻辑 | 问题 |
|------|----------|------|------|
| L25-27 | `task.type` 标签匹配 | `tags.some(tag => tag.includes(task.type))` | `task.type='planning'` 会匹配含 `planning` 标签的 skill |
| L29-34 | planning 强制激活 | `planningSignals = ['planning','orchestration','guard','planner']` | 所有含这些关键词标签的 skill **全部被强制激活** |
| L36-44 | 语义匹配 | skill name/tags 分词后在 taskText 中匹配，hitCount >= 2 激活 | `task` 这种泛词导致误激活 |

**实际被激活的 skill**：`orchestration-runtime-tasktype-selection`（tags: `["runtimeTaskType","pre-execute","task-type-migration","orchestration"]`）

- 通过 L29-34：tags 中 `orchestration` 匹配 planningSignals
- 通过 L36-44：skill name 分词出 `orchestration`（hitCount=1） + tag `task-type-migration` 分词出 `task`（hitCount=2）

### 3.2 注入措辞触发 Agent 确认行为

**问题措辞 A — 技能索引引导语**：
```
以下为技能索引。请按任务上下文激活并严格遵循对应技能方法论。
```
"请按任务上下文激活" 让 Agent 理解为"你需要对激活动作做出确认"。

**问题措辞 B — 方法论前缀**：
```
【激活技能方法论 - orchestration-runtime-tasktype-selection】
```
"激活技能方法论" 的语气像"通知"而非"规则"，Agent 倾向于输出确认文本。

### 3.3 Session 复用放大了问题

三次重试共享同一 session（`plan-{planId}-{agentId}`）：

1. **Run 1**：Agent 收到 skill 方法论 + planner prompt → 把 prompt 当任务执行 → 调用 `append-memo` 写入新 memo → identity memos fingerprint 发生变化
2. **Run 2**：identity memos fingerprint 不同 → 注入 `【身份与职责增量更新】` → Agent 看到 run 1 的 user/assistant 历史 + 新 system message → 输出"确认接收"
3. **Run 3**：同上，session 历史进一步恶化

### 3.4 LLM 实际收到的消息栈

通过代码链路追溯还原 Run 2 中 LLM 实际收到的消息：

```
[system] agent-runtime-baseline（agentWorkingGuideline）— "能用工具就用工具"
[system] agent systemPrompt — "OK"（仅 2 字节）
[system] 【身份与职责增量更新】— identity memo delta   ← 触发确认
[system] Enabled Skills: orchestration-runtime-task-out-validation, orchestration-runtime-tasktype-selection
[system] 【激活技能方法论 - orchestration-runtime-tasktype-selection】 ← 触发确认
[system] 工具规格说明
[system] 协作上下文(编排) + [JSON-ONLY MODE]
[system] 任务信息摘要
[user]   run 1 的 planner prompt（JSON-only 指令 + schema + 计划目标...）
[assistant] run 1 的 Agent 响应（调用工具 + 非标准 JSON）
[user]   run 2 的 planner prompt（与 run 1 相同）   ← 被上面的上下文淹没
```

Agent 优先响应了 system messages 中的"更新通知"，而非 user message 中的 planner prompt。

---

## 4. 修复方案

### 4.1 Skill 激活模式可配置（Plan 级别）

**Schema 变更** — `orchestration-plan.schema.ts`：

`strategy` 新增 `skillActivation` 子字段：
```typescript
skillActivation?: {
  mode: 'standard' | 'precise';  // standard=普通评估, precise=精准指定(预留)
  skillIds?: string[];            // precise 模式下使用(预留)
};
```

**`context-strategy.service.ts` 变更**：

从 `context.collaborationContext.skillActivation` 读取配置：
- `standard` 模式：跳过 L29-34 的 planning 强制激活（planningSignals），保留其他激活路径
- `precise` 模式（预留）：只激活 `skillIds` 白名单中的 skill
- 未配置：保持原有逻辑（向后兼容）

**数据流**：
```
Plan.strategy.skillActivation
  → planner.service.ts 读取并放入 collaborationContext
  → HTTP → agents app
  → ContextStrategyService.shouldActivateSkillContent() 识别并执行对应策略
```

### 4.2 注入措辞优化（已由用户先行修改）

| 位置 | 原措辞 | 新措辞 |
|------|--------|--------|
| `toolset-context.builder.ts` L38 | `以下为技能索引。请按任务上下文激活并严格遵循对应技能方法论。` | 去除引导语，仅保留 `Enabled Skills for this agent:\n${skillLines}` |
| `toolset-context.builder.ts` L55 | `【激活技能方法论 - ${skill.name}】` | `【enabled skill - ${skill.name}】` |

---

## 5. 涉及文件变更

| 文件 | 变更 |
|------|------|
| `backend/src/shared/schemas/orchestration-plan.schema.ts` | `strategy` 新增 `skillActivation` 子字段（Mongoose raw schema + TypeScript 类型）；新增 `SkillActivationMode` 类型导出 |
| `backend/src/modules/orchestration/planner.service.ts` | `generateNextTask`、`executePreTask`、`executePostTask` 三个方法的 `collaborationContext` 中透传 `plan.strategy.skillActivation` |
| `backend/apps/agents/src/modules/agents/context/context-strategy.service.ts` | `shouldActivateSkillContent` 新增 `skillActivation` 识别逻辑：`precise` 白名单过滤（预留）；`standard` 跳过 planning 强制激活 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | `ensurePlannerSession` 的 `collaborationContext` 同步透传 `skillActivation` |
| `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | 技能索引引导语和方法论前缀措辞优化（用户先行修改） |

---

## 6. 验证结果

### 6.1 编译与测试

- TypeScript 编译：通过（0 错误）
- 单元测试：11 套件 46 用例全部通过

### 6.2 逐步验证记录

| 测试轮次 | Plan ID | 配置 | 结果 | 失败原因 |
|----------|---------|------|------|----------|
| 测试1 | `69c77eed` | `standard` + 旧措辞 | 失败(3/3) | skill 方法论通过语义匹配仍被激活，Agent 输出确认文本 |
| 测试2 | `69c7bd47` | `standard` + 旧措辞 + 跳过 guideline | 失败(3/3) | 问题不在 guideline，skill 方法论仍被注入触发确认 |
| 测试3 | `69c7bde7` | `standard` + 旧措辞 + 完全跳过 skill | 失败(3/3) | 技能索引列表的引导语"请按任务上下文激活"仍触发确认 |
| 测试4 | `69c7c616` | `standard` + 新措辞 | **成功** | Planner 首步输出符合 schema 的 task JSON |

### 6.3 成功验证详情

Plan `69c7c616`：
- `status: planned`，`totalGenerated: 1`，`consecutiveFailures: 0`
- Planner 原始响应：`{"task":{"title":"Define next executable step...","description":"Inspect current orchestration plans...","taskType":"general"},...}`
- task 成功创建并执行完成

---

## 7. 使用方式

对需要优化 skill 注入的 Plan，在 MongoDB 中设置：

```javascript
db.orchestration_plans.updateOne(
  { _id: ObjectId("...") },
  { $set: { "strategy.skillActivation": { mode: "standard" } } }
)
```

后续需将 `skillActivation` 参数加入 `CreatePlanFromPromptDto`，支持 API 层面直接配置。

---

## 8. 关键经验教训

### 8.1 Skill 注入的措辞直接影响 LLM 行为

"激活"、"请确认"、"请遵循" 等命令式措辞在 system message 中会被 LLM 理解为需要显式回应的指令。在 JSON-only 场景下，应使用中性、声明式措辞（如 `enabled skill`），让 LLM 将其作为背景规则静默遵守。

### 8.2 Session 内 Fingerprint Delta 机制会引发连锁反应

`ContextFingerprintService` 的增量更新机制（`buildDelta` + `deltaPrefix`）在同一 session 的重试场景下，如果 run 1 中 Agent 通过工具调用改变了数据（如 `append-memo`），会导致 run 2 注入 `【身份与职责增量更新】` 等 delta 消息，进一步触发 Agent 输出确认文本。

### 8.3 语义匹配的泛词问题

`shouldActivateSkillContent` 的语义匹配（hitCount >= 2）中，`task`、`type`、`plan` 等常见词过于泛化。当 `task.description` 是 planner prompt 全文（数千字符）时，几乎所有 skill 都会被误激活。后续可考虑：
- 语义匹配只用 `task.title` + `task.type`，不用 `task.description`
- 或对分词结果做最小长度过滤（当前 >= 3，可提高到 >= 5）

### 8.4 Planner 场景的 System Message 应最小化

Planner 作为纯 JSON 输出角色，其 system messages 越多，LLM 越容易偏离 JSON-only 指令。理想状态：identity（角色定义）+ collaboration（JSON-only 模式）+ 必要的 skill 规则，其他一律不注入。

---

## 9. 遗留问题

| 问题 | 状态 | 说明 |
|------|------|------|
| Post-execute 默认 Stop (P2) | 待修复 | 测试4 中 Plan 成功生成 task 但执行完一步后 `lastDecision: stop`，计划未继续推进 |
| `CreatePlanFromPromptDto` 不支持 `skillActivation` | 待补充 | 当前只能通过 MongoDB 直接设置，需在 DTO 层面开放 |
| `precise` 模式未实现逻辑 | 预留 | 接口已定义，逻辑按 `standard` 处理，后续补充白名单过滤 |
| `buildPreTaskContext` 中引用 skill 路径 | 待评估 | L238 `'先激活并严格遵循 skill: docs/skill/orchestration-runtime-tasktype-selection.md'` 在 phasePreExecute 阶段会通过 planner session 留在历史中，可能对后续 planner 调用产生干扰 |

---

## 10. 关键文件索引

| 文件 | 职责 |
|------|------|
| `backend/src/shared/schemas/orchestration-plan.schema.ts` | Plan schema，`strategy.skillActivation` 定义 |
| `backend/src/modules/orchestration/planner.service.ts` | Planner 核心：prompt 构建、LLM 调用、`skillActivation` 透传 |
| `backend/apps/agents/src/modules/agents/context/context-strategy.service.ts` | Skill 激活策略：`shouldActivateSkillContent`，`skillActivation` 模式识别 |
| `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts` | 技能索引 + 方法论注入，措辞控制 |
| `backend/apps/agents/src/modules/agents/context/identity-context.builder.ts` | Identity 注入，fingerprint delta 机制 |
| `backend/apps/agents/src/modules/agents/context/context-fingerprint.service.ts` | Fingerprint 增量更新机制 |
| `backend/src/modules/orchestration/services/orchestration-step-dispatcher.service.ts` | 四阶段调度器，`ensurePlannerSession` |
| `backend/src/modules/orchestration/services/orchestration-context.service.ts` | Pre/Post task context 构建，`buildPreTaskContext` |
