---
name: project-feature-grounding
description: 项目功能认知技能，要求 Agent 以 docs/feature 为第一事实来源，先建立功能边界再进入代码实现。
metadata:
  author: opencode
  version: "1.0.0"
  language: zh-CN
  applies_to:
    - one-on-one-chat
    - meeting-chat
    - feature-understanding
    - issue-analysis
  tags:
    - project-grounding
    - feature-doc-first
    - project-context
    - chat-grounding
  capabilities:
    - module-scope-identification
    - feature-linkage-mapping
    - requirement-traceback
    - context-gap-detection
  risk_level: low
---

# Project Feature Grounding

## 1. 目标

在研发任务开始前，先让 Agent 基于 `docs/feature/` 建立“功能是什么、边界在哪、与哪些模块相关”的认知基线，再决定是否需要扫描代码。

该技能的核心价值是：

- 减少无差别扫代码造成的上下文噪音。
- 将任务理解阶段从“猜测功能”切换为“基于文档证据”。
- 输出结构化功能认知结果，便于后续 plan / requirement / 开发执行复用。

## 2. 强制读取顺序（文档优先）

收到研发类任务时，必须按以下顺序执行：

1. 读取 `docs/feature/INDEX.md`，定位一级模块与对应二级功能文档。
2. 读取目标二级功能文档（如 `docs/feature/AGENT_SKILL.md`）。
3. 读取 `docs/feature/RULES.md`，确认文档层级、追溯关系和维护约束。

只有当上述文档无法回答任务关键问题时，才可进入扩展读取：

4. 读取 `docs/guide/` 中相关现状总结。
5. 读取 `docs/technical/` 中相关技术设计。
6. 仍不足时再扫描代码，并在结果中标记“文档缺口”。

## 3. 执行流程

### Step 1: 功能定位

- 从用户诉求提取关键词，映射到一级模块和二级功能。
- 明确主模块与关联模块（例如：`agent/agent_skill` + `orchestration/task`）。

### Step 2: 边界确认

- 从 feature 文档提取：目标、核心逻辑、数据边界、接口边界。
- 识别“不在范围内”的模块，避免过度实现。

### Step 3: 追溯关联

- 找到该功能已存在的 plan / requirement / development / fix 链路。
- 如链路缺失，输出“缺失项”并建议补齐文档。

### Step 4: 缺口判定

- 判断文档是否足够支撑当前任务。
- 若不足，最小化补充读取（guide/technical），并记录补充依据来源。

### Step 5: 输出认知基线

- 输出统一结构（见第 4 节），作为后续开发或修复步骤的前置输入。

## 4. 输出契约（必须覆盖）

每次使用本技能后，输出结果至少包含以下 6 项：

1. `目标功能`: 所属一级/二级功能及本次任务主诉求。
2. `功能边界`: 本次应该做什么、不应该做什么。
3. `核心链路`: 关键模块调用或协作路径（文档级别）。
4. `追溯链接`: 对应的 feature / plan / requirement / development / fix 文档现状。
5. `信息缺口`: 当前文档不足点，以及是否需要补充代码扫描。
6. `下一步建议`: 在当前认知基线上推荐的执行动作。

## 5. 约束

- 禁止跳过 `docs/feature/INDEX.md` 直接扫代码。
- 禁止把 `docs/dailylog/` 作为功能事实来源。
- 功能边界不明确时，先标记假设与风险，再进入实现。
- 如果发现 feature 文档过时，应在任务结束时补充更新建议。

## 6. 示例（精简）

```text
目标功能: agent/agent_skill（主），orchestration/task（关联）
功能边界: 本次仅新增“功能认知 skill”，不改 skill runtime 逻辑
核心链路: docs/feature -> docs/skill -> skills/docs/sync -> agent_skills
追溯链接: AGENT_SKILL feature 已存在；本次新增 plan+requirement
信息缺口: feature 文档未覆盖某些最新 API 字段，建议补充 technical 引用
下一步建议: 先落盘 skill 文档，再执行 docs/sync 验证入库
```
