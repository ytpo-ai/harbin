# Agent Skill（技能管理与绑定）

## 1. 功能设计

### 1.1 目标

- 提供统一的技能库（Skill Library）管理能力，支持创建、更新、下线与检索。
- 提供 Agent 与 Skill 的绑定能力，基于 `Agent.skills` 维护启用技能列表。
- 采用“文档主导 + DB 运行时消费”模式，以 `docs/skill/*.md` 为技能配置事实来源。
- 采用“元数据先行 + 正文按需加载”的渐进式加载策略，降低列表与路由链路负载。

### 1.2 数据结构

当前核心模型位于 `backend/apps/agents/src/schemas/`：

| 集合 | Schema 文件 | 说明 |
|------|-------------|------|
| `agent_skills` | `agent-skill.schema.ts` | 技能主表（name/slug/description/category/tags/status/source/provider/version 等） |
| `agents` | `agent.schema.ts` | Agent 主表中的 `skills: string[]` 维护已启用 skillId |

`agent_skills` 的状态语义：

- `active`：正式可用，默认可推荐。
- `experimental`：实验能力，可推荐但优先级通常低于 active。
- `deprecated`：已弃用，不建议新绑定或推荐。
- `disabled`：禁用下线，不参与推荐与新绑定。

目标演进（文档配置 + DB + Redis）：

- `metadata`：用于技能识别、路由和列表展示的轻量元数据（frontmatter 映射）。
- `content`：技能正文（Markdown），仅在命中技能执行时按需加载。
- `contentHash`/`contentUpdatedAt`：用于缓存失效与版本对齐。

### 1.3 核心逻辑

1. Skill 管理：通过 `/skills` 完成技能增删改查与筛选。
2. 文档同步：通过 `/skills/docs/sync` 扫描 `docs/skill/*.md` 并按 `slug` 同步入库（insert/update/skip）。
3. 绑定管理：通过 `/skills/assign` 维护 `Agent.skills`，支持绑定与解绑（`enabled=false`）。
4. 渐进式加载（按需激活）：
   - 列表/路由阶段只读取 skill 元数据（name/description/metadata/status/tags）。
   - 执行阶段先注入 skill 摘要，再根据任务上下文触发 `shouldActivateSkillContent`。
    - 命中激活条件时才读取 `content` 注入 prompt，并受 `SKILL_CONTENT_MAX_INJECT_LENGTH` 截断保护。
    - content 加载失败时仅告警，不阻断任务执行（fail-open）。
   - 当前内置场景映射：
     - 会议执行与异常：`meeting-sensitive-planner`、`meeting-resilience`
     - 模型管理 grounding：`model-management-grounding`
     - 通用运行时基线：`agent-runtime-baseline`
     - Before-Step 强制动作模板：`forced-action-template`
5. 缓存策略：
   - Redis 缓存索引元数据（高频、轻量）。
   - Redis 按 `contentHash` 缓存正文（按需、可失效）。

---

## 2. 相关文档

### 规划文档 (docs/plan/)

| 文件 | 说明 |
|------|------|
| `AGENT_SKILL_MANAGER_PLAN.md` | Agent Skill Manager 初始实现计划（已归档） |
| `AGENT_SKILL_BIND_DUPKEY_FIX_PLAN.md` | Agent 技能绑定唯一索引冲突修复计划 |
| `AGENT_SKILL_DB_REDIS_PROGRESSIVE_LOADING_PLAN.md` | Skill 正文 DB 内嵌与 Redis 渐进式加载实施计划 |
| `SKILL_BINDING_CHECKBOX_SELECT_ALL_PLAN.md` | Skill 详情页 Agent 绑定勾选化与全选交互优化计划 |

### 开发总结 (docs/development/)

| 文件 | 说明 |
|------|------|
| `AGENT_SKILL_MANAGER_PLAN.md` | Skills 管理能力、建议流与文档同步开发总结 |

### 技术文档 (docs/technical/, docs/api/)

| 文件 | 说明 |
|------|------|
| `technical/AGENT_SKILL_DB_REDIS_PROGRESSIVE_LOADING_DESIGN.md` | Skill 元数据/正文分层与 DB+Redis 技术设计 |
| `technical/AGENT_SKILL_PROGRESSIVE_LOADING_RUNTIME_DESIGN.md` | Skill 渐进式加载运行时路由、冲突处理与可观测设计 |
| `api/agents-api.md` | Skills API 现状与渐进式加载接口契约 |

---

## 3. 相关代码文件

### 后端 Skills 模块 (backend/apps/agents/src/modules/skills/)

| 文件 | 功能 |
|------|------|
| `skill.module.ts` | Skills 模块装配 |
| `skill.controller.ts` | Skill CRUD、绑定、检索、文档同步接口 |
| `skill.service.ts` | 技能库、绑定、检索、文档入库同步核心逻辑 |
| `skill-doc-loader.service.ts` | 文档扫描与 frontmatter/content 解析能力 |
| `../agents/agent.service.ts` | Agent 执行消息构建；Skill 摘要注入与按需 content 激活 |

### 领域 Schema (backend/apps/agents/src/schemas/)

| 文件 | 功能 |
|------|------|
| `agent-skill.schema.ts` | Skill 主表结构与索引 |
| `agent.schema.ts`（shared） | Agent 主表中的 `skills` 字段 |

### 前端 Skills 页面 (frontend/src/)

| 文件 | 功能 |
|------|------|
| `pages/Skills.tsx` | Skills 列表筛选、折叠操作面板（检索/文档同步）、详情抽屉编辑、Agent 绑定 Tab |
| `services/skillService.ts` | Skills 相关 API 封装 |

前端交互约定（2026-03 更新）：

- Skill 列表项默认信息降噪（描述限高 + 渐隐），通过「查看详情」进入右侧抽屉。
- 右侧抽屉分为「详情 / Agent 绑定」两个 Tab，详情支持直接保存。
- 「Agent 绑定」Tab 采用 Agent 列表勾选模式，支持单项勾选、当前可见列表全选/取消全选，并按差异批量提交绑定与解绑（解绑复用 `/skills/assign` 且 `enabled=false`）。
- 状态与分类展示中文文案，筛选项同样使用中文显示（传参仍保持后端枚举值）。
