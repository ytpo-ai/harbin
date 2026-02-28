# Skills Registry

本目录用于和数据库双轨维护 skills 体系。

- `library/`: Skill 实体文档（每个 skill 一个 Markdown 文件）
- `suggestions/`: SkillSuggestion 文档（每个建议一份记录）

## 维护规则

1. 数据库是事实源（source of truth）。
2. 每次 skill/suggestion 变更后，系统会自动同步对应 Markdown 文档。
3. 如文档与数据库不一致，可调用 `POST /api/skills/docs/rebuild` 从数据库重建。

## AgentSkillManager 责任

- 通过 `POST /api/skills/manager/discover` 从互联网检索候选 skills 并入库。
- 通过 `POST /api/skills/manager/suggest/:agentId` 基于上下文给出增强建议。
