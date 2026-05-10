# Plan: DISCUSSION_SPACE_SECTION_THREAD_ENRICH_BUTTON_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | 69f096d658f9498921a8bd27 |
| OpenCode Session | — |
| 状态 | completed |
| 优先级 | high |
| 创建日期 | 2026-05-02 |

## 2. 背景

当前“讨论此章节”点击后会正确进入章节线程并锁定知识库筛选，但进入后仍缺少一个显式动作入口，用户无法在聊天区直接触发“围绕当前章节生成补充内容”的操作。虽然章节卡片已有“补充此章节”入口，但它位于右侧大纲，和已经进入线程后的聊天上下文割裂。

## 3. 目标

1. 在用户进入章节讨论线后，在聊天区提供“丰富此章节”按钮。
2. 按钮只在当前线程关联 `outlineSectionId` 时展示，明确体现“章节上下文内动作”。
3. 点击按钮仅向当前章节线程发送预置补充提示词，不改变“讨论此章节”本身不自动发消息的语义。
4. 保持知识库筛选锁定、线程切换等既有行为不变。

## 4. 执行步骤

1. [x] 梳理 `DiscussionDetail` 现有章节线程切换、消息发送与知识库筛选逻辑，复用 `sendDiscussionMessage` 能力。
2. [x] 在聊天区头部新增“丰富此章节”按钮，仅在 `selectedThread.outlineSectionId` 存在时显示。
3. [x] 按钮点击后发送章节 enrich 预置消息，增加 loading/禁用态及成功失败反馈。
4. [x] 校验与“讨论此章节”“补充此章节”入口协同，避免重复请求与状态冲突。
5. [x] 更新 requirement/feature 追溯信息并完成基础回归验证。

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-023 | 章节讨论线内“丰富此章节”动作入口 | [链接](../requirement/DISCUSSION_SPACE_REQ-023_SECTION_THREAD_ENRICH_ACTION.md) | completed |

## 6. 关键影响点

- **后端**：无新增接口，复用现有发消息接口。
- **前端**：`DiscussionDetail.tsx` 聊天区头部动作区与章节 enrich 触发逻辑。
- **数据库**：无。
- **API**：无新增，仅复用 `POST /discussions/:spaceId/threads/:threadId/messages`。
- **文档**：新增 plan/requirement，更新 feature 追溯表。

## 7. 风险与依赖

- **风险**：按钮展示条件错误可能导致普通线程出现章节动作入口。
- **风险**：按钮与消息发送态并发时，可能触发重复提交。
- **依赖**：章节线程需正确携带 `outlineSectionId`（已有链路保证）。

## 8. 备注

- 不新增独立页面，不新增新 Agent。
- 不引入 `organizationId` 字段。
