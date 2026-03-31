# Plan: Planner Initialize 重构 + Skill 激活门控

## 背景

经过 fix1~fix10 对计划编排的持续修复，Planner 输出稳定性已有较大改善，但两个结构性问题仍然存在：

1. **Skill 全文在所有阶段注入**：rd-workflow / orchestration-runtime-tasktype-selection 等 skill 在 planner 的 generating / pre_execute / post_execute 阶段都被激活注入，LLM 上下文膨胀，指令冲突导致行为偏移
2. **phaseInitialize 与业务强绑定**：当前 initialize 阶段硬编码了 requirement 获取逻辑，无法复用于 general/research 域

## 目标

1. Initialize 阶段输出"大纲 + 每步每阶段的预编译 Prompt"，后续阶段从 metadata 读取精确 prompt，不再注入 skill 全文
2. Skill 激活支持 tag-based 门控规则，按 domainType / taskType / phase / roleInPlan 精确控制激活范围
3. Requirement 获取从 initialize 剥离为独立 task，initialize 变成通用编排准备阶段

## 关联文档

- 技术方案：`docs/technical/PLANNER_INITIALIZE_REFACTOR_AND_SKILL_ACTIVATION_GATE_DESIGN.md`
- 问题追踪：`docs/issue/PLAN_OPTIMAZE.md`

---

## 执行计划

### Step 1: orchestration-plan-initialize 工具注册与实现

**影响**：backend (agents app + orchestration module)

**执行项**：
1. `builtin-tool-catalog.ts` 注册 `builtin.sys-mg.mcp.orchestration.plan-initialize` 工具
   - 参数：`planId`(string, required), `mode`(string, required), `data`(object, required)
   - mode 为动态 key，写入 `plan.metadata[$mode]`
2. `orchestration-tool-handler.service.ts` 新增 `planInitialize()` 方法
   - 校验 planId 有效性（ObjectId.isValid）
   - 校验 mode 白名单（初始支持 `outline` / `taskContext`，可扩展）
   - `mode=outline` 时校验 data 结构（step/title/taskType/phasePrompts 必填）
   - 调用 orchestration API 写入 `plan.metadata[$mode]`
3. `tool-execution-dispatcher.service.ts` 添加路由分发
4. orchestration 后端 API 新增 `PATCH /plans/:id/metadata` 端点（或复用 update-plan）

**验收**：工具可通过 agent session 调用，metadata 正确写入 DB

---

### Step 2: Skill 激活门控（tag-based activation rule）

**影响**：backend (agents app)

**执行项**：
1. `context-strategy.service.ts` 新增 `parseActivationTags()` 方法
   - 从 skill.tags 中解析 `field:value:rule` 格式的激活 tag
   - 非激活格式的 tag 忽略（向后兼容）
2. `shouldActivateSkillContent()` 改造
   - 新增上下文参数：`{ domainType, taskType, phase, roleInPlan }`
   - 如果 skill 含有激活 tag → 走 tag-based 判断（no > must > enable）
   - 如果 skill 不含激活 tag → 走当前逻辑（向后兼容）
3. 调用链透传：`toolset-context.builder.ts` → `shouldActivateSkillContent()` 需要传入当前阶段上下文
   - 上下文信息从 `collaborationContext` 中提取（roleInPlan 已有，需补充 domainType / taskType / phase）
4. 更新现有 skill 的 tags：
   - rd-workflow: 添加 `domainType:development:must`, `phase:initialize:enable`
   - orchestration-runtime-tasktype-selection: 添加 `phase:pre_execute:must`, `roleInPlan:planner:must`
   - orchestration-runtime-task-out-validation: 添加 `phase:post_execute:must`, `roleInPlan:planner:must`

**验收**：planner 在 generating/pre_execute/post_execute 阶段，rd-workflow 不再被注入；tasktype-selection 仅在 pre_execute 激活；task-out-validation 仅在 post_execute 激活

---

### Step 3: phaseInitialize 流程重构

**影响**：backend (orchestration module)

**执行项**：
1. `planner.service.ts` 重写 `buildPhaseInitializePrompt()`
   - Phase 1 核心指令：list-agents → 读取 skill 内容 → 生成 outline（含 phasePrompts / recommendedAgent / phaseTools）→ 调用 `plan-initialize(mode=outline)` 写入
   - Phase 2 扩展指令：从 skill 中提取 `## phaseInitialize 扩展步骤` 段落，作为额外工具调用序列
   - 最终输出：调用 `plan-initialize(mode=taskContext)` 写入扩展步骤结果（如果有）
