---
name: cto-rd-workflow
description: 在 CTO 识别到需要处理开发需求时触发，执行轻量研发流程（核心版）：信息采集、理解分类、方案、开发、验收、发布。
metadata:
  author: opencode
  version: "0.3.0"
  language: zh-CN
  applies_to:
    - cto-demand-triage
    - requirement-planning
    - multi-agent-rd
  tags:
    - cto
    - rd-workflow
    - requirement-triage
    - planning
    - multi-agent
  capabilities:
    - requirement-clarification
    - demand-classification-and-tagging
    - technical-planning
    - state-tracking
    - human-escalation
  risk_level: medium
  changelog:
    - version: "0.3.0"
      date: "2026-03-20"
      changes:
        - 新增 Step0 强制信息采集阶段，planning 前必须调用工具获取事实
        - Step1 + Step2 合并为 CTO 内部动作，不作为独立编排 task
        - 新增「Step 到 Task 映射规则」，禁止 step 与 task 一一对应
        - 新增「Task Description 质量红线」，要求引用具体文件路径和字段
        - 新增「执行者分配校验规则」，CTO 不得同时执行 Step3-Step5
        - 新增「反模式清单」，列举常见低质量 plan 行为
---

# CTO 研发流程 Skill（核心版）

当 CTO 识别到当前事项是研发需求（而非纯咨询）时，触发本 skill。

适用：`feature` / `fix` / `doc`。

不包含：独立需求受理流程。

## 1. 流程原则

- 保持轻量可执行，优先跑通。
- **先采集事实，再做判断**——任何输出前必须先调用工具读取相关文档或代码。
- `step0`（信息采集）和 `step1`（理解+分类）由 CTO 在 planning 阶段内部完成，**不作为独立编排 task**。
- `step2`（方案）完成前，不分配开发 agent。
- `step2` 必须包含复杂度预估。
- `step2` 如落盘文档，必须列出路径。
- `step3` 必须基于 `step2` 输出执行。
- `step4` 采用轻量验收，人类兜底。

## 2. 标准流程

### Step0 信息采集（CTO · planning 阶段内部动作）

**这是所有后续步骤的前提，不可跳过。**

CTO 在输出任何计划或判断前，必须完成以下信息采集：

1. **读取 feature 文档**：通过 `docs-read` 或 `repo-read` 读取需求涉及模块的 2 级功能文档（路径参考 `docs/feature/INDEX.md`）
2. **读取相关代码**（按需）：若 feature 文档信息不足以支撑方案，通过 `repo-read` 读取关键代码文件
3. **检索历史备忘录**（按需）：通过 `search-memo` 检索相关历史上下文

#### 采集完成的判定标准

以下信息中至少获取 3 项，才可进入 Step1：

- [ ] 涉及的前端页面/组件文件路径
- [ ] 涉及的后端接口/服务文件路径
- [ ] 当前数据结构（接口返回的字段清单）
- [ ] 现有 UI 展示逻辑（渲染方式、已有筛选/分页等）
- [ ] 已知的问题或限制（从代码或文档中发现的）

#### 采集结果格式

```
已读取文档：
- docs/feature/INNER_MESSAGE.md（内部消息功能设计、数据结构、核心逻辑）
- docs/feature/MESSAGE_CENTER.md（消息中心三 Tab 设计、已读管理）

已读取代码：
- frontend/src/pages/MessageCenter.tsx（732 行，内部消息 Tab 渲染在 L691-L703）
- frontend/src/services/messageCenterService.ts（InnerMessageCenterItem 接口定义）
- backend/src/modules/message-center/message-center.controller.ts（listInnerMessages 接口）

发现的关键信息：
- senderAgentId/receiverAgentId 当前直接显示 ID，未做名称映射
- 内部消息列表无折叠/展开，长内容直接撑开
- controller L80-101: listInnerMessages 未传 receiverAgentId 过滤
```

### Step1 理解需求 + 分类打标（CTO · planning 阶段内部动作）

