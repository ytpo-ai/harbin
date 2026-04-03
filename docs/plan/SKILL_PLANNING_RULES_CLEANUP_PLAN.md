# Skill planningRules 字段清理计划

## 背景

- `planningRules` 已不参与当前 skill 激活、匹配和编排执行链路。
- 现有实现仅保留了该字段的解析、同步、存储与对比，形成冗余数据与维护成本。

## 执行步骤

1. 清理 Schema 与类型：移除 `agent_skills` 的 `planningRules` 字段定义及相关类型声明。
2. 清理文档同步解析：移除 skill 文档 frontmatter 中 `planningRules` 的解析与归一化流程。
3. 清理 SkillService 逻辑：移除同步 payload 写入与 metadata 变更比较中的 `planningRules` 分支。
4. 清理遗留脚本：删除 `skill-planning-rules` seed 脚本，避免继续写入废弃字段。
5. 补充迁移脚本：新增 migrate 脚本，对 `agent_skills` 批量 `$unset planningRules`，支持 dry-run。
6. 更新说明文档：同步更新 `docs/guide/SKILL_LOAD.md`，去除对 `planningRules` 的有效能力描述。

## 关键影响点

- 后端：`backend/apps/agents/src/schemas/agent-skill.schema.ts`
- 后端：`backend/apps/agents/src/modules/skills/skill-doc-loader.service.ts`
- 后端：`backend/apps/agents/src/modules/skills/skill.service.ts`
- 脚本：`backend/scripts/seed/*skill-planning-rules*`、`backend/scripts/migrate/*`
- 文档：`docs/guide/SKILL_LOAD.md`

## 风险与回滚

- 风险：外部调用方若依赖 `planningRules` 返回字段，将看到字段缺失。
- 缓解：先完成全局引用清理；迁移脚本支持 dry-run，确认后执行。
- 回滚：仅需恢复字段定义与同步逻辑，并从备份恢复历史字段值。
