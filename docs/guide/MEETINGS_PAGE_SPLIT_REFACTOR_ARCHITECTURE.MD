# Meetings 页面拆分架构概览

## 背景

- 原 `frontend/src/pages/Meetings.tsx` 为超大单文件，承担查询、写操作、实时事件、输入补全、历史导航和全部 UI 渲染。
- 本次按照页面拆分模式重构为 `pages/meetings/` 目录，`frontend/src/pages/Meetings.tsx` 保留为路由兼容层。

## 新目录结构

```
frontend/src/pages/
├── Meetings.tsx                              # 兼容层：re-export
└── meetings/
    ├── index.tsx                             # 页面编排入口
    ├── constants.ts                          # 会议类型与短语常量
    ├── types.ts                              # 事件/候选项/组件 Props 类型
    ├── utils.ts                              # 复用工具函数
    ├── hooks/
    │   ├── useMeetingQueries.ts
    │   ├── useMeetingMutations.ts
    │   ├── useMeetingSelection.ts
    │   ├── useMeetingRealtime.ts
    │   ├── useMentionAutocomplete.ts
    │   ├── usePhraseAutocomplete.ts
    │   └── useMessageHistory.ts
    └── components/
        ├── MeetingListSidebar.tsx
        ├── MeetingHeader.tsx
        ├── MeetingStatusActions.tsx
        ├── ParticipantAvatarRow.tsx
        ├── MessageList.tsx
        ├── ChatInput.tsx
        ├── MeetingSummaryPanel.tsx
        ├── OperationsSidebar.tsx
        └── CreateMeetingModal.tsx
```

## 模块职责

- `useMeetingQueries`：集中会议列表、统计、人员、目标会议与派生视图数据。
- `useMeetingMutations`：集中会议生命周期、消息、参与者、邀请等 mutation 以及组合操作。
- `useMeetingSelection`：管理 URL/路径驱动的目标会议与 pinned 会议选择状态。
- `useMeetingRealtime`：集中 WebSocket 订阅与事件分发（消息、状态、设置、摘要、参与者变更）。
- `useMentionAutocomplete` / `usePhraseAutocomplete` / `useMessageHistory`：拆分输入辅助状态与交互行为。
- `MeetingStatusActions`：将状态菜单改为配置驱动，减少重复分支渲染。

## 兼容性与边界

- 路由路径保持不变：`/meetings` 与 `/meetings/:meetingId`。
- 未改动 `meetingService` API 契约与后端接口。
- 页面行为保持原语义：会议列表、状态操作、聊天输入补全、暂停/撤回、摘要展示、侧栏操作。

## 验证

- 已执行：`pnpm -C frontend build`
- 结果：通过。