2. `orchestration-step-dispatcher.service.ts` 调整 `phaseInitialize()`
   - 不再从 LLM 响应文本中解析 JSON
   - 改为从 DB 读取 `plan.metadata.outline` 判断 initialize 是否完成
   - `shouldRunInitialize()` 改为检查 `metadata.outline` 是否存在且有效（含 phasePrompts）
3. 移除 `planner.service.ts` 中的 `extractInitializeFieldsFromText()` 降级逻辑（不再需要从文本提取）
4. 更新 rd-workflow skill 的 `## phaseInitialize 扩展步骤` 段落格式

**验收**：initialize 完成后 plan.metadata.outline 包含每步的 phasePrompts / recommendedAgent / phaseTools

---

### Step 4: 后续阶段 prompt 注入链路改造

**影响**：backend (orchestration module)

**执行项**：
1. `planner.service.ts` — `buildIncrementalPlannerPrompt()`（generating 阶段）
   - 从 `plan.metadata.outline[currentStep].phasePrompts.generating` 读取预编译 prompt
   - 替代当前硬编码的 skill 步骤引导指令
   - 保留阶段隔离声明、submit-task 工具说明、行为约束等框架性 prompt
2. `orchestration-context.service.ts` — `buildPreTaskContext()`（pre_execute 阶段）
   - 从 `plan.metadata.outline[currentStep].phasePrompts.pre_execute` 读取预编译 prompt
   - 替代当前的 preExecuteActions 硬拼装逻辑
3. `orchestration-context.service.ts` — `buildPostTaskContext()`（post_execute 阶段）
   - 从 `plan.metadata.outline[currentStep].phasePrompts.post_execute` 读取预编译 prompt
   - 保留执行结果注入（XML 标签包裹）、进度信息、决策规则框架
4. execute 阶段：executor prompt 中注入 `plan.metadata.outline[currentStep].phasePrompts.execute` 作为任务指导

**验收**：各阶段 LLM 收到的 prompt 来自预编译内容，不再依赖 skill 全文注入

---

### Step 5: Requirement 获取剥离为独立 task

**影响**：backend (orchestration module) + skill 文档

**执行项**：
1. rd-workflow skill 的 phaseInitialize 扩展步骤中，requirement 获取改为在 outline 的 step0 或作为 step1 前置的独立任务
2. planner 在 generating 阶段按 outline 生成"获取需求"task（非 planner 自身执行）
3. 调整 `shouldRunInitialize()` 判断条件，development 域不再要求 initialize 阶段必须获取 requirementId
4. taskContext 写入时机从 initialize 阶段改为"获取需求" task 的 post_execute 阶段

**验收**：development 域计划的 initialize 阶段不再直接调用 requirement 相关工具

---

### Step 6: 端到端验证

**执行项**：
1. development 域计划全链路：initialize → step1(plan) → step2(exec) → step3(review)
2. general 域计划：initialize 跳过 skill 扩展，直接生成 outline
3. 验证 skill 激活门控：各阶段检查激活的 skill 列表是否符合预期
4. 验证预编译 prompt 质量：对比 LLM 在新旧 prompt 下的输出稳定性

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Planner 在 initialize 阶段生成的 phasePrompts 质量不稳定 | 后续阶段 prompt 不可用 | 后端对 phasePrompts 做结构校验 + 降级到硬编码 prompt |
| Skill 激活 tag 格式解析错误 | skill 无法激活或误激活 | 非激活格式 tag 走原有逻辑（向后兼容） |
| metadata 字段膨胀 | DB 文档过大 | phasePrompts 设置长度上限 |
| Requirement 剥离后影响现有 rd-workflow 流程 | 已有计划执行异常 | Step 5 可延后执行，先验证 Step 1-4 |

## 执行优先级

Step 2（Skill 门控） > Step 1（工具注册） > Step 3（Initialize 重构） > Step 4（Prompt 注入改造） > Step 5（Requirement 剥离） > Step 6（验证）

Step 2 优先，因为它独立性最强且能立即缓解当前 skill 全文注入问题。
