# Prompt 与 Skill 设计边界优化计划

> **状态**: 执行中（已完成 Phase 1-4）  
> **创建日期**: 2026-03-21  
> **关联设计原则**: 3.3 Prompt 与 Skill 设计边界 — "代码负责路由，Skill 承载场景策略"

---

## 一、背景与目标

当前 `AgentExecutorService` 和 `agent-prompt-catalog` 中共计 **30 个 prompt 片段**，其中相当一部分包含场景化策略（步骤清单、异常处理规则、回执模板、反幻觉约束等），直接硬编码在业务代码或 catalog 常量中。

根据 3.3 设计原则，这些场景策略应沉淀到 `docs/skill/*.md`，代码层仅负责：
1. 识别上下文与事件
2. 选择要激活的 skill
3. 透传必要运行参数

**目标**：将可迁移的 prompt 外移到 Skill 层，精简 catalog 中的策略性文本，使场景策略迭代优先改 skill 文档而非改代码。

---

## 二、现状扫描摘要

### 2.1 Prompt 分布

| 来源 | 数量 | 说明 |
|------|------|------|
| `agent-prompt-catalog.ts` | 14 | 通过 `AGENT_PROMPTS` 常量注册，支持 Prompt Registry 4 级解析优先级链 |
| `agent-executor.service.ts` 内嵌 | 12 | 硬编码在 `buildMessages()`、`executeWithToolCalling()` 等方法中 |
| `agent-executor.helpers.ts` | 1 | `buildToolInputRepairInstruction` 工具参数修复指令 |
| `executor-engines/opencode-*.engine.ts` | 2 | OpenCode engine 空回复重试指令 |
| 已注释（未启用） | 1 | 记忆检索上下文提示 |

### 2.2 Skill 激活链路现状

```
Agent.skills[] → getEnabledSkillsForAgent() → Redis/MongoDB
    │
    ├─ [始终] 注入 skillLines 元信息（name/description/tags）
    │
    └─ [条件] shouldActivateSkillContent()
              ├─ tag 匹配 task.type → 激活
              ├─ task.type=planning 且 tag 含 planning 信号 → 激活
              └─ 关键词命中 ≥ 2 → 激活
                    → 加载 skill.content → 截断至 4000 字符 → 注入 system message
```

### 2.3 现有 Skill 文档（docs/skill/）

| Skill 文档 | 覆盖场景 |
|---|---|
| `meeting-sensitive-skill.md` | 会议中识别编排信号，先建议后执行 |
| `meeting-summary-enforcer.md` | meeting.ended 事件强制读取→生成总结→落库 |
| `orchestration-planner-guard.md` | 编排计划分配护栏（能力校验、prompt 合约） |
| `cto-rd-workflow.md` | CTO 研发需求轻量流程（信息采集→发布） |
| `cto-rd-workflow-appendix.md` | 上述流程的触发词/输出模板补充 |
| `AGENT_ROLE_TIER_SKILL.md` | 三层角色治理（高管/执行层/临时工） |

---

## 三、分类结论

### 3.1 可迁移到 Skill 层（6 个）

包含场景化策略、步骤清单、回执模板、反幻觉约束，不依赖或极少依赖代码动态参数。

| # | Prompt 标识 | 位置 | 当前 scene/role | 迁移目标 Skill | 迁移理由 |
|---|---|---|---|---|---|
| 1 | `DEFAULT_MEETING_EXECUTION_POLICY_PROMPT` | catalog:43-50 | `meeting / meeting-execution-policy` | 合入 `meeting-sensitive-planner` skill | 纯场景规则（"一次确认后自动执行"），已有 skill 覆盖同场景 |
| 2 | `MODEL_MANAGEMENT_GROUNDING_PROMPT` | catalog:106-112 | `model-management / force-tool-grounding` | 新建 `model-management-grounding` skill | 强制工具调用顺序（add-model→list-models→验证），典型的"场景→工具步骤清单" |
| 3 | `EMPTY_RESPONSE_RETRY_PROMPT` | catalog:114-120 | `meeting / empty-response-retry` | 新建 `meeting-resilience` skill | 含回执模板（"至少包含：已分配、已通知、下一检查点"） |
| 4 | `GENERATION_ERROR_RETRY_PROMPT` | catalog:98-104 | `meeting / generation-error-retry` | 合入 `meeting-resilience` skill | 生成异常重试策略，同属会议异常处理 |
| 5 | `EMPTY_MEETING_RESPONSE_FALLBACK` | catalog:35-41 | `meeting / empty-response-fallback` | 合入 `meeting-resilience` skill | 兜底回执模板 |
| 6 | forcedToolCall 系统指令 | executor:1014-1015 | — | 可抽象为 skill forced-action 模板 | 包含明确工具调用步骤指令 |

### 3.2 保留在 Catalog 但需精简（8 个）

属于 runtime 基础设施，需要代码动态注入参数，但其中嵌入了策略性指导文本，可剥离到 skill。