基于 Step0 采集的事实，CTO 完成需求理解和分类。**这不是一个编排 task，而是 CTO 在输出计划 JSON 前的内部思考过程。**

必选输出（体现在计划 JSON 的第一个 task 的 description 中）：

- 需求目标（一句话）
- 分类：`type=feature|fix|doc`，`level=L1|L2|L3`，`module`，`priority`，`risk`
- 影响范围（具体到文件路径）
- 从文档/代码中发现的现状问题（列举 2-5 条具体痛点）
- 不确定项（如有）

### Step2 形成方案和计划（技术专家）

必选输出：方案概述、任务拆解、复杂度预估、验收思路、文档落盘清单（如有）。

**方案必须引用 Step0 中获取的具体信息**，包括：
- 需要修改的文件路径和行号范围
- 需要修改的数据字段或接口
- 前后端改动的边界划分

### Step3 执行开发与补充文档（全栈开发）

CTO 基于 `step2` 输出和 agent 能力分配任务，开发按方案落地并补充文档。

**分配给开发 agent 的 task description 必须包含：**
- 具体的文件路径（不能只写"前端改造"）
- 改动方向（不能只写"优化展示"）
- 验收标准（可量化或可验证的条件）

### Step4 验收（技术专家或人）

轻量检查：编译/构建、测试（可行范围）、代码与文档一致性、与 `step2` 目标一致性。

- 通过：进入待发布
- 不通过：明确问题并退回 `step3`

### Step5 发布（运维工程师）

由具备权限的运维执行发布。

## 3. Step 到 Task 映射规则

**关键原则：Step 是思考框架，不是 Task 模板。**

### 禁止行为

- 禁止将 Step0/Step1 映射为独立编排 task（它们是 CTO 在 planning 阶段的内部动作）
- 禁止将 6 个 Step 一一对应为 6 个 task
- 禁止输出 description 中不包含具体文件/接口/字段信息的 task

### 映射参考

| Step | 是否映射为 Task | 说明 |
|------|----------------|------|
| Step0 信息采集 | **否** | CTO 在 planning 阶段内部完成 |
| Step1 理解+分类 | **否** | CTO 在 planning 阶段内部完成，结论体现在其他 task 的 description 中 |
| Step2 方案设计 | **视情况** | 若需要技术专家独立出方案，可作为 task；若 CTO 可直接输出方案，则合并到开发 task 的 description 中 |
| Step3 开发实现 | **是** | 核心开发 task，可按前端/后端/接口拆分为多个 task |
| Step4 验收 | **是** | 验收 task |
| Step5 发布 | **视情况** | 若需发布则作为 task，否则省略 |

### 典型的 Task 数量

- 简单需求（L2 单模块优化）：**3-4 个 task**
- 中等需求（跨前后端联调）：**4-5 个 task**
- 复杂需求（多模块协作）：**5-7 个 task**

## 4. Task Description 质量红线

每个 task 的 description 必须满足以下条件，否则视为不合格：

### 必须包含（至少 2 项）

- 具体的文件路径（如 `frontend/src/pages/MessageCenter.tsx`）
- 具体的改动方向（如 "将 senderAgentId 替换为 agent 名称显示"）
- 具体的接口或字段（如 "listInnerMessages 接口需要 join agent 名称"）
- 可验证的完成标准（如 "构建通过 + 列表/筛选/分页/空态四路径可用"）

### 禁止出现

- 纯流程性描述（如 "基于 Step3 方案实施前端改造"——没有任何具体信息）
- 重复 skill 模板原文（如 "明确需求目标、影响范围、已知信息、不确定项"——这是模板不是 description）
- 无法被执行 agent 直接理解的抽象表述

### 合格示例

