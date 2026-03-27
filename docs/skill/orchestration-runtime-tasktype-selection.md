---
name: orchestration-runtime-tasktype-selection
description: Orchestration 任务类型选择与迁移规则，统一在 pre_execute 阶段按计划上下文推断 runtimeTaskType。
metadata:
  author: opencode
  version: "1.0.0"
  language: zh-CN
  applies_to:
    - orchestration
    - orchestration-planner
    - orchestration-dispatcher
  tags:
    - runtimeTaskType
    - pre-execute
    - task-type-migration
    - orchestration
  risk_level: medium
---

# Orchestration Runtime TaskType Selection

用于约束编排系统中的任务类型选择：任务创建阶段先写入 `taskType`（默认 `general`），再在 `phasePreExecute` 推断并落库 `runtimeTaskType`。

## 1) 生效边界

- 适用于 Orchestration 的增量编排与执行链路。
- 适用于 planner 生成、任务重编排、执行前决策。
- 不适用于 agent 内部非编排上下文的自定义 taskType。

## 2) 当前合法类型

- `general`
- `research`
- `development.plan`
- `development.exec`
- `development.review`

## 3) 已删除类型（禁止再产出）

- `development`
- `review`
- `code_review`
- `email`
- `planning`
- `external_action`

## 4) 迁移语义（旧值到新值）

- `development` -> `development.exec`
- `review` / `code_review` -> `development.review`
- `planning` -> `development.plan`
- `email` / `external_action` -> `general`（并通过任务语义重写实现外部动作，不再依赖独立 taskType）

## 5) 统一推断规则（phasePreExecute）

输入上下文：

- `plan.domainType`
- `plan.sourcePrompt`
- `step`
- `task.title`
- `task.description`
- `task.runtimeTaskType`（若已有且合法，优先复用）
- `task.taskType`（若已有且合法，作为 runtime 推断的首选来源）

决策规则（按优先级）：

1. 若已有合法 `runtimeTaskType`，直接使用。
2. 若 `taskType` 合法，直接映射为 `runtimeTaskType`。
3. `domainType=research` -> `research`。
4. `domainType=development` -> 根据 step 定义来确定  `development.plan` ｜ `development.exec` `development.review` | `general`（兜底）。
5. `domainType=general` -> `general`（兜底）。

## 6) 与执行链路的约束

- 执行引擎不再做兜底分类；仅使用 `override > persisted > general`。
- `planner` 输出 JSON 包含 `task.taskType`，缺失时系统兜底为 `general`。
- 任务创建与 redesign 阶段写入 `taskType`，`runtimeTaskType` 仍由 pre 阶段回写。

## 7) 重试策略约束

- `development.plan`、`development.exec`、`development.review` 默认禁用自动生成模式下 `retry` 原地重试。
- post 阶段返回 `retry` 时需改写为 `redesign` 路径。

## 8) 校验清单

- [ ] planner prompt 要求输出 `taskType`
- [ ] 新任务创建写入 `taskType` 默认值
- [ ] 新任务创建不写入 `runtimeTaskType`
- [ ] `phasePreExecute` 推断并持久化 `runtimeTaskType`
- [ ] 执行引擎未引入额外关键词分类分支
- [ ] 不存在对已删除类型的 enum/白名单/分支判断
