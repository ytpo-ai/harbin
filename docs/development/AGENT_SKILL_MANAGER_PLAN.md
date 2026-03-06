# Agent Skill Manager 开发总结

## 交付概览

本次围绕 `AgentSkillManager` 完成了 skills 管理能力落地，覆盖了：

1. 技能库实体管理（`Skill`）
2. Agent 与技能绑定管理（`AgentSkill`）
3. 技能增强建议管理（`SkillSuggestion`）
4. 互联网检索入库与建议生成工作流
5. 数据库与 Markdown 文档双轨维护

## 主要实现内容

### 1) 领域模型与索引

- 新增 `Skill` schema：`backend/src/shared/schemas/skill.schema.ts`
  - 关键字段：`slug`、`provider`、`version`、`status`、`confidenceScore`
  - 索引：`slug + provider + version` 唯一索引
- 新增 `AgentSkill` schema：`backend/src/shared/schemas/agent-skill.schema.ts`
  - 关键字段：`agentId`、`skillId`、`proficiencyLevel`
  - 索引：`agentId + skillId` 唯一索引
- 新增 `SkillSuggestion` schema：`backend/src/shared/schemas/skill-suggestion.schema.ts`
  - 关键字段：`reason`、`priority`、`status`、`score`
  - 索引：`agentId + status + createdAt`

### 2) 模块与服务

- 新增模块：`backend/src/modules/skills/skill.module.ts`
- 新增服务：`backend/src/modules/skills/skill.service.ts`
  - Skill CRUD
  - Agent 绑定技能
  - AgentSkillManager 检索入库（`discoverSkillsFromInternet`）
  - AgentSkillManager 建议生成（`suggestSkillsForAgent`）
  - 建议审核与应用（`reviewSuggestion`）
  - 文档重建（`rebuildSkillDocs`）
- 新增控制器：`backend/src/modules/skills/skill.controller.ts`
- 新增文档同步服务：`backend/src/modules/skills/skill-doc-sync.service.ts`

### 3) 应用接入

- 在主应用模块注册 skills 模块：`backend/src/app.module.ts`
- 扩展共享类型：`backend/src/shared/types.ts`

### 4) 文档双轨维护

- 新增文档目录：
  - `docs/skills/README.md`
  - `docs/skills/library/README.md`
  - `docs/skills/suggestions/README.md`
- 同步策略：
  - DB 作为事实源
  - skill/suggestion 变更后自动写入 Markdown
  - 支持 `POST /api/skills/docs/rebuild` 全量重建

## API 变更清单

- `GET /api/skills`
- `POST /api/skills`
- `GET /api/skills/:id`
- `PUT /api/skills/:id`
- `DELETE /api/skills/:id`
- `POST /api/skills/assign`
- `GET /api/skills/agents/:agentId`
- `POST /api/skills/manager/discover`
- `POST /api/skills/manager/suggest/:agentId`
- `GET /api/skills/suggestions/agents/:agentId`
- `PUT /api/skills/suggestions/:id`
- `POST /api/skills/docs/rebuild`

## 文档更新

- 更新 `README.md`（新增 skills 管理能力说明）
- 更新 `docs/api/API.md`（新增 skills API 文档）

## 测试与验证结果

- `npm run build`：通过
- `npm run lint`：失败（当前仓库缺少 ESLint 配置文件）
- `npm test -- skill.service.spec.ts`：失败（当前 Jest TS 转换配置与测试文件不兼容）

新增测试文件：`backend/src/modules/skills/skill.service.spec.ts`

## 已知限制与后续建议

1. 互联网检索当前以 GitHub 搜索为主，可扩展白名单来源与可信度评分策略。
2. 建议流已支持 `pending/accepted/rejected/applied`，可继续增加审批人和审批流程字段。
3. 建议补齐 ESLint 与 Jest（TypeScript）配置，纳入 CI 后可稳定回归。
4. 后续可增加前端 Skills 管理页，便于可视化管理技能与建议。

## 前端增量交付（Skills 管理页）

已完成前端页面交付，核心文件如下：

- 页面：`frontend/src/pages/Skills.tsx`
- 服务：`frontend/src/services/skillService.ts`
- 路由：`frontend/src/App.tsx`（新增 `/skills`）
- 导航：`frontend/src/components/Layout.tsx`（新增 Skills 菜单）
- 类型：`frontend/src/types/index.ts`（新增 Skill/AgentSkill/SkillSuggestion）

页面能力覆盖：