```
❌ 不合格：
"基于Step3方案实施前端改造：完成内部消息列表/详情展示优化、样式与组件调整"

✅ 合格：
"修改 frontend/src/pages/MessageCenter.tsx L691-L703 内部消息渲染区域：
1. senderAgentId/receiverAgentId 从 ID 改为 agent 名称显示（复用已有 agents 查询）
2. 消息 content 超过 3 行时折叠，点击展开
3. status 标签增加颜色区分（processed=绿、failed=红、processing=蓝、sent=灰）
4. 时间显示改为相对时间格式
验收标准：pnpm build 通过，列表/筛选/分页/空态四路径正常"
```

## 5. 执行者分配规则

### 角色分配表

| Step | 角色 | 分配理由 |
|------|------|----------|
| Step0 信息采集 | CTO | planning 阶段内部动作，不占编排 task |
| Step1 理解+分类 | CTO | planning 阶段内部动作，不占编排 task |
| Step2 方案设计 | 技术专家 | 需要较强抽象与技术取舍能力 |
| Step3 开发实现 | 全栈开发 | 可按任务拆分给多个开发 agent |
| Step4 验收 | 技术专家 或 人 | 需要综合判断一致性，人类作为争议兜底 |
| Step5 发布 | 运维工程师 | 发布属于权限动作 |

### 分配校验规则

- **CTO 不得同时作为 Step2、Step3、Step4 的执行者**——如果 CTO 把所有活都揽在自己身上，编排就失去了意义
- 若团队中只有 CTO 一个 agent 有技术专家能力，CTO 可执行 Step2，但 Step3 必须分配给开发 agent
- 开发 task 必须分配给开发 agent，不得分配给 CTO

## 6. 状态流转

建议状态：

- `analyzing`（Step0 + Step1）
- `pending-meeting`
- `planning`（Step2）
- `ready-for-dev`
- `in-dev`（Step3）
- `validating`（Step4）
- `changes-requested`
- `ready-for-release`
- `done`
- `cancelled`

主流转：

- `analyzing -> planning`
- `analyzing -> pending-meeting -> analyzing`
- `planning -> ready-for-dev -> in-dev -> validating`
- `validating -> ready-for-release -> done`
- `validating -> changes-requested -> in-dev`

约束：未到 `ready-for-dev` 前，不得指定开发 agent。

## 7. 人类介入触发条件

- `step0/step1`：目标或边界不清，且 feature 文档和代码均无法提供足够信息
- `step2`：多方案成本/风险差异明显，需要拍板
- `step3`：方案信息不足导致无法继续，或多 agent 职责冲突
- `step4`：验收结果存在争议，无法自动判断是否通过
- `step5`：发布需要人工权限/窗口/风险确认

## 8. 使用约束

- 不因细节未满分阻塞全流程。
- 不在 `step2` 前提前派发开发任务。
- 不把可自行判断的问题过早升级为会议。
- 不在 `step4` 过度加重门禁。
- **不在未调用任何工具的情况下输出计划 JSON。**
- **不将 skill 的 step 模板直接映射为 task 列表。**

## 9. 反模式清单

以下行为在计划评审中会被标记为不合格：

| 反模式 | 表现 | 正确做法 |
|--------|------|----------|
| 模板搬运 | 将 Step1-Step6 原样映射为 6 个 task | Step0/Step1 内部完成，task 只包含需要编排执行的动作 |
| 空壳 task | description 中无任何具体文件/接口/字段信息 | 每个 task 至少引用 2 项具体信息 |
| 万能执行者 | CTO 同时执行所有 task | 开发 task 分配给开发 agent，验收分配给技术专家或人 |
| 不必要的汇总 | 非编排/分配/通知类需求添加"汇总输出编排结果 JSON" task | 仅当需求本身涉及编排/分配/通知时才添加 |
| 跳过信息采集 | 未调用 docs-read/repo-read 就输出计划 | Step0 是强制前置动作 |
| 分类占 task | 将"分类与打标"作为独立编排 task | 分类是 CTO 的判断动作，在 planning 阶段完成 |

## 10. 附录引用

详细补充见：`docs/skill/cto-rd-workflow-appendix.md`

附录包含：

- 触发词与触发判定规则
- 各 step 建议输出模板
- pending-meeting 会议模板
