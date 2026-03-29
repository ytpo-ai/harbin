# Orchestration phaseInitialize + Planner 需求选择 + 任务大纲

## 概述

将研发需求流程中 step1（选定需求）和 step2（确认范围）从执行任务上移到 Planner 的 phaseInitialize 阶段，由 Planner 通过工具调用自主完成 requirement 选择和环境信息采集，消除 step1 首部豁免带来的大量问题。同时引入通用的 `taskContext` 机制，实现计划级上下文向任务执行层的自动传播与追溯。

## 背景与问题

### 现状

当前 development 类型计划的 rd-workflow 定义了 5 步：

| 步骤 | 职责 | 问题 |
|------|------|------|
| step1 | 选定最高优先级需求 | 首部豁免导致 prompt 分支复杂、requirementId 靠正则提取不稳定 |
| step2 | 确认需求范围 | 仅复述需求描述，phaseInitialize 已有结构化数据后无价值 |
| step3 | 制定技术开发计划 | 保留 |
| step4 | 执行开发 | 保留 |
| step5 | 实现评估 | 保留 |

### 核心痛点

1. **requirementId 获取靠正则从 LLM 输出中提取** — 极度不稳定
2. **step1 是"假任务"** — 不产生研发价值，只是做 planner 本应自己做的事
3. **首步豁免让 prompt 复杂度暴增** — `buildIncrementalPlannerPrompt()` 中大量 `if (totalSteps === 0)` 分支
4. **agent 分配被豁免** — step1 直接用 plannerAgentId 兜底，绕过正常 agent 选择逻辑
5. **step2 确认需求范围** — 在结构化数据流下无存在必要

## 设计方案

### 一、阶段状态机变更

```
旧: idle → generating → pre_execute → executing → post_execute → idle
新: idle → initialize → generating → pre_execute → executing → post_execute → idle
         ↑ 新增
```

`initialize` 是独立的新阶段，仅在计划首次启动时执行一次。

### 二、phaseInitialize 详细流程

Planner 在一轮 LLM 对话中完成所有工具调用和大纲生成。phaseInitialize 的行为由 skill（如 rd-workflow）定义，代码侧不硬编码具体指令。

#### development 类型

```
phaseInitialize(planId)
  ├── 从 skill 中提取 phaseInitialize 段落作为 planner 指令
  ├── planner 调用 list-agents → agent 列表进入 session context
  ├── planner 调用 requirement.list(status=todo) → 选定最高优先级需求
  │     └── 需求池为空/选择失败 → plan 直接 failed，终止
  ├── planner 调用 requirement.get(requirementId) → 需求详情进入 session context
  ├── planner 调用 requirement.update-status(assigned) → 需求标记为已分配
  ├── 后端从工具返回提取 requirementId → 写入 plan.metadata.taskContext.requirementId
  ├── planner 生成任务大纲 → 后端解析写入 plan.metadata.outline
  └── 转入 idle → 触发 phaseGenerate
```

#### 非 development 类型

```
phaseInitialize(planId)
  ├── planner 调用 list-agents → agent 列表进入 session context
  ├── planner 生成任务大纲 → 写入 plan.metadata.outline
  └── 转入 idle → 触发 phaseGenerate
```

### 三、taskContext 通用上下文传播机制

#### 3.1 设计目标

引入 `plan.metadata.taskContext`（Object 类型）作为**计划级上下文**，由 phaseInitialize 写入，自动传播到后续每个 task 的执行上下文中，并快照到 task run 记录以供追溯。

这是一个**通用机制**，不仅服务于 requirementId，未来任何需要从计划级传播到任务级的上下文都可以放入。

#### 3.2 数据结构

```typescript
// plan.metadata.taskContext 示例（development 类型）
{
  requirementId: "req-xxx",
  requirementTitle: "实现用户权限管理",
  requirementDescription: "需要实现基于 RBAC 的权限管理系统...",
  // 未来可扩展
}

// plan.metadata.taskContext 示例（general 类型）
{
  // 可为空对象或包含其他上下文字段
}
```

