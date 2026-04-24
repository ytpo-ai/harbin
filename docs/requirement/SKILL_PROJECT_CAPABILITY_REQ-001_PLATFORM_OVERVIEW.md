# Requirement: SKILL_PROJECT_CAPABILITY_REQ-001_PLATFORM_OVERVIEW

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [AGENT_SKILL](../feature/AGENT_SKILL.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [SKILL_PROJECT_CAPABILITY_EMBED_PLAN](../plan/SKILL_PROJECT_CAPABILITY_EMBED_PLAN.md) |
| 状态 | draft |
| 创建日期 | 2026-04-23 |
| 最后更新 | 2026-04-23 |

## 2. 需求描述

### 2.1 背景

CTO Agent 在规划与决策场景中需要了解平台全局能力（模块、资源、孵化项目），当前只能通过 `repo_read` 逐文件读取 `docs/feature/` 下的文档，效率低、token 消耗大。

### 2.2 目标

编写 `docs/skill/platform-capability-overview.md` 作为 CTO 视角的平台能力总览 skill，通过 `docs/sync` 同步入库后绑定给 CTO Agent，使其在规划阶段 skill 激活时零 tool_call 获得平台能力认知。

### 2.3 验收条件

- [ ] `docs/skill/platform-capability-overview.md` 文件已创建，内容覆盖全部一级功能模块
- [ ] frontmatter 包含 `roleInPlan:planner,planner_initialize,planner_pre_execution:must` 激活 tag
- [ ] content 总字符数 <= 4000（`SKILL_CONTENT_MAX_INJECT_LENGTH` 默认上限）
- [ ] 执行 `POST /skills/docs/sync` 后，`agent_skills` 中生成对应记录
- [ ] 该 skill 已绑定给 CTO Agent
- [ ] CTO Agent 在编排规划场景中能够被激活并注入能力摘要（通过 session 消息验证）

## 3. 技术方案摘要

无代码改动。利用现有机制：
1. 编写 skill markdown 文档（含 YAML frontmatter）
2. 通过 `/skills/docs/sync` API 同步到 `agent_skills` 集合
3. 通过 `/skills/assign` API 绑定给 CTO Agent
4. 运行时由 `ToolsetContextBuilder` + `ContextStrategyService` 按 tag 规则自动激活并注入 content

### 影响范围

- **后端**：无代码改动
- **前端**：无改动
- **数据库**：`agent_skills` 新增 1 条记录
- **API**：无新增

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| 待创建 | 待创建 |

### 4.2 Fix 记录

无

## 5. 备注

- 内容需根据 `docs/feature/INDEX.md` 提炼，保持摘要粒度（模块 + 能力描述，不含技术实现细节）
- 后续功能模块增减时需同步更新此 skill 文档并重新 sync
