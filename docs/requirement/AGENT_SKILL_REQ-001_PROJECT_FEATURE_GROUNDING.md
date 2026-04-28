# Requirement: AGENT_SKILL_REQ-001_PROJECT_FEATURE_GROUNDING

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [AGENT_SKILL](../feature/AGENT_SKILL.md) |
| 所属 Plan | [AGENT_SKILL_PROJECT_FEATURE_GROUNDING_PLAN](../plan/AGENT_SKILL_PROJECT_FEATURE_GROUNDING_PLAN.md) |
| 需求管理 ID |  |
| OpenCode Session |  |
| 状态 | draft |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

`docs/feature/` 已沉淀项目功能知识，但 Agent 缺少统一技能来读取、筛选、归纳这些内容，导致任务前置理解不稳定，容易重复扫代码。

### 2.2 目标

新增一个 `docs/skill/project-feature-grounding.md`，让 Agent 在研发/规划任务开始前能基于功能文档快速建立完整功能认知，并输出结构化结论。

### 2.3 验收条件

- [ ] 已新增 `docs/skill/project-feature-grounding.md`，包含有效 frontmatter（`name`、`description`、`metadata`）
- [ ] Skill 明确规定“功能文档优先”读取顺序：`docs/feature/INDEX.md` -> 对应二级功能文档 -> `docs/feature/RULES.md`
- [ ] Skill 明确规定“按需扩展”路径：文档不足时再读取 `docs/guide/` 与 `docs/technical/`
- [ ] Skill 提供统一输出契约（功能边界、核心链路、相关文档追溯、风险与缺口）
- [ ] `docs/feature/AGENT_SKILL.md` 已补充本 plan / requirement 的需求追溯记录

## 3. 技术方案摘要

通过文档技能化方式固化 Agent 功能认知流程，不修改运行时代码：

1. 在 `docs/skill/` 增加新 Skill 文档，定义触发场景、执行步骤与输出格式。
2. 复用现有 Skill 同步机制（`/skills/docs/sync`）将文档载入 skill 库。
3. 在 feature 文档追溯表登记本次 plan 与 requirement，保证可审计。

### 影响范围

- **后端**：无代码改动
- **前端**：无改动
- **数据库**：执行同步后 `agent_skills` 新增/更新 1 条 skill
- **API**：无新增接口

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/AGENT_SKILL_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| - | - | - |

## 5. 备注

- 该需求聚焦“项目功能认知标准化”，不是业务功能迭代。
- 若后续需要强制自动激活，可在不改正文结构的前提下调整 skill 标签策略。
