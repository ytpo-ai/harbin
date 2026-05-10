# Requirement: DISCUSSION_SPACE_REQ-004_REPLY_EFFICIENCY_OPTIMIZATION

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 需求编号 | REQ-004 |
| 所属 Feature | DISCUSSION_SPACE |
| 所属 Plan | [DISCUSSION_SPACE_PLAN](../plan/DISCUSSION_SPACE_PLAN.md) |
| 需求管理 ID | |
| OpenCode Session | |
| 状态 | done |
| 创建日期 | 2026-04-28 |
| 最后更新 | 2026-04-28 |

## 2. 需求描述

### 2.1 背景

Discussion Space 在高频协作场景下存在两个效率痛点：
- 需要手动复制消息内容才能复用到外部工具或其他线程
- 用户每次都要手动 `@Agent` 才能触发指定 AI 回复

### 2.2 目标

在讨论详情页增加输入效率优化能力：
- 每条讨论消息支持一键复制内容
- 支持配置讨论空间级别的默认回复 Agent
- 在消息未显式 `@` 时自动路由到默认回复 Agent

### 2.3 验收条件

- [x] 消息气泡提供“复制”按钮，点击可复制消息文本并给出反馈
- [x] Discussion Space 设置支持 `defaultReplyAgentId`
- [x] 详情页输入区支持选择/清空默认回复 Agent
- [x] 发送消息时若未显式 `@`，后端自动注入默认 Agent 作为 mention 目标
- [x] 已显式 `@` 场景保持用户原始路由优先，不被默认 Agent 覆盖
- [x] 默认 Agent 被移除后，空间设置自动清空该字段（降级可用）
- [x] AI mention 回复走 Agent runtime 执行链路，并回传 `runId/sessionId` 到消息元数据

## 3. 技术方案摘要

- 数据模型：扩展 `discussion_spaces.settings.defaultReplyAgentId`（存储空间内 AI 参与者 ID）
- 后端路由策略：
  - 显式 `@` 优先
  - 无显式 `@` 且存在默认 Agent 时，自动注入 mention 目标
  - 默认 Agent 不存在/非 AI 参与者时自动忽略
  - mention 命中的 AI 参与者统一调用 `AgentClientService.executeTaskDetailed` 走 runtime 执行
- 前端交互：
  - `MessageBubble` 增加复制操作
  - `MessageInput` 增加默认回复 Agent 选择器
  - 通过 `PUT /discussions/:spaceId` 更新 space.settings

### 影响范围

- **后端**：`discussion-message.service.ts`、`discussion-space.service.ts`、`discussion.controller.ts`、`discussion.types.ts`、`discussion-space.schema.ts`
- **前端**：`DiscussionDetail.tsx`、`MessageInput.tsx`、`MessageBubble.tsx`、`discussionService.ts`
- **测试**：`discussion-message.service.spec.ts`

## 4. 交付物与追溯

### 4.1 Development

| 文档 | 状态 |
|------|------|
| [开发记录](../development/DISCUSSION_SPACE_REQ-004_DEVELOPMENT.md) | 待创建 |

### 4.2 Fix 记录

| 日期 | 问题简述 | 文档 |
|------|----------|------|

## 5. 备注

- 当前版本采用“空间内参与者 ID”作为默认回复 Agent 标识，避免跨空间路由歧义。
