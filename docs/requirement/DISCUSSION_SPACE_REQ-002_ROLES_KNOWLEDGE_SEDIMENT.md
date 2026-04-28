# Requirement: DISCUSSION_SPACE_REQ-002_ROLES_KNOWLEDGE_SEDIMENT

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-002 |
| 所属 Feature | DISCUSSION_SPACE（待创建） |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | in-progress |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

REQ-001 已完成讨论空间基础模型与分叉能力，但缺少多角色协作与知识沉淀闭环，无法支撑 `@` 唤醒、AI/真人分发、知识复用、文档沉淀。

### 2.2 目标

完成 REQ-002 的后端能力：
- `@` 唤醒路由（真人异步通知 + AI 即时响应触发）
- 讨论知识积累链路（入库、标签化、可信度评估、复用）
- 文档沉淀链路（manual/realtime、手动生成、最新快照读取）

### 2.3 验收条件

- [x] 消息发送时可解析 @mention 并执行 AI / 真人分发
- [x] 真人 mention 可写入 MessageCenter（并透传 WebSocket 通知）
- [x] AI mention 可生成跟进消息并沉淀 derived knowledge 条目
- [x] 提供知识条目新增/查询接口（带关键词与可信度筛选）
- [x] 提供沉淀模式切换、手动生成与最新沉淀读取接口
- [x] 新增知识与沉淀链路单测

## 3. 技术方案摘要

- 新增 `DiscussionMentionDispatchService`：拆分 AI / 真人提及目标，真人写 MessageCenter。
- 新增 `DiscussionKnowledgeService`：负责知识条目入库、自动关键词提取、可信度推断、消息关联。
- 新增 `DiscussionSedimentService`：汇总线程消息 + 知识条目，生成 Markdown 并写回 `sedimentHistory`。
- 在 `DiscussionMessageService.sendMessage` 中串联 mention 分发、AI 自动跟进、知识沉淀与 realtime 文档更新。

### 影响范围

- **后端**：`backend/src/modules/discussions/` 新增 3 个服务并扩展 controller 路由
- **数据库**：复用 `discussion_knowledge_entries`、`discussion_spaces.sedimentHistory`
- **消息中心**：复用 `MessageCenterService.createSystemMessage`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-002_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 当前 AI 即时响应使用后端模板化内容，后续可替换为真实 Agent 执行链路。