#### 3.3 三层传播链路

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: 写入（phaseInitialize）                            │
│                                                             │
│  phaseInitialize 完成后:                                    │
│  plan.metadata.taskContext = {                               │
│    requirementId, requirementTitle, requirementDescription   │
│  }                                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: 注入（task 执行时）                                │
│                                                             │
│  buildTaskDescription() 自动注入独立 section:               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ## 计划上下文（系统自动注入，不可修改）              │    │
│  │ - requirementId: req-xxx                            │    │
│  │ - requirementTitle: 实现用户权限管理                │    │
│  │ - requirementDescription: 需要实现基于 RBAC...      │    │
│  │                                                     │    │
│  │ ## 任务描述                                         │    │
│  │ <planner 生成的原始 description>                    │    │
│  └─────────────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: 追溯（task run 创建时快照）                        │
│                                                             │
│  run 创建时:                                                │
│  run.metadata.taskContext = plan.metadata.taskContext        │
│  （一次性快照，不随后续 plan.metadata 变更而更新）           │
└─────────────────────────────────────────────────────────────┘
```

#### 3.4 创建时注入校验（方案 B 监督机制）

task 创建时，后端执行注入检测，验证 taskContext 中的关键字段是否正确传播到 task 记录：

```typescript
// 伪代码：task 创建后校验
function validateTaskContextInjection(task, planTaskContext) {
  const errors = [];

  // development 类型必须有 requirementId
  if (planTaskContext?.requirementId && !task.requirementId) {
    errors.push(`task ${task._id} missing requirementId from plan.taskContext`);
  }

  // requirementId 值必须匹配
  if (planTaskContext?.requirementId && task.requirementId
      && String(task.requirementId) !== String(planTaskContext.requirementId)) {
    errors.push(`task ${task._id} requirementId mismatch: expected=${planTaskContext.requirementId}, actual=${task.requirementId}`);
  }

  if (errors.length > 0) {
    this.logger.error(`[TaskContext Injection Validation] ${errors.join('; ')}`);
  }
}
```

- **不阻断流程**：校验失败只打 error 日志，不影响 task 创建和执行
- **监督作用**：通过日志监控可发现注入链路异常，及时修复

#### 3.5 与旧 requirementId 字段的关系

| 字段 | 保留/废弃 | 说明 |
|------|-----------|------|
| `plan.metadata.requirementId` | 保留 | 向后兼容，新流程中由 taskContext.requirementId 同步写入 |
| `plan.metadata.taskContext.requirementId` | 新增 | 规范化的上下文字段 |
| `task.requirementId` | 保留 | task 创建时从 plan.metadata.taskContext 读取写入 |
| `tryBackfillRequirementId` | 废弃 | 不再需要从 LLM 输出中正则提取 |
| `extractRequirementAnchor` | 废弃 | 不再需要正则提取，直接读 plan.metadata.taskContext |

### 四、任务大纲

#### 4.1 格式

```json
{
  "outline": [
    { "step": 1, "title": "制定技术开发计划", "taskType": "development.plan" },
    { "step": 2, "title": "执行开发", "taskType": "development.exec" },
    { "step": 3, "title": "实现评估", "taskType": "development.review" }
  ]
}
```

#### 4.2 定位

大纲定位为**软参考**，planner 在后续 phaseGenerate 中可根据执行反馈动态调整。存储在 `plan.metadata.outline` 中持久化。

### 五、rd-workflow v0.5.0 调整

5 步缩减为 3 步：

| 旧步骤 | 新步骤 | 变更 |
|--------|--------|------|
| step1: 选定最高优先级需求 | 移除 | 归入 phaseInitialize |
| step2: 确认需求范围 | 移除 | 结构化数据流下无必要 |
| step3: 制定技术开发计划 | step1 | 重编号 |
| step4: 执行开发 | step2 | 重编号 |
| step5: 实现评估 | step3 | 重编号 |

rd-workflow v0.5.0 新增内容：
- phaseInitialize 行为定义（skill 驱动，非代码硬编码）
- 每个 step 明确 generate/pre_execute/execute/post_execute 四阶段行为
- 数据锚定规则改为系统自动注入（通过 taskContext 机制）
- 需求状态更新时机与新步骤编号对齐

rd-workflow 各阶段行为定义：

```
## phaseInitialize 行为
1. 调用 list-agents 获取可用 agent 列表
2. 调用 requirement.list(status=todo) 获取待办需求
3. 选择最高优先级需求，调用 requirement.get 获取详情
4. 生成任务大纲（outline），格式为 JSON 数组
5. 选定需求后系统自动标记为 assigned

