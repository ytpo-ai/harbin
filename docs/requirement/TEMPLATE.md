# Requirement: <MODULE>_REQ-<NNN>_<BRIEF>

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-<NNN> |
| 所属 Feature | [<FEATURE_NAME>](../feature/<MODULE>.md) |
| 所属 Plan | [<PLAN_NAME>](../plan/<PLAN_FILE>.md) |
| 需求管理 ID | <!-- 工程智能需求管理系统中的 ID，留空则表示未关联 --> |
| OpenCode Session | <!-- 产出该需求的 session 标识，可选 --> |
| 状态 | draft / in-progress / in-review / done / blocked |
| 创建日期 | YYYY-MM-DD |
| 最后更新 | YYYY-MM-DD |

## 2. 需求描述

### 2.1 背景

<!-- 为什么需要这个需求？来源是什么？ -->

### 2.2 目标

<!-- 这个需求要达成什么？ -->

### 2.3 验收条件

- [ ] 条件 1
- [ ] 条件 2
- [ ] 条件 3

## 3. 技术方案摘要

<!-- 简要描述实现思路，或引用 technical 文档 -->
<!-- 引用示例：详见 [技术设计](../technical/<TECH_DOC>.md) -->

### 影响范围

- **后端**：
- **前端**：
- **数据库**：
- **API**：

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/<MODULE>_REQ-<NNN>_DEVELOPMENT.md) | 待创建 / 进行中 / 已完成 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| <!-- YYYY-MM-DD --> | <!-- 问题描述 --> | [fix](../issue/fix/<FIX_FILE>.md) |

## 5. 备注

<!-- 风险、依赖、约束等补充信息 -->
