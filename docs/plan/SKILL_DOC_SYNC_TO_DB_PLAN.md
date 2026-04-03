# Skill 文档主导同步改造计划

## 背景与目标

- 当前 skills 的“重建文档”是 DB -> 文档，产物仅元数据快照，无法承载 skill 正文策略。
- `docs/skill/*.md` 已长期作为策略内容的维护入口，更适合作为 source of truth。
- 本次改造目标为“文档主导”：新增“同步文档到 DB”能力，一键将配置目录下 skill 文档加载入库，并废弃原“重建 skill 文档”功能。

## 执行步骤

1. 设计同步输入规范：定义 `docs/skill/*.md` 的 frontmatter 到 Skill Schema 字段映射（name/slug/description/category/tags/status/version/provider/sourceType/confidenceScore/metadata）。
2. 实现文档加载服务：新增 `SkillDocLoaderService`，负责扫描目录、解析 frontmatter + markdown 正文、生成入库 payload，并对 `content` 计算 hash/size。
3. 实现同步逻辑：按 `slug` upsert 到 `agent_skills`，区分 inserted/updated/skipped，默认不删除 DB 中“仅存在于 DB”的历史记录。
4. 替换接口能力：将 `/skills/docs/rebuild` 替换为 `/skills/docs/sync`，返回同步统计结果；前端按钮改为“同步文档到 DB”。
5. 移除旧链路：下线 `SkillDocSyncService` 及 SkillService 中所有 DB -> 文档的触发调用（create/update/delete/discover/assign/rebuildIndex）。
6. 更新文档与验证：更新 guide/feature/api 文档与当日日志，补充单测并执行后端测试验证同步链路。

## 关键影响点

- 后端：`backend/apps/agents/src/modules/skills/*`（module/controller/service/new loader）
- 前端：`frontend/src/services/skillService.ts`、`frontend/src/pages/Skills.tsx`
- 配置文档：`docs/skill/*.md`
- 文档：`docs/guide/SKILL_LOAD.md`、`docs/feature/AGENT_SKILL.md`、`docs/api/agents-api.md`、`docs/dailylog/day/*.md`

## 风险与依赖

- frontmatter 结构历史上并不完全统一，需要解析器兼容常见 YAML 子集并提供容错日志。
- 若某些文档缺失必填字段（如 name/description），需提供 skip 与告警，避免污染线上数据。
- 文档主导后，前端手工编辑与文档内容可能出现漂移，需在文档中明确“以文档为准”的维护约束。
