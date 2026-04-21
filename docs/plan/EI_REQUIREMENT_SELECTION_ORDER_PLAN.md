# EI 需求选择排序优化计划

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [Engineering Intelligence（工程智能）](../feature/ENGINEERING_INTELLIGENCE.md) |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-04-21 |

## 2. 背景

当前 `builtin.sys-mg.mcp.requirement.list` 返回的列表由后端按 `createdAt desc` 排序，Agent 需要自行从结果中推断优先级并选择目标需求，导致在同优先级场景下可能选到后创建的需求。

## 3. 目标

- 在需求列表接口增加可配置排序能力，支持按优先级排序。
- 增加 Agent 友好模式，直接返回“最高优先级且最早创建”的待开发需求。
- 将 rd-workflow 技能文档切换到稳定的后端选择模式，减少 LLM 自主判断误差。

## 4. 执行步骤

1. [ ] 扩展 EI `ListRequirementsDto`，增加 `sortBy`、`sortOrder`、`mode` 参数。
2. [ ] 改造 EI `listRequirements` 查询排序，新增优先级权重排序能力（critical > high > medium > low）。
3. [ ] 在 EI Requirement Service 增加 `mode=requirement_to_develop` 分支，固定返回 todo 中最高优先级且最早创建的 1 条需求。
4. [ ] 改造 EI Controller 对 `mode` 的分发处理，保持旧调用兼容。
5. [ ] 改造 Agents requirement tool handler / tool catalog，透传 `mode`、`sortBy`、`sortOrder`。
6. [ ] 更新 `docs/skill/rd-workflow.md`，将 initialize 第一步升级为可直接获取待开发需求。
7. [ ] 运行 lint/typecheck 验证改动可编译。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | EI 需求选择排序能力与最优需求模式 | [ENGINEERING_INTELLIGENCE_REQ-001_REQUIREMENT_SELECTION_ORDER](../requirement/ENGINEERING_INTELLIGENCE_REQ-001_REQUIREMENT_SELECTION_ORDER.md) | in-progress |

## 6. 关键影响点

- **后端**：EI requirements DTO/Service/Controller、Agents builtin requirement tool handler。
- **前端**：无直接改动。
- **数据库**：无 schema 变更。
- **API**：`GET /ei/requirements` 查询参数扩展。
- **文档**：skill 文档与 feature 追溯信息更新。

## 7. 风险与依赖

- `priority` 为字符串枚举，Mongo 默认字典序不等于业务优先级，需要显式权重映射。
- 必须保证旧调用（不带 `mode`/`sortBy`）行为不破坏。

## 8. 备注

- `mode=requirement_to_develop` 仅用于需求挑选场景，返回单条 requirement。
