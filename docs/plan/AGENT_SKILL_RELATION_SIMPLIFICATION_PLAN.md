# Agent Skill 关系收敛与 Suggestion 下线计划

## 背景

- 当前 Agent 与 Skill 通过 `agentskills` 集合维护绑定关系；同时存在 `skillsuggestions` 建议流。
- 需求改为：在 `Agent` 上新增 `skills: string[]` 存储已启用 skillId，废弃 `agentskills`；同时删除 `SkillSuggestion` 及相关逻辑。
- 本次明确不做历史数据迁移，旧集合数据忽略。

## 执行步骤

1. 调整 Schema 与类型定义：在 `Agent` 增加 `skills` 字段，移除 `AgentSkill`、`SkillSuggestion` 的模型依赖与类型引用。
2. 重构后端 Skills 业务：绑定/查询逻辑改为基于 `agent.skills`，接口返回去除 assignment 结构。
3. 清理 Suggestion 能力：删除建议生成、审核、应用相关 API、服务方法、DTO 与模块装配。
4. 同步前端 Skills 页面与服务类型：移除 suggestion UI 与调用，适配新的 Agent-Skill 返回结构。
5. 更新文档与验证：更新功能文档与当日日志，执行 lint/typecheck/必要测试，确认系统可编译运行。

## 关键影响点

- 后端：`modules/skills`、`modules/agents`、`modules/memos`、相关 schema/DTO/module。
- 前端：`pages/Skills.tsx`、`services/skillService.ts`、`types/index.ts`。
- API：Skills 绑定相关响应结构变化（不再返回 assignment）。

## 风险与处理

- 风险：`agentskills` 元信息（proficiency、assignedBy、note）不再可用。
  - 处理：本次按需求直接下线，不保留兼容层。
- 风险：前后端契约变化导致页面报错。
  - 处理：同步调整前端类型与调用，并通过构建检查兜底。
