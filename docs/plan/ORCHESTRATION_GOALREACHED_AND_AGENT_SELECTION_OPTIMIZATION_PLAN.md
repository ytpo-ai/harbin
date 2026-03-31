# Plan: goalReached 判断优化 + generating 阶段 Agent 选择优化

## 背景

计划编排已基本稳定运行，但存在两个 prompt/决策层面的问题：

1. **goalReached 判断过早**：step 2 执行完后系统显示 `goalReached: true`，不再继续生成 review step（step 3）
2. **generating 阶段未参考大纲推荐的 agent**：LLM 不知道 outline 中已选定的 recommendedAgent，尝试多次后才选对

## 问题根因

### 问题1：goalReached 判断标准不够精确

- generating prompt 的输出规则（`orchestration-prompt-catalog.ts:43`）只写"若目标已达成，调用 submit-task 并传 isGoalReached=true"，判断标准模糊
- LLM 看到 step 2（开发执行）完成后，可能误判"目标已达成"
- generating prompt 中虽有步骤进度（`当前步骤: 3 / 3`），但**没有告知 outline 中还有哪些步骤未生成**
- post_execute JSON 解析失败时默认返回 `action: 'stop'`（`planner.service.ts:446-451`）
- dispatcher 层对 LLM 误判 stop 无安全兜底

### 问题2：recommendedAgent 数据断裂

- phaseInitialize 阶段 LLM 生成 outline 时填入了 `recommendedAgent`（agentId/agentName/reason），写入 `plan.metadata.outline`
- `buildGeneratingPrompt()`（`orchestration-context.service.ts:208-213`）只读取 `phasePrompts.generating`，完全忽略 `recommendedAgent`
- generating prompt 模板无 `{{recommendedAgent}}` 占位符
- LLM 在 generating 阶段不知道该用哪个 agent，只能 fallback 调 `list-agents` 或猜测

## 修复方案

### 修复1：goalReached 判断标准优化（3 个变更点）

**1-1. generating prompt 注入 outline 剩余步骤 + isGoalReached 规则绑定**
- 文件：`orchestration-context.service.ts` + `orchestration-prompt-catalog.ts`
- 从 outline 中提取**尚未生成的步骤**列表（标题 + taskType），注入 prompt
- 将 isGoalReached 规则从"目标已达成"改为"仅当 outline 中所有步骤均已提交任务时才允许"

**1-2. post_execute JSON 解析失败降级优化**
- 文件：`planner.service.ts`（`executePostTask` 方法）+ `orchestration-step-dispatcher.service.ts`
- 将 outlineStepCount 传入 executePostTask
- 当 `completed < outlineStepCount` 时，解析失败默认 `generate_next` 而非 `stop`

**1-3. dispatcher 安全兜底**
- 文件：`orchestration-step-dispatcher.service.ts`（`phasePostExecute` 方法）
- 当 `totalGenerated < outlineStepCount` 且 LLM 返回 `stop` 时，记录 warn 日志并覆写为 `generate_next`

### 修复2：generating 注入 recommendedAgent（2 个变更点）

**2-1. buildGeneratingPrompt 读取并注入**
- 文件：`orchestration-context.service.ts`
- 从 `currentOutlineStep.recommendedAgent` 读取 agentId/agentName
- 新增模板变量 `recommendedAgentSection`

**2-2. generating prompt 模板增加推荐 agent**
- 文件：`orchestration-prompt-catalog.ts`
- 输出规则中增加 recommendedAgent 指引

## 影响范围

- 后端 4 个文件：prompt 和决策逻辑
- 不涉及前端、不改接口契约、不改数据模型
- 纯 prompt 优化 + 决策安全兜底

## 状态

- [x] 计划确认
- [ ] 开发执行
- [ ] 编译验证
