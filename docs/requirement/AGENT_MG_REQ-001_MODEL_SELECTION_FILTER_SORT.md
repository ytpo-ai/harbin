# Requirement: AGENT_MG_REQ-001_MODEL_SELECTION_FILTER_SORT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | [Agent Management（Agent 管理）](../feature/AGENT_MG.md) |
| 所属 Plan | [AGENT_MG_MODEL_SELECTION_FILTER_SORT_PLAN](../plan/AGENT_MG_MODEL_SELECTION_FILTER_SORT_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-review |
| 创建日期 | 2026-04-18 |
| 最后更新 | 2026-04-18 |

## 2. 需求描述

### 2.1 背景

Agent 编辑模型选择列表存在两类体验问题：
1) 未配置 API Key 的供应商模型仍可见，用户选择后无法有效使用。
2) 模型列表缺少价格优先级排序，难以快速识别高成本模型。

### 2.2 目标

在 Agent 创建/编辑模型选择器中实现：
- 仅展示已配置 API Key 的供应商模型。
- 按模型价格由高到低排序展示模型。

### 2.3 验收条件

- [ ] 当某 provider 无可用 API Key 时，该 provider 下模型不出现在模型下拉列表中。
- [ ] 模型下拉列表按价格从高到低排序（高价优先）。
- [ ] 创建和编辑弹窗的模型列表行为一致，且不影响 Agent 保存流程。

## 3. 技术方案摘要

在前端 Agent 管理模块中，基于已有 models 与 apiKeys 查询结果构建过滤后的候选模型集合：
1) 先根据 active API Key 的 provider 集合过滤模型。
2) 再按价格字段进行降序排序。
3) 对缺失价格字段的模型使用兜底比较策略，避免排序异常。

### 影响范围

- **后端**：无。
- **前端**：`frontend/src/components/agents/` 下创建/编辑相关组件与工具函数。
- **数据库**：无。
- **API**：无新增，复用现有模型与 API Key 查询接口。

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/AGENT_MG_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

价格排序口径遵循当前模型数据结构定义，不新增计费字段。
