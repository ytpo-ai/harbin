# Requirement: DISCUSSION_SPACE_REQ-015_DATA_DISCUSSION_CLOSED_LOOP

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-015 |
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md)、[PROJECT_INCUBATION](../feature/PROJECT_%20INCUBATION.md) |
| 所属 Plan | [DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md) |
| 需求管理 ID | — |
| OpenCode Session | — |
| 状态 | draft |
| 创建日期 | 2026-04-30 |
| 最后更新 | 2026-04-30 |

## 2. 需求描述

### 2.1 背景

Phase 3 完成后系统具备了数据采集能力，但采集到的数据与讨论空间之间仍是断裂的。需要实现数据到讨论的双向流动，形成"讨论 → 开发 → 采集 → 讨论"的完整闭环。

### 2.2 目标

1. 采集数据自动回灌到关联的讨论空间知识库
2. 讨论消息中支持引用/嵌入采集数据
3. 建立可复用的行业观察大纲模板系统
4. 可选的 Agent 自动分析触发（基于数据变化）

### 2.3 验收条件

#### 数据回灌
- [ ] 采集完成后检测 `dataSource.discussionSpaceId`，存在时触发回灌
- [ ] 采集数据自动转化为知识条目（`entryType=data_point`），写入讨论空间知识库
- [ ] 知识条目自动关联 `outlineSectionId`（从数据源继承）
- [ ] 可选的 system 消息通知（`notifyDiscussion` 开关 + `notifyThreshold` 阈值控制）
- [ ] 大纲章节的 `knowledgeCount` 和 `status` 自动更新

#### 数据引用
- [ ] `discussion-message.schema.ts` 新增 `dataReferences` 字段
- [ ] 前端输入框支持 `#data:` 触发数据搜索弹窗
- [ ] 选择数据记录后插入格式化引用块
- [ ] 消息中的数据引用可展开查看详情

#### 大纲模板
- [ ] `ei-outline-template.schema.ts` 定义完成
- [ ] 模板 CRUD API 实现
- [ ] 模板应用 API 实现（将模板大纲导入到讨论空间）
- [ ] 系统内置"行业观察通用模板"
- [ ] 创建讨论空间时可选择模板
- [ ] 选择模板后建议的数据源配置自动预填

#### 自动分析触发（可选）
- [ ] `space.settings.autoAnalysisOnDataUpdate` 开关
- [ ] 数据回灌后检测变化率，超阈值时触发 Agent 分析消息

## 3. 技术方案摘要

详见 Plan 文档 [§4 Phase 4](../plan/DISCUSSION_SPACE_INDUSTRY_OBSERVATION_COLLAB_PLAN.md)

### 影响范围

- **后端**：EI 数据采集服务新增回灌逻辑（跨服务调用讨论知识 API）、新增大纲模板 Schema/Service/Controller、`discussion-message.schema.ts` 字段新增
- **前端**：`MessageInput.tsx` 数据引用交互、`MessageBubble.tsx` 数据引用展示、`SpaceCreateModal.tsx` 模板选择、新增模板管理界面
- **数据库**：新增 `ei_outline_templates` 集合、`discussion_messages` 新增 `dataReferences` 字段
- **API**：新增约 8 个模板相关端点

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-015_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|
| — | — | — |

## 5. 备注

- 本 REQ 工作量最大，建议拆分为多个开发迭代：回灌 → 引用 → 模板 → 自动分析
- 数据回灌涉及 EI → Legacy 跨服务调用，需复用 Gateway 签名机制
- 自动分析触发为可选功能，MVP 阶段可先不实现
- 依赖 Phase 3（数据采集框架）全部完成
- "行业观察通用模板"的大纲结构参考用户提供的 Web3 行业观察大纲抽象设计