1. Skill 库查询、筛选、创建、状态更新、删除
2. Agent 技能绑定与已绑定列表查询
3. AgentSkillManager 建议生成与审核（accepted/rejected/applied）
4. 互联网检索入库触发（discover）
5. `docs/skills` 文档重建触发

验证结果：

- `frontend` 执行 `npm run build` 通过

## 前端交互优化（2026-03）

本次对 Skills 页面交互做了三项增强：

1. 将 AgentSkillManager 检索入口改为右侧抽屉（减少主页面表单占用）
2. 将“新增 Skill”改为弹窗提交
3. 新增“编辑 Skill”弹窗，支持核心字段修改

对应文件：`frontend/src/pages/Skills.tsx`

## 测试数据初始化

已通过后端 API 创建 4 条测试 skills（存在则跳过）：

- `security-audit-skill`
- `research-synthesis-skill`
- `incident-triage-skill`
- `product-spec-critic-skill`

执行方式：调用 `POST /api/skills`（脚本化批量创建）。

## 列表体验增强（分页 + 搜索）

已在 Skills 列表实现前端本地搜索与分页：

1. 关键字搜索：匹配 `name/description/tags/category/provider/version`
2. 搜索防抖：250ms
3. 分页：每页 10/20/50 可切换
4. 分页导航：首页 / 上一页 / 下一页 / 末页
5. 结果统计：显示筛选后总数与当前页展示区间

实现文件：`frontend/src/pages/Skills.tsx`

## URL 状态持久化与服务端分页

进一步完成了以下增强：

1. Skills 页面筛选状态与分页状态写入 URL query：`search/status/category/page/pageSize`
2. 刷新页面后可恢复当前列表视图
3. Skills 列表从前端本地分页切换为后端服务端分页（`GET /api/skills`）
4. 后端新增 `search/page/pageSize` 查询参数，并在传入分页参数时返回 `{items,total,page,pageSize,totalPages}`

## 架构迁移：Skill 后端迁移至 Agents App

根据最新架构建议，skills 相关后端能力已迁移至 `apps/agents`：

1. 模块迁移到：`backend/apps/agents/src/modules/skills/`
2. `AgentsAppModule` 已注册 `SkillModule`
3. Gateway 已将 `/api/skills` 路由转发到 agents service
4. Legacy app 已移除 `SkillModule` 注册，避免双入口重复

验证结果：

- `npm run build:agents` 通过
- `npm run build:gateway` 通过
- `npm run build`（legacy）通过

## Schema 收拢（Agents 领域）

为进一步统一领域边界，已将 skills 相关 schema 收拢到 agents app：

- `backend/apps/agents/src/schemas/skill.schema.ts`
- `backend/apps/agents/src/schemas/agent-skill.schema.ts`
- `backend/apps/agents/src/schemas/skill-suggestion.schema.ts`

同时为兼容历史引用，保留 shared 路径的 re-export：

- `backend/src/shared/schemas/skill.schema.ts`
- `backend/src/shared/schemas/agent-skill.schema.ts`
- `backend/src/shared/schemas/skill-suggestion.schema.ts`

当前策略为“领域内实现 + 兼容层过渡”，后续可在确认无外部引用后移除兼容层。

## 可验证执行：Agent 使用已绑定 Skill

已将“已绑定 skill”接入 Agent 实际执行链路（`apps/agents`）：

1. 在 `executeTask` / `executeTaskWithStreaming` 执行前读取当前 Agent 的已启用技能（`AgentSkill.enabled=true`）
2. 将技能信息注入到 system prompt（含 name/description/tags/proficiency）
3. 在任务消息 metadata 中记录：
   - `usedSkillIds`
   - `usedSkillNames`
   - `usedSkills`（含 proficiency）

关键文件：

- `backend/apps/agents/src/modules/agents/agent.module.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`

验证方式：

1. 先通过 `/api/skills/assign` 给 agent 绑定 skill
2. 执行该 agent 的任务
3. 在任务消息 metadata 中检查 `usedSkillIds` 是否包含已绑定 skill

## 建议列表可读性增强

1. 建议列表由 `skillId` 改为优先显示 `skill 名称`
2. 支持点击建议中的 skill 名称，一键定位到技能库并触发高亮

---

## 计划原文（合并归档：AGENT_SKILL_MANAGER_PLAN.md）

# Agent Skill Manager 实施计划

## 需求目标

