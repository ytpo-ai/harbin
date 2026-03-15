# Agent Skill 关系收敛开发总结

## 交付概览

本次按计划完成 Skills 关系模型收敛，核心目标是：

1. 以 `Agent.skills` 作为 Agent 启用技能唯一来源
2. 废弃 `AgentSkill` 关系模型
3. 删除 `SkillSuggestion` 及建议审核全链路

本次按要求不执行历史数据迁移，旧集合数据不参与兼容。

## 主要实现内容

### 1) 数据模型与类型收敛

- `Agent` 新增 `skills?: string[]` 字段：`backend/src/shared/schemas/agent.schema.ts`
- 后端共享类型同步：`backend/src/shared/types.ts`
- 前端类型同步：`frontend/src/types/index.ts`
- 删除以下 schema：
  - `backend/apps/agents/src/schemas/agent-skill.schema.ts`
  - `backend/apps/agents/src/schemas/skill-suggestion.schema.ts`
  - `backend/src/shared/schemas/agent-skill.schema.ts`
  - `backend/src/shared/schemas/skill-suggestion.schema.ts`

### 2) Skills 后端逻辑重构

#### 绑定逻辑

- `POST /skills/assign` 改为直接写 `agent.skills`
  - 绑定：`$addToSet`
  - 解绑：`enabled=false` 时 `$pull`
- 删除 assignment 元信息结构（proficiency/assignedBy/note）

核心文件：

- `backend/apps/agents/src/modules/skills/skill.service.ts`
- `backend/apps/agents/src/modules/skills/skill.controller.ts`
- `backend/apps/agents/src/modules/skills/skill.module.ts`

#### 查询逻辑

- `getAgentSkills` 改为基于 `agent.skills` 聚合 `Skill`
- `getSkillAgents` 改为查询 `agents.skills` 包含该 skillId 的 Agent
- `getAllSkillAgents` 改为遍历 Agent 文档中的 `skills` 字段

### 3) Suggestion 全链路删除

- 删除建议生成/查询/审核 API 与 service 逻辑
- 删除 skill 文档索引中 suggestion 章节与 suggestion 文档同步逻辑

核心文件：

- `backend/apps/agents/src/modules/skills/skill.service.ts`
- `backend/apps/agents/src/modules/skills/skill.controller.ts`
- `backend/apps/agents/src/modules/skills/skill-doc-sync.service.ts`

### 4) Agent 运行时与 Memo 聚合同步

- Agent 执行链路读取启用技能改为：`agent.skills -> Skill`
- Identity/Evaluation 聚合中的技能来源改为 `agent.skills`

核心文件：

- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/apps/agents/src/modules/agents/agent.module.ts`
- `backend/apps/agents/src/modules/memos/identity-aggregation.service.ts`
- `backend/apps/agents/src/modules/memos/evaluation-aggregation.service.ts`
- `backend/apps/agents/src/modules/memos/memo.module.ts`

### 5) 前端同步

- 删除 Skills 页面“建议与审核”区块及相关状态/请求
- `skillService` 删除 suggestion API，绑定返回结构改为新契约

核心文件：

- `frontend/src/pages/Skills.tsx`
- `frontend/src/services/skillService.ts`

## API 契约变化

- 保留：`POST /api/skills/assign`，语义改为写入 `Agent.skills`
- 删除：
  - `POST /api/skills/manager/suggest/:agentId`
  - `GET /api/skills/suggestions/agents/:agentId`
  - `PUT /api/skills/suggestions/:id`
- `POST /api/skills/docs/rebuild` 返回结构由 `{ skills, suggestions }` 简化为 `{ skills }`

## 测试与验证

已执行并通过：

- 后端：`npm run lint`
- 后端：`npm run build:agents`
- 后端：`npm test -- skill.service.spec.ts identity-aggregation.service.spec.ts`
- 前端：`npm run build`

## 文档更新

- 计划文档：`docs/plan/AGENT_SKILL_RELATION_SIMPLIFICATION_PLAN.md`
- 功能文档：`docs/feature/AGENT_SKILL.md`
- API 文档：`docs/api/agents-api.md`
- 日志文档：`docs/dailylog/day/2026-03-15.md`

## 风险与结论

- `AgentSkill` 元信息能力（熟练度、分配来源、备注）已按需求下线。
- 由于明确不做迁移，旧集合数据不会自动回填到 `Agent.skills`。
- 当前系统已完成关系收敛与建议流删除，后续技能能力以 `Agent.skills` 为单一事实源继续演进。