| # | Prompt 标识 | 位置 | 优化方向 |
|---|---|---|---|
| 1 | `TOOL_INJECTION_INSTRUCTION_PROMPT` | catalog:76-87 | 保留工具列表和 `<tool_call>` 格式约束，"确认工具权限""参数错误重试"策略外移到 `agent-runtime-baseline` skill |
| 2 | `AGENT_WORKING_GUIDELINE_PROMPT` | catalog:24-33 | 当前 3 条准则硬编码合理，但随准则增多建议拆为 `agent-working-guideline` skill |
| 3 | `TOOL_DENIED_PROMPT` | catalog:122-129 | 保留动态参数 `normalizedToolId`，降级策略文本外移 |
| 4 | `TOOL_FAILED_PROMPT` | catalog:131-138 | 保留动态错误信息，降级策略文本外移 |
| 5 | `TOOL_ROUND_LIMIT_MESSAGE` | catalog:140-146 | 保留熔断信号，"精简调用后重试"策略外移 |
| 6 | `TOOL_STRATEGY_WRAPPER_PROMPT` | catalog:89-96 | 容器模板结构合理，各工具 prompt 策略需评估是否可 skill 化 |
| 7 | `buildToolInputRepairInstruction` | helpers:155-173 | 保留 schema/参数动态注入，精简策略引导文本 |
| 8 | 技能清单注入指令 | executor:1392-1395 | "请优先基于已启用技能的能力边界…"属策略引导，可纳入 skill |

### 3.3 应保留在代码层（16 个）

纯 runtime 基础设施、数据注入、系统协议，不含场景策略，不适合 skill 化。

| # | Prompt 标识 | 保留理由 |
|---|---|---|
| 1 | `CREATE_AGENT_DEFAULT_SYSTEM_PROMPT` | 创建兜底，纯身份声明 |
| 2 | `TEST_CONNECTION_DEFAULT_SYSTEM_PROMPT` | 连接测试探活，最简 prompt |
| 3 | `TEST_CONNECTION_USER_MESSAGE` | 连接测试探活消息 |
| 4 | 身份记忆注入前缀 `【身份与职责】` | 纯数据注入 |
| 5 | 身份记忆增量更新前缀 | 纯数据标识 |
| 6 | 任务信息注入（标题/描述/类型/优先级） | 纯上下文透传 |
| 7 | 任务信息增量更新前缀 | 纯数据标识 |
| 8 | 激活技能方法论前缀 `【激活技能方法论 - ${name}】` | 框架级注入格式 |
| 9 | 技能内容截断提示 | 框架级截断说明 |
| 10 | 团队上下文注入 | 纯数据透传 |
| 11 | 工具结果回灌消息 | runtime 协议 |
| 12 | 模型超时用户提示 | 用户可读错误提示 |
| 13 | 工具使用策略单条格式 | 纯格式化模板 |
| 14 | OpenCode 空回复重试补充指令（detailed） | engine 层异常处理，建议与 #3 统一 |
| 15 | OpenCode 空回复重试补充指令（streaming） | 同上 |
| 16 | 记忆检索上下文提示（已注释） | 已禁用，暂不处理 |

---

## 四、执行计划

### Phase 1：高收益低风险 — 会议场景 Prompt Skill 化

**影响范围**: `agent-prompt-catalog.ts`、`agent-executor.service.ts`、`docs/skill/`

#### Step 1.1 新建 `meeting-resilience` skill（docs/skill/meeting-resilience.md）

合并以下 3 个 prompt 为统一的会议异常处理策略文档：
- `EMPTY_MEETING_RESPONSE_FALLBACK` — 空回复兜底回执模板
- `EMPTY_RESPONSE_RETRY_PROMPT` — 空回复重试策略 + 最小回执结构
- `GENERATION_ERROR_RETRY_PROMPT` — 生成异常重试策略

Skill 文档内容应包含：
- 触发条件（`meetingLikeTask=true` 且命中空回复/生成异常）
- 异常类型分级（空回复 / 生成异常 / 超时）
- 每种异常的处理步骤和回执模板
- 幂等保护规则

#### Step 1.2 将 `DEFAULT_MEETING_EXECUTION_POLICY_PROMPT` 合入 `meeting-sensitive-planner` skill

在 `docs/skill/meeting-sensitive-skill.md` 中追加"执行策略"章节，覆盖"一次确认后自动执行"规则。

#### Step 1.3 代码层改造

- `agent-prompt-catalog.ts`：保留 4 个会议 prompt 的 symbol 和 scene/role 定义，`buildDefaultContent` 改为精简的路由占位（如"参见 meeting-resilience skill"），确保 Prompt Registry 优先级链仍可降级
- `agent-executor.service.ts`：在 `meetingLikeTask=true` 路径中，增加 `meeting-resilience` skill 的自动激活逻辑（补充 `shouldActivateSkillContent` 的匹配规则或显式激活）
- `opencode-*.engine.ts`：空回复重试指令统一走 skill 注入，消除与 catalog 的重复

#### Step 1.4 验证