## step1: 制定技术开发计划
- taskType: development.plan
- 执行角色: 技术专家（需具备 development_plan 能力）
- generate: 生成任务描述，必须包含 requirementId 和需求标题
- pre_execute: 更新需求状态为 in_progress，检查执行者工具匹配
- execute: 执行者分析需求，拆解开发子任务，评估技术风险
- post_execute: 验证输出包含开发计划，决定 generate_next

## step2: 执行开发
- taskType: development.exec
- 执行角色: 全栈开发（需具备 development_exec + opencode 能力）
- generate: 生成任务描述，引用 step1 的开发计划
- pre_execute: 检查 step1 输出可用
- execute: 按计划执行代码变更
- post_execute: 验证代码提交，决定 generate_next

## step3: 实现评估
- taskType: development.review
- 执行角色: 技术专家（同 step1）
- generate: 生成评审任务描述
- pre_execute: 更新需求状态为 review
- execute: 对照验收标准评估实现质量
- post_execute: 验证评审结论，决定 stop
```

### 六、需求状态更新映射（新）

| 时机 | 状态 | 触发方 |
|------|------|--------|
| phaseInitialize 完成 | `assigned` | Planner 工具调用（phaseInitialize 序列第 5 步） |
| step1 pre_execute | `in_progress` | planner pre-execute 决策 |
| step3 pre_execute | `review` | planner pre-execute 决策 |

### 七、需要消除的旧逻辑

| 旧逻辑 | 位置 | 处理方式 |
|--------|------|----------|
| step1 首部豁免分支（development） | `planner.service.ts:519-532` | 移除 |
| step1 首部豁免分支（非 development） | `planner.service.ts:533-546` | 移除 |
| `tryBackfillRequirementId` 正则提取 | `scene-optimization.service.ts:109-152` | 移除 |
| `extractRequirementAnchor` 正则提取 | `planner.service.ts:821-871` | 简化为直接读 plan.metadata.taskContext |
| step1 agent 分配兜底逻辑 | `incremental-planning.service.ts:973-989` | 移除 |
| rd-workflow step1/step2 定义 | `docs/skill/rd-workflow.md` | 移除，重编号 |
| 步骤引用 "首步豁免除外" | `planner.service.ts:582` | 移除 |
| rd-workflow 数据锚定规则（手动注入） | `docs/skill/rd-workflow.md` | 改为系统自动注入声明 |

## 执行步骤

| 顺序 | 任务 | 影响范围 | 预估 |
|------|------|----------|------|
| 1 | Schema 扩展：generationState 新增 `initialize` phase 枚举值 | `orchestration-plan.schema.ts` | 小 |
| 2 | taskContext 通用机制：buildTaskDescription 注入 + run 快照 + 创建校验 | `orchestration-context.service.ts`, `incremental-planning.service.ts` | 中 |
| 3 | Step Dispatcher 新增 `phaseInitialize()` | `orchestration-step-dispatcher.service.ts` | 大 |
| 4 | Planner Service 新增 initialize prompt 构建（从 skill 读取） | `planner.service.ts` | 中 |
| 5 | Planner Service 消除首步豁免分支 | `planner.service.ts` | 中 |
| 6 | phaseInitialize 产出解析：requirementId → taskContext、outline 写入 | `incremental-planning.service.ts` | 中 |
| 7 | Scene Optimization 移除 `tryBackfillRequirementId` | `scene-optimization.service.ts` | 小 |
| 8 | rd-workflow v0.5.0 重写 | `docs/skill/rd-workflow.md` | 中 |
| 9 | 编译验证（lint + build） | 全局 | 小 |

## 风险与依赖

1. **phaseInitialize 的 LLM 调用稳定性**：一轮 multi-tool-call，需确保 planner 能正确调用 3 个工具并输出大纲
2. **非 development 类型兼容**：phaseInitialize 对非 development 类型不查 requirement，需区分分支
3. **旧计划兼容**：已创建的旧计划（含 step1/step2 的 rd-workflow）不受影响，旧计划无 taskContext 字段时注入逻辑跳过
4. **前端展示**：`plan.metadata.outline` 和 `plan.metadata.taskContext` 新字段，前端可后续迭代展示
5. **taskContext 与 metadata.requirementId 双写**：过渡期两个字段同步写入，确保向后兼容
