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
