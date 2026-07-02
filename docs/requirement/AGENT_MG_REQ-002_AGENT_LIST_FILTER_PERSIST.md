# Requirement: AGENT_MG_REQ-002_AGENT_LIST_FILTER_PERSIST

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | [Agent Management（Agent 管理）](../feature/AGENT_MG.md) |
| 所属 Plan | [AGENT_MG_AGENT_LIST_FILTER_PERSIST_PLAN](../plan/AGENT_MG_AGENT_LIST_FILTER_PERSIST_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-review |
| 创建日期 | 2026-07-02 |
| 最后更新 | 2026-07-02 |

## 2. 需求描述

### 2.1 背景

Agent 列表筛选项（Tier、孵化项目）在页面切换或返回后会重置，用户需要重复设置筛选条件。

### 2.2 目标

将 Agent 列表页筛选项持久化到 `localStorage`，并在用户重新进入页面时恢复最近一次筛选状态。

### 2.3 验收条件

- [x] 选择 Tier 与项目筛选后，进入 Agent 详情再返回列表，筛选保持不变。
- [x] 刷新页面后，筛选值按上次选择恢复。
- [x] 当 `localStorage` 值非法或损坏时，筛选回退默认值且页面可正常渲染。

## 3. 技术方案摘要

在 `frontend/src/pages/Agents.tsx` 内新增筛选状态持久化逻辑：
1. 初始化时读取 `localStorage` 并解析筛选快照。
2. 对 Tier 值进行 allowlist 校验，对 projectId 做字符串和空值归一化。
3. 筛选 state 更新后同步写回 `localStorage`。

### 影响范围

- **后端**：无。
- **前端**：`frontend/src/pages/Agents.tsx`。
- **数据库**：无。
- **API**：无。

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/AGENT_MG_REQ-002_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

仅持久化列表筛选，不引入全局状态管理或 URL 参数同步。
