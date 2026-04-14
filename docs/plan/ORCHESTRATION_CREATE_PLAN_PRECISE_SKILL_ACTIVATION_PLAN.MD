# ORCHESTRATION CREATE PLAN PRECISE SKILL ACTIVATION PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [ORCHETRATION_TASK](../feature/ORCHETRATION_TASK.md) |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | in-progress |
| 优先级 | high |
| 创建日期 | 2026-04-14 |

## 2. 背景

- 研发流程存在多个 workflow skill 版本，`domainType:development:*` 与 `phase:initialize:*` 标签重叠，默认标签激活模式下难以精确命中目标 skill。
- 编排后端已支持 `strategy.skillActivation.mode='precise'` + `skillIds` 精确激活，但创建计划前端没有 skill 选择入口，创建 DTO 也未透传该字段。

## 3. 目标

- 在创建 Plan 流程中，基于选中的 `domainType` 与 Planner Agent 绑定 skills，提供可选 skill 列表。
- 用户选择具体 skill 后，创建请求自动写入 `strategy.skillActivation={ mode:'precise', skillIds:[...] }`。
- 未选择 skill 时保持现状（不传 `skillActivation`，继续走标准标签激活）。

## 4. 执行步骤

1. [x] 梳理前端创建链路、后端 DTO/Service 及 skill 查询接口，确认改动点。
2. [x] 后端 `CreatePlanFromPromptDto` 增加 `skillActivation` 入参并补充校验。
3. [x] 后端创建 Plan 逻辑写入 `strategy.skillActivation`，保持字段可选和向后兼容。
4. [x] 前端创建弹窗新增“Skill 精确激活”筛选区：依据 `plannerAgentId + domainType` 拉取并过滤 skills。
5. [x] 前端创建提交映射：选择 skill 时传 `mode='precise' + skillIds`；未选中则不传。
6. [x] 回归验证创建与复制到新建场景，并更新 feature/requirement/dailylog 文档。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-002 | 创建 Plan 支持按 domainType 选择并精确激活 skill | [ORCHESTRATION_TASK_REQ-002_CREATE_PLAN_PRECISE_SKILL_ACTIVATION](../requirement/ORCHESTRATION_TASK_REQ-002_CREATE_PLAN_PRECISE_SKILL_ACTIVATION.md) | in-review |

## 6. 关键影响点

- **后端**：`CreatePlanFromPromptDto`、Plan 创建时 `strategy` 字段映射。
- **前端**：创建弹窗 UI、创建页状态管理、payload 类型定义。
- **数据库**：复用既有 `orchestration_plans.strategy.skillActivation` 字段。
- **API**：`POST /orchestration/plans/from-prompt` 入参扩展（向后兼容）。
- **文档**：plan/requirement/feature/dailylog 同步更新。

## 7. 风险与依赖

- 风险：`domainType` 与 tags 匹配规则不统一导致 skill 列表为空。
  - 处理：仅采用 `domainType:<value>:(must|enable)` 标签作为筛选条件，空结果时给出无可选项提示。
- 风险：未选择 Planner Agent 时无法确定技能集合。
  - 处理：仅在已选 Planner Agent 后展示 skill 选择区域。

## 8. 备注

- 本需求为单链路改造，按 `1 plan -> 1 requirement` 执行。
