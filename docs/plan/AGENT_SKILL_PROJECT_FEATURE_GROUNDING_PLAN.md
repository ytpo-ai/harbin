# Plan: AGENT_SKILL_PROJECT_FEATURE_GROUNDING_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [AGENT_SKILL](../feature/AGENT_SKILL.md) |
| 需求管理 ID |  |
| 所属项目 |  |
| OpenCode Session |  |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-28 |

## 2. 背景

当前 Agent 在执行研发类任务时，往往先扫代码再补文档，导致在“项目功能理解”阶段耗时高、上下文噪音大。

项目已经有 `docs/feature/` 功能文档体系（含模块索引、二级功能说明与追溯规则），但缺少一个可直接激活的 Skill，将“如何读取与提炼功能文档”固化为标准动作。

## 3. 目标

1. 新增一个面向研发任务前置理解的 Skill，作为 Agent 的功能认知入口。
2. 让 Agent 以 `docs/feature/` 为第一事实来源，形成“先功能文档、后代码扫描”的稳定行为。
3. 为 Agent 输出统一的功能认知结果模板，确保“足够了解项目功能”可审计、可复用。

## 4. 执行步骤

1. [x] 在 `docs/plan/` 新建本计划文档，并完成 requirement 拆解。
2. [x] 在 `docs/requirement/` 新建对应 requirement，明确验收条件和影响范围。
3. [x] 在 `docs/skill/` 新增 `project-feature-grounding.md`，定义 frontmatter、适用场景、读取顺序、输出契约。
4. [x] 在 Skill 中固化“最小读取集 + 按需扩展”规则：优先 `docs/feature/INDEX.md`、目标功能文档、`docs/feature/RULES.md`，不足再扩展到 `docs/guide/`、`docs/technical/`。
5. [x] 更新 `docs/feature/AGENT_SKILL.md` 的需求追溯，登记本次 plan 与 requirement。
6. [ ] 校验文档链接与命名规范，确保可通过 `skills/docs/sync` 同步。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | 新增项目功能认知 Skill（feature 文档优先） | [链接](../requirement/AGENT_SKILL_REQ-001_PROJECT_FEATURE_GROUNDING.md) | draft |

## 6. 关键影响点

- **后端**：无代码改动；复用现有 skill docs sync 与运行时加载机制。
- **前端**：无改动。
- **数据库**：执行 docs sync 后，`agent_skills` 将新增/更新 1 条 skill 记录。
- **API**：无新增接口；复用现有 `/skills/docs/sync`。
- **文档**：新增 plan/requirement/skill 文档，并更新 `AGENT_SKILL` 功能追溯。

## 7. 风险与依赖

- 依赖 `docs/feature/` 的内容完整度；若某些模块文档缺失，Skill 只能触发“补文档或降级查代码”提示。
- Skill 若被配置为强制激活，可能增加非研发场景提示噪音；当前设计默认用于研发/规划前置场景。
- 仅新增文档不会自动生效，需后续执行 `POST /skills/docs/sync` 完成入库同步。

## 8. 备注

- 本计划以“知识收敛”为核心，不涉及业务逻辑改动。
- 后续可在同一 skill 基础上追加模块化子模板（如 meeting/orchestration 专项功能认知模板）。
