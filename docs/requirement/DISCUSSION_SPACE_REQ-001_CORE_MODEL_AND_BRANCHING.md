# Requirement: DISCUSSION_SPACE_REQ-001_CORE_MODEL_AND_BRANCHING

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-001 |
| 所属 Feature | DISCUSSION_SPACE（待创建） |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

Discussion Space 需要从线性对话升级为树状可分叉模型，现有 Meeting 数据结构无法承载 Space / Thread / Message / Participant / Knowledge 五类实体与关联索引。

### 2.2 目标

完成 REQ-001 的后端基础能力：
- 讨论空间核心数据模型与索引
- Space / Thread / Message / Participant 基础 CRUD
- 从消息分叉子线程与深度限制能力

### 2.3 验收条件

- [x] MongoDB 新增 5 个 Discussion 相关 Schema，包含计划中的关键字段与索引
- [x] 后端新增 `discussions` 模块并暴露基础 REST API
- [x] 支持从指定消息分叉并挂接到线程树
- [x] 支持通过 `maxBranchDepth` 限制分叉深度
- [x] 新增分叉深度单测并通过

## 3. 技术方案摘要

- 采用独立 Collection 建模 DiscussionSpace / Thread / Message / Participant / KnowledgeEntry。
- 通过 `parentThreadId + childThreadIds` 构建树，分叉时校验 `space.settings.maxBranchDepth`。
- 消息发送链路内完成 sequence 自增、@mention 解析、线程和空间统计同步。

### 影响范围

- **后端**：`backend/src/modules/discussions/` 新增模块与服务
- **前端**：暂未开始（后续 REQ-003）
- **数据库**：新增 5 个 discussion_* 集合
- **API**：新增 `/discussions` 及子路由

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-001_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 当前实现聚焦 REQ-001，尚未覆盖 AI 分叉建议生成、SSE 流式回复、知识积累与文档沉淀。
