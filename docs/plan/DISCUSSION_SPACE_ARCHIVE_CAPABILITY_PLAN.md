# Plan: DISCUSSION_SPACE_ARCHIVE_CAPABILITY_PLAN

## 1. 基本信息

| 字段 | 值 |
|------|-----|
| 所属 Feature | [DISCUSSION_SPACE](../feature/DISCUSSION_SPACE.md) |
| 需求管理 ID | — |
| 所属项目 | — |
| OpenCode Session | — |
| 状态 | approved |
| 优先级 | high |
| 创建日期 | 2026-05-01 |

## 2. 背景

当前讨论空间虽已有 `status=archived` 状态定义，但缺少完整的归档能力闭环：

1. 列表查询默认会返回归档空间，缺少明确的归档视图策略
2. 前端缺少归档/取消归档操作入口，状态管理不可见
3. 归档后的写入约束不明确，存在继续发送消息的风险
4. 归档行为缺少操作者和时间等审计信息

## 3. 目标

1. 提供讨论空间归档与取消归档接口能力（软归档，可恢复）
2. 归档信息可追溯（归档时间、操作人）
3. 默认列表隐藏归档空间，支持显式筛选查看归档数据
4. 归档空间默认只读，禁止新增讨论消息
5. 前端列表页与详情页提供完整归档交互与状态提示

## 4. 执行步骤

1. 扩展 `discussion_spaces` 数据模型，增加归档审计字段（`archivedAt`、`archivedBy`）
2. 后端增强空间查询与状态流转：默认排除归档、显式 include 查询、归档/取消归档接口
3. 后端发送消息链路增加归档态校验，归档空间阻止消息写入
4. 前端 `discussionService` 增加归档相关 API，列表页支持快捷归档/恢复与筛选
5. 前端详情页增加空间归档状态标识和只读提示，归档时禁用输入区
6. 补充后端单测（归档过滤规则）并更新 feature/requirement/dailylog 文档

## 5. Requirement 拆解

| 编号 | 需求简述 | 文档 | 状态 |
|------|----------|------|------|
| REQ-016 | 讨论空间归档能力（状态流转 + 列表过滤 + 归档只读 + 前端操作） | [链接](../requirement/DISCUSSION_SPACE_REQ-016_SPACE_ARCHIVE_CAPABILITY.md) | done |

## 6. 关键影响点

- **后端**：`backend/src/modules/discussions/`（space service/controller、message service）
- **前端**：`frontend/src/pages/Discussions.tsx`、`frontend/src/pages/discussions/DiscussionDetail.tsx`、`frontend/src/components/discussion/MessageInput.tsx`
- **数据库**：`discussion_spaces` 归档审计字段与查询过滤策略
- **API**：归档/取消归档端点与列表查询参数扩展
- **测试**：Discussion Space 过滤规则单测

## 7. 风险与依赖

- 历史数据兼容：已有记录无归档字段时应兼容读取
- 查询一致性：分页/统计口径需与默认排除归档保持一致
- 交互一致性：列表页和详情页状态流转后需及时刷新缓存

## 8. 备注

- 本能力采用软归档，不删除历史消息、线程与知识数据
- 归档能力不引入 `organizationId` 字段
