# Requirement: SKILL_PROJECT_CAPABILITY_REQ-002_INCUBATION_HANDBOOK

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | [AGENT_SKILL](../feature/AGENT_SKILL.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [SKILL_PROJECT_CAPABILITY_EMBED_PLAN](../plan/SKILL_PROJECT_CAPABILITY_EMBED_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-23 |
| 最后更新 | 2026-04-23 |

## 2. 需求描述

### 2.1 背景

孵化项目负责人 Agent 在项目规划场景中需要了解本项目可用的资源与操作能力，当前只能通过 tool_call 逐文件读取文档，效率低。

### 2.2 目标

编写 `docs/skill/incubation-project-handbook.md` 作为孵化项目负责人视角的能力手册 skill 模板。每个孵化项目基于此模板创建专属 skill（如 `incubation-project-{slug}-handbook.md`），同步入库后绑定给对应项目负责人 Agent。

### 2.3 验收条件

- [ ] `docs/skill/incubation-project-handbook.md` 模板文件已创建
- [ ] 模板内容覆盖：项目可管理资源类型、关键操作与工具映射、全局资源调用规则、模板初始化流程
- [ ] frontmatter 包含 `roleInPlan:planner,planner_initialize,planner_pre_execution:must` 激活 tag
- [ ] content 总字符数 <= 4000
- [ ] 基于模板为至少一个已有孵化项目创建专属 skill 并绑定给项目负责人 Agent
- [ ] 项目负责人 Agent 在编排规划场景中能够被激活并注入项目能力摘要

## 3. 技术方案摘要

无代码改动。操作流程：
1. 编写通用模板 `incubation-project-handbook.md`
2. 为每个孵化项目复制模板并填入项目专属信息（项目名、目标、当前资源统计）
3. 通过 `/skills/docs/sync` 同步入库
4. 通过 `/skills/assign` 绑定给对应项目负责人 Agent

### 影响范围

- **后端**：无代码改动
- **前端**：无改动
- **数据库**：`agent_skills` 每个孵化项目新增 1 条记录
- **API**：无新增

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

### 4.2 Fix 记录

无

## 5. 备注

- 模板中使用占位符（如 `{project_name}`、`{project_goal}`）标记需项目专属填充的部分
- 新建孵化项目时，需同步创建对应的 skill 文档——后续可考虑在孵化项目创建 API 中自动化此步骤（不在本 REQ 范围）
- 项目资源变化时需手动更新对应 skill 文档并重新 sync
