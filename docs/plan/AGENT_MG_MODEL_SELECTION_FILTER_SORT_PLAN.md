# Plan: AGENT_MG_MODEL_SELECTION_FILTER_SORT_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [Agent Management（Agent 管理）](../feature/AGENT_MG.md) |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | in-progress |
| 优先级 | high |
| 创建日期 | 2026-04-18 |

## 2. 背景

Agent 编辑场景中的模型选择列表当前未按可用性和价格优先级进行筛选排序，导致无有效 API Key 的供应商仍然可见，且高成本模型不够直观，增加了误选和配置成本。

## 3. 目标

在 Agent 编辑（含创建）流程中优化 LLM model 选择体验：仅展示已配置 API Key 的供应商模型，并按模型价格从高到低展示，降低配置错误并提升选择效率。

## 4. 执行步骤

1. [x] 梳理 Agent 创建/编辑弹窗中模型候选列表的数据来源与加工链路。
2. [x] 增加供应商过滤逻辑，仅保留已配置有效 API Key 的 provider 对应模型。
3. [x] 增加模型排序逻辑，按价格由高到低排序并处理缺失价格的兼容行为。
4. [x] 统一创建与编辑场景行为，确保过滤与排序规则一致。
5. [x] 补充或更新相关测试与回归验证。
6. [x] 更新功能文档与追溯关系。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-001 | Agent 模型候选过滤与价格排序优化 | [AGENT_MG_REQ-001_MODEL_SELECTION_FILTER_SORT](../requirement/AGENT_MG_REQ-001_MODEL_SELECTION_FILTER_SORT.md) | in-review |

## 6. 关键影响点

- **后端**：无接口变更预期。
- **前端**：Agent 创建/编辑模型列表过滤与排序逻辑。
- **数据库**：无结构变更。
- **API**：依赖现有模型与 API Key 查询字段。
- **文档**：更新 feature 追溯表与 requirement 关联。

## 7. 风险与依赖

- 模型价格字段可能存在多口径（如 input/output/total），需与现有口径保持一致。
- API Key 与 provider 的关联状态需准确可用，否则可能产生误过滤。

## 8. 备注

默认不新增后端字段，优先在前端基于现有查询结果完成优化。