- 会议场景下空回复 → 检查回执内容是否来自 skill
- 生成异常 → 检查重试指令是否来自 skill
- Prompt Registry 发布覆盖 → 确认优先级链仍生效

---

### Phase 2：场景 Skill 化 — 模型管理 Grounding

**影响范围**: `agent-prompt-catalog.ts`、模型管理调用链、`docs/skill/`

#### Step 2.1 新建 `model-management-grounding` skill（docs/skill/model-management-grounding.md）

迁移 `MODEL_MANAGEMENT_GROUNDING_PROMPT` 的完整内容：
- 反幻觉约束（禁止未调用工具就声称完成）
- 强制工具调用序列（add-model → list-models → 验证）
- 失败处理（工具失败时明确说明原因）

#### Step 2.2 代码层改造

- `agent-prompt-catalog.ts`：`modelManagementGroundingInstruction` 的 `buildDefaultContent` 精简为最小必要提示
- 确保 `scene=model-management` 时能自动激活此 skill（需检查激活链路是否覆盖此场景，可能需要补充显式激活逻辑）

#### Step 2.3 验证

- 模型管理场景下触发 add-model 请求 → 确认 grounding 指令来自 skill
- Agent 未绑定此 skill 时 → 确认 catalog code_default 仍兜底

---

### Phase 3：Runtime 基线 Skill 化 — 工具策略与行为准则

**影响范围**: `agent-prompt-catalog.ts`、`agent-executor.service.ts`、`agent-executor.helpers.ts`、`docs/skill/`

#### Step 3.1 新建 `agent-runtime-baseline` skill（docs/skill/agent-runtime-baseline.md）

沉淀以下策略性文本：
- `AGENT_WORKING_GUIDELINE_PROMPT` 的 3 条行为准则
- `TOOL_INJECTION_INSTRUCTION_PROMPT` 中的策略规则（"确认工具权限""参数错误重试"）
- 工具拒绝/失败/轮次上限的降级策略文本

#### Step 3.2 代码层精简

- `TOOL_INJECTION_INSTRUCTION_PROMPT`：仅保留工具列表动态注入 + `<tool_call>` 格式协议，剥离策略指导
- `AGENT_WORKING_GUIDELINE_PROMPT`：保留为 catalog 条目（向后兼容），但内容精简为"请遵循已激活的工作准则"
- `TOOL_DENIED/FAILED/ROUND_LIMIT`：仅保留动态参数注入，降级策略文本指向 skill

#### Step 3.3 验证

- Agent 执行链路中 `buildMessages()` 输出的 system messages 是否正确合并了 skill 内容和 catalog 精简内容
- 无 skill 绑定时 catalog code_default 兜底是否正常

---

### Phase 4（可选）：forcedToolCall 指令 Skill 化

**前置条件**: Phase 1-3 完成，skill 激活链路稳定

- 将 `executor:1014-1015` 的 forcedToolCall 系统指令抽象为 skill 模板
- Before-Step Hook 通过 skill content 获取指令模板，仅透传 `tool` 和 `parameters`

---

## 五、技术约束与风险

| 约束项 | 说明 | 应对措施 |
|---|---|---|
| Skill content 4000 字符截断 | `SKILL_CONTENT_MAX_INJECT_LENGTH` 默认 4000 | Phase 1 合并后评估长度，必要时调大或拆分 skill |
| Skill 激活依赖关键词匹配 | `shouldActivateSkillContent()` 基于 tag/keyword overlap | 会议场景需补充 `meetingLikeTask` 标记到匹配逻辑，或支持显式激活 |
| Prompt Registry 优先级链兼容 | session_override > db_published > redis_cache > code_default | 迁移后 code_default 作为最终兜底，确保无 skill 时不降级失败 |
| OpenCode engine 重复 prompt | `opencode-*.engine.ts` 中有独立的空回复重试指令 | Phase 1 统一为 skill 注入，消除重复 |
| Skill 未绑定 Agent 的降级 | 若目标 Agent 未绑定对应 skill | catalog code_default 兜底，确保行为不回退 |

---

## 六、场景 → Skill → 工具映射关系（可追踪清单）

| 场景 | 触发条件 | 激活 Skill | 依赖工具 |
|---|---|---|---|
| 会议执行 | `meetingLikeTask=true` | `meeting-sensitive-planner` | create-plan, run-plan, create-schedule |
| 会议异常处理 | `meetingLikeTask=true` + 空回复/生成异常 | `meeting-resilience`（新建） | — |
| 会议结束总结 | `meeting.ended` 事件 | `meeting-summary-enforcer` | get-detail, save-summary |
| 模型管理 | `scene=model-management` | `model-management-grounding`（新建） | add-model, list-models |
| 编排计划 | `task.type=planning` | `orchestration-planner-guard` | — |
| CTO 研发流程 | 研发需求信号 | `cto-rd-workflow` | docs-read, repo-read, search-memo |
| Agent 运行时基线 | 所有 Agent 执行 | `agent-runtime-baseline`（新建） | — |
| 角色治理 | 任务分派 | `AGENT_ROLE_TIER_SKILL` | — |
