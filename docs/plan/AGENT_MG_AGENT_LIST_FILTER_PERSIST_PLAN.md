# Plan: AGENT_MG_AGENT_LIST_FILTER_PERSIST_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [Agent Management（Agent 管理）](../feature/AGENT_MG.md) |
| 需求管理 ID | |
| 所属项目 | |
| OpenCode Session | |
| 状态 | done |
| 优先级 | medium |
| 创建日期 | 2026-07-02 |

## 2. 背景

Agent 列表页当前筛选状态仅保存在页面内存中。用户进入某个 Agent 详情后返回列表，或刷新页面后，筛选项会重置，导致重复选择，影响管理效率。

## 3. 目标

为 Agent 列表页筛选项增加本地持久化能力，在同一浏览器内保持最近一次筛选选择，减少重复操作。

## 4. 执行步骤

1. [x] 在 `Agents.tsx` 增加筛选状态持久化 key 与读取逻辑，页面初始化时恢复筛选值。
2. [x] 对恢复值做合法性校验，异常或脏值自动回退到默认筛选。
3. [x] 在筛选项变化时写入 `localStorage`，覆盖最近一次选择。
4. [x] 保持现有查询和筛选行为不变，避免影响 Agent 列表加载和卡片渲染。
5. [x] 完成最小回归验证并更新文档追溯与日志记录。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-002 | Agent 列表筛选项 localStorage 持久化 | [AGENT_MG_REQ-002_AGENT_LIST_FILTER_PERSIST](../requirement/AGENT_MG_REQ-002_AGENT_LIST_FILTER_PERSIST.md) | in-review |

## 6. 关键影响点

- **后端**：无。
- **前端**：`frontend/src/pages/Agents.tsx`。
- **数据库**：无。
- **API**：无。
- **文档**：`docs/plan`、`docs/requirement`、`docs/feature`、`docs/dailylog`。

## 7. 风险与依赖

- `localStorage` 读取可能受历史格式或手工篡改影响，需要容错回退。
- 仅持久化页面筛选，不持久化弹窗临时状态，避免状态污染。

## 8. 备注

本次为前端体验优化，不涉及接口契约与数据模型变更。