1. 在系统中实现 `skills` 管理能力，统一维护全部 Agent 的可用技能库。
2. 新增专用管理 Agent：`AgentSkillManager`，负责检索外部优质 skills 并更新系统库。
3. 支持日常运行中对特定 Agent 的技能增强建议（`SkillSuggestion`）。
4. 实现 skills 在数据库与 Markdown 文档双轨维护，并提供一致性保障机制。

## 执行步骤（按顺序）

1. 定义领域模型与索引
   - 新增 `Skill`、`AgentSkill`、`SkillSuggestion` 三类 schema。
   - 明确唯一键、状态字段、来源可信度与版本信息。
2. 实现 Skill 管理服务与 API
   - 提供 skills 的增删改查、启停用、版本更新与去重能力。
3. 实现 AgentSkillManager 工作流
   - 支持外部 skill 检索结果入库。
   - 支持基于 Agent 上下文输出技能增强建议。
4. 实现 DB 与 Markdown 同步机制
   - 新增文档同步服务：入库/更新自动落盘 `docs/skills/*.md`。
   - 提供重建能力：可从 DB 全量重建文档。
5. 测试与验证
   - 覆盖 skill 入库、建议生成、双轨同步一致性关键路径。
6. 文档更新
   - 更新 `README.md`、`docs/api/API.md` 及新增 skills 管理文档。

## 关键影响点

- 后端/API（高影响）：新增 skills 管理模块、控制器、服务与工作流接口。
- 数据库（高影响）：新增技能库、agent 技能映射、建议记录模型与索引。
- 文档（高影响）：新增 `docs/skills/` 结构，并建立双轨维护规则。
- 测试（中高影响）：新增模块测试与同步一致性测试。

## 风险与依赖

- 外网检索结果质量波动：需设置来源可信度与基础校验规则。
- 技能去重和版本冲突：需定义稳定唯一键（如 `slug + provider + version`）。
- DB 与 Markdown 一致性：需明确 DB 为事实源，并提供重建/校验机制。
- 外部网络依赖：检索流程需容错，避免阻塞主流程。

## 进度记录

- [x] 方案确认
- [x] 计划文档落盘
- [x] 领域模型与 API 实现
- [x] AgentSkillManager 工作流实现
- [x] DB 与 Markdown 同步实现
- [x] 测试与文档完善

## 前端增量计划（Skills 管理页）

### 目标

为已落地的 skills 后端能力提供可视化管理入口，支持技能库管理、Agent 技能绑定、建议审核和文档重建。

### 执行步骤

1. 页面信息架构
   - 新增 Skills 页面，包含技能库、Agent 绑定、建议审核三块区域。
2. API 与类型接入
   - 新增前端 skills service，补齐 Skill/AgentSkill/SkillSuggestion 类型。
3. 功能实现
   - 技能查询筛选、创建、状态更新、删除
   - Agent 技能绑定与已绑定列表
   - 建议生成、查询、审核（accepted/rejected/applied）
4. 双轨维护入口
   - 提供“重建文档”按钮触发 `POST /api/skills/docs/rebuild`
5. 联调与验证
   - 前端构建验证，补充必要文档说明

### 前端影响点

- 前端路由与导航（高影响）
- 前端服务层与类型层（高影响）
- 前端页面交互与状态管理（中高影响）
- 使用文档（中影响）

### 前端进度记录

- [x] Skills 页面信息架构与交互实现
- [x] skills service 与类型定义接入
- [x] 路由与导航接入
- [x] 文档重建入口接入
- [x] 前端构建验证通过

### 前端优化进度（2026-03）

- [x] AgentSkillManager 检索改为侧边抽屉
- [x] 新增 Skill 改为弹窗
- [x] 新增编辑 Skill 弹窗
- [x] 创建测试技能数据（4 条）
- [x] Skills 列表增加关键字搜索（250ms 防抖）
- [x] Skills 列表增加分页（10/20/50）与首页/末页导航
- [x] URL query 持久化（search/status/category/page/pageSize）
- [x] 建议列表显示 skill 名称并支持一键定位到技能库
- [x] Skills 列表切换为后端分页与搜索（服务端分页）
- [x] Skill 后端模块迁移到 `apps/agents`
- [x] Gateway 将 `/api/skills` 转发到 agents service
- [x] Legacy 移除 SkillModule 注册
- [x] Skill 相关 schema 收拢到 `apps/agents/src/schemas`
- [x] shared schema 保留 re-export 兼容层
- [x] Agent 执行链路接入已绑定 skill 上下文注入
- [x] 任务消息 metadata 增加 usedSkillIds/usedSkillNames 便于验证
