# Meetings.tsx 页面拆分重构计划

## 背景

`frontend/src/pages/Meetings.tsx` 共 **2,289 行**，是项目中最大的单体页面文件。内部包含 1 个主组件（~1,993 行）+ 1 个 `CreateMeetingModal`（~216 行），堆积了 **23 个 useState**、**15 个 useMutation**、**14 个 useEffect**、**7 个 useMemo**，所有状态管理、数据请求、WebSocket 实时通信、UI 渲染高度耦合。参照已完成的 Agents / Orchestration 页面拆分架构，对 Meetings 页面进行同等拆分。

## 现状分析

| 模块 | 行范围 | 行数 | 说明 |
|---|---|---|---|
| 常量 + 类型定义 | 31-73 | ~42 | `MEETING_TYPES`, `MEETING_PHRASE_SUGGESTIONS`, 3 个 interface |
| 主组件 `Meetings` | 75-2068 | ~1,993 | 23 useState + 6 useQuery + 15 useMutation + 14 useEffect + 7 useMemo + 全部 JSX |
| `CreateMeetingModal` | 2071-2287 | ~216 | 创建会议弹窗，已独立但同文件 |

### 主组件内部结构

| 区块 | 行范围 | 行数 | 说明 |
|---|---|---|---|
| State 声明 | 76-100 | ~25 | 23 个 useState + 2 个 useRef |
| useEffect (初始化 + 同步) | 102-424 | ~322 | 用户获取、会议选择同步、URL 参数同步、候选项 index clamp |
| useMutation (数据写操作) | 426-665 | ~240 | 15 个 mutation：CRUD + 生命周期 + 消息 + 邀请 |
| useEffect (实时通信) | 667-824 | ~157 | WebSocket 订阅 + 7 种事件处理 + 自动滚动 + thinking 状态同步 |
| 工具函数 | 826-991 | ~165 | 类型查找、显示名解析、mention/phrase 处理、状态徽章 |
| JSX — 左侧会议列表 | 1004-1104 | ~100 | 统计栏 + 会议卡片列表 |
| JSX — 会议头部 | 1111-1534 | ~423 | 标题、描述、议程、模式切换、5 种状态操作菜单、参与者头像 |
| JSX — 聊天区域 | 1536-1929 | ~393 | 消息列表 + 输入框(含 @mention/[phrase] 补全) + 摘要面板 |
| JSX — 操作侧边栏 | 1931-2031 | ~100 | 标题编辑 + 参与者管理 |

### 核心痛点

1. **状态爆炸**：23 个 useState 分属多个无关领域（会议选择、聊天输入、mention 补全、phrase 补全、消息历史、UI 折叠），可读性极差
2. **Mutation 堆积**：15 个 useMutation 内联，占用 ~240 行，与 UI 逻辑交织
3. **WebSocket 巨型 Effect**：126 行 effect 处理 7 种事件类型，难以测试和维护
4. **状态菜单重复**：5 种会议状态(PENDING/ACTIVE/PAUSED/ENDED/ARCHIVED)的操作菜单 ~280 行，结构高度相似但全部硬编码
5. **ChatInput 复杂键盘处理**：113 行 onKeyDown 内联函数，混合 mention 选择、phrase 选择、消息历史导航、消息发送

## 拆分目标

1. 参照 `components/agents/` 和 `pages/orchestration/` 结构，建立 `pages/meetings/` 目录
2. 主页面回归编排职责，目标 **~200 行**
3. 抽取 7 个自定义 Hook 解耦状态管理
4. 抽取 9 个子组件按 UI 边界拆分
5. 5 种状态操作菜单改为数据驱动，消除 ~180 行重复代码

## 拆分后目录结构

```
frontend/src/
├── pages/
│   ├── Meetings.tsx                          # re-export 兼容层，保持路由不变
│   └── meetings/
│       ├── index.tsx                         # 页面编排层 (~200 行)
│       ├── constants.ts                      # MEETING_TYPES, CREATE_MODAL_MEETING_TYPES, MEETING_PHRASE_SUGGESTIONS
│       ├── types.ts                          # MeetingRealtimeEvent, MentionCandidate, PhraseSuggestion, 各组件 Props
│       ├── utils.ts                          # mergeMeetingMessages, getMeetingTypeInfo, getSpeakingModeLabel, getParticipantDisplayName, getStatusBadge
│       │
│       ├── hooks/
│       │   ├── useMeetingQueries.ts          # 6 个 useQuery + 派生值 (currentEmployee, hasExclusiveAssistant, participantDisplayMap)
│       │   ├── useMeetingMutations.ts        # 15 个 useMutation + handleStopAndDelete 等组合操作
│       │   ├── useMeetingSelection.ts        # URL 参数同步、pinnedMeetingId、selectedMeeting 自动选择
│       │   ├── useMeetingRealtime.ts         # WebSocket 订阅 + 7 种事件分发
│       │   ├── useMentionAutocomplete.ts     # @mention 状态、候选过滤、插入逻辑
│       │   ├── usePhraseAutocomplete.ts      # [phrase] 状态、候选过滤、插入逻辑
│       │   └── useMessageHistory.ts          # 已发送消息历史 + ArrowUp/Down 回溯
│       │
│       └── components/
│           ├── MeetingListSidebar.tsx         # 左侧会议列表 + 统计栏 (~100 行)
│           ├── MeetingHeader.tsx              # 会议标题、描述、议程、模式切换 (~150 行)
│           ├── MeetingStatusActions.tsx       # 5 种状态操作菜单，数据驱动 (~100 行，原 ~280 行)
│           ├── ParticipantAvatarRow.tsx       # 参与者头像行 + thinking 指示器 + 邀请按钮 (~85 行)
│           ├── MessageList.tsx               # 消息列表 + 消息气泡渲染 (~125 行)
│           ├── ChatInput.tsx                 # 文本输入框 + mention/phrase 下拉 + 键盘处理 (~232 行)
│           ├── MeetingSummaryPanel.tsx        # 会议摘要 + 行动事项 (~30 行)
│           ├── OperationsSidebar.tsx          # 右侧可折叠面板：标题编辑 + 参与者管理 (~100 行)
│           └── CreateMeetingModal.tsx         # 创建会议弹窗，从主文件迁出 (~216 行)
```

## 职责划分

### 1) 页面编排层 (`pages/meetings/index.tsx`)

- 仅承载页面级状态：`isCreateModalOpen`, `isChatOnlyMode`, `isOperationsCollapsed`, `selectedMeeting`
- 编排 7 个 hooks 的输入输出
- 组装子组件的 flex 布局
- 保留 `isChatOnlyMode` URL 参数判断逻辑

### 2) 数据查询层 (`hooks/useMeetingQueries.ts`)

- 集中 6 个 useQuery：meetings / stats / agents / employees / 单会议 / agentStates
- 返回派生值：`currentEmployee`, `hasExclusiveAssistant`, `currentExclusiveAssistantName`, `participantDisplayMap`, `managementCandidates`
- 返回 `effectiveMeetingId` 的计算逻辑

### 3) 写操作层 (`hooks/useMeetingMutations.ts`)

- 集中 15 个 useMutation：create / start / end / pause / resume / speakingMode / title / addParticipant / removeParticipant / archive / delete / sendMessage / pauseMessageResponse / revokePausedMessage / invite
- 封装 `handleStopAndDelete`, `handleOpenMeetingInNewTab` 等组合操作
- 统一 `onSuccess` 中的 `queryClient.invalidateQueries` 和 `setSelectedMeeting` 更新

### 4) 会议选择层 (`hooks/useMeetingSelection.ts`)

- 管理 `pinnedMeetingId` 状态
- 3 个 useEffect：URL 参数 → pinnedId 同步、effectiveMeetingId → 列表匹配、单会议查询 → selectedMeeting 同步
- 返回 `selectedMeeting`, `setSelectedMeeting`, `effectiveMeetingId`

### 5) 实时通信层 (`hooks/useMeetingRealtime.ts`)

- 接收 `meetingId`, `onMeetingUpdate`, `queryClient` 参数
- 管理 WebSocket 订阅生命周期
- 分发 7 种事件：message / agent_state_changed / summary_generated / status_changed / settings_changed / participant_joined / participant_left
- 内部使用 `useRef` 避免 stale closure

### 6) 输入辅助层

- `useMentionAutocomplete.ts`：管理 `mentionStart`, `mentionQuery`, `mentionActiveIndex`，提供 `filteredCandidates`, `resetMention`, `updateMentionState`, `applyMentionCandidate`
- `usePhraseAutocomplete.ts`：管理 `phraseStart`, `phraseQuery`, `phraseActiveIndex`，提供 `filteredSuggestions`, `resetPhrase`, `updatePhraseState`, `applyPhraseSuggestion`
- `useMessageHistory.ts`：管理 `messageHistoryIndex`, `messageHistoryDraft`，提供 `sentMessageHistory`, 历史导航方法

### 7) 组件层

| 组件 | 职责 | 关键 Props |
|---|---|---|
| `MeetingListSidebar` | 左侧统计 + 会议卡片列表 | `meetings`, `stats`, `selectedMeetingId`, `onSelect`, `onCreateClick` |
| `MeetingHeader` | 标题、描述、议程、模式切换 | `meeting`, `onSpeakingModeToggle` |
| `MeetingStatusActions` | 数据驱动的状态操作菜单 | `meeting`, `mutations`, `showMenu`, `onToggleMenu` |
| `ParticipantAvatarRow` | 参与者头像 + thinking + 邀请 | `meeting`, `thinkingAgentIds`, `agents`, `onInvite` |
| `MessageList` | 消息渲染 + pause/revoke 控制 | `messages`, `participantDisplayMap`, `repliedMessageIds`, `mutations` |
| `ChatInput` | 输入框 + 自动补全 + 键盘处理 | `mentionHook`, `phraseHook`, `historyHook`, `onSend`, `isComposing` |
| `MeetingSummaryPanel` | 摘要 + 行动事项 | `summary` |
| `OperationsSidebar` | 标题编辑 + 参与者增删 | `meeting`, `titleDraft`, `managementCandidates`, `mutations` |
| `CreateMeetingModal` | 创建会议表单弹窗 | `agents`, `currentUser`, `onClose`, `onCreate`, `isLoading` |

## 分步执行计划

### 第 1 步：基础复用层抽取（constants / types / utils）

1. 创建 `pages/meetings/constants.ts` — 搬迁 `MEETING_TYPES`, `CREATE_MODAL_MEETING_TYPES`, `MEETING_PHRASE_SUGGESTIONS`
2. 创建 `pages/meetings/types.ts` — 搬迁 `MeetingRealtimeEvent`, `MentionCandidate`, `PhraseSuggestion`，新增各组件 Props 类型
3. 创建 `pages/meetings/utils.ts` — 搬迁 `mergeMeetingMessages`, `getMeetingTypeInfo`, `getSpeakingModeLabel`, `getParticipantDisplayName`, `getStatusBadge`
4. 更新原 `Meetings.tsx` 的 import 指向新文件，验证编译通过

**影响点**: 无 UI 变更，纯文件搬迁 + import 路径更新

### 第 2 步：Hooks 层抽取

按依赖关系从底层到上层依次抽取：

1. `useMessageHistory.ts` — 无外部 hook 依赖，最简单
2. `useMentionAutocomplete.ts` — 依赖 `MentionCandidate` 类型
3. `usePhraseAutocomplete.ts` — 依赖 `PhraseSuggestion` 类型
4. `useMeetingQueries.ts` — 集中 6 个 useQuery + 派生 useMemo
5. `useMeetingMutations.ts` — 集中 15 个 useMutation，依赖 queryClient
6. `useMeetingSelection.ts` — 依赖 queries 返回的 meetings 列表
7. `useMeetingRealtime.ts` — 依赖 meetingId、queryClient，使用 useRef 避免闭包陈旧

每个 hook 抽取后立即验证编译通过。

**影响点**: 主组件 useState 从 23 个降至 ~5 个

### 第 3 步：组件层抽取

按优先级从高到低：

| 优先级 | 组件 | 原行数 | 目标行数 | 说明 |
|---|---|---|---|---|
| P0 | `CreateMeetingModal` | ~216 | ~216 | 已独立，仅需搬文件 |
| P0 | `MeetingStatusActions` | ~280 | ~100 | 5 种状态菜单合并为数据驱动配置 |
| P0 | `ChatInput` | ~232 | ~232 | 自包含复杂交互，含 113 行 onKeyDown |
| P1 | `MessageList` | ~125 | ~125 | 消息渲染 + pause/revoke |
| P1 | `MeetingListSidebar` | ~100 | ~100 | 左侧面板 |
| P1 | `MeetingHeader` | ~150 | ~150 | 会议头部信息 |
| P1 | `ParticipantAvatarRow` | ~85 | ~85 | 参与者头像行 |
| P2 | `OperationsSidebar` | ~100 | ~100 | 右侧参与者管理 |
| P2 | `MeetingSummaryPanel` | ~22 | ~30 | 体积小但职责独立 |

### 第 4 步：页面编排层重写

1. 创建 `pages/meetings/index.tsx` 作为新的页面入口 (~200 行)
2. 将 `pages/Meetings.tsx` 改为 re-export：`export { default } from './meetings'`
3. 验证路由 `/meetings` 和 `/meetings/:meetingId` 正常工作

### 第 5 步：验证

1. `pnpm -C frontend build` 编译通过
2. 手动验证核心流程：会议列表 → 创建 → 选中 → 发消息 → @mention → [phrase] → 暂停/恢复/结束 → 摘要 → 归档/删除

## MeetingStatusActions 数据驱动设计

将 5 种状态的操作菜单从硬编码改为配置驱动：

```typescript
interface StatusAction {
  label: string;
  icon: React.ComponentType;
  className: string;
  onClick: () => void;
  confirm?: string;  // 需要确认的提示文案
}

const STATUS_ACTIONS_MAP: Record<MeetingStatus, (mutations) => StatusAction[]> = {
  PENDING: (m) => [
    { label: '开始会议', icon: PlayIcon, onClick: () => m.start(), className: 'text-green-600' },
    { label: '删除', icon: TrashIcon, onClick: () => m.delete(), className: 'text-red-600', confirm: '确认删除？' },
  ],
  ACTIVE: (m) => [
    { label: '暂停', icon: PauseIcon, onClick: () => m.pause(), className: 'text-yellow-600' },
    { label: '结束', icon: StopIcon, onClick: () => m.end(), className: 'text-red-600' },
    { label: '终止并删除', icon: TrashIcon, onClick: () => m.stopAndDelete(), className: 'text-red-600', confirm: '确认终止并删除？' },
  ],
  // ... PAUSED, ENDED, ARCHIVED
};
```

预计将 ~280 行硬编码缩减为 ~100 行配置 + 渲染。

## 关键约束

1. **接口不变** — 纯前端内部重构，不涉及后端 API、路由路径、数据库变更
2. **路由兼容** — `App.tsx` 中 `/meetings` 和 `/meetings/:meetingId` 通过 re-export 保持不变
3. **外部引用兼容** — `Agents.tsx` 中 `import { meetingService }` 来自 service 层，不受影响
4. **逐步可验证** — 每步完成后执行 `pnpm -C frontend build` 确认编译通过
5. **WebSocket 状态安全** — `useMeetingRealtime` 必须使用 `useRef` 缓存最新 `selectedMeeting`，避免 stale closure

## 风险与应对

| 风险 | 应对措施 |
|---|---|
| WebSocket 事件处理依赖闭包中的 `selectedMeeting` 状态 | `useMeetingRealtime` 使用 `useRef` 缓存最新值，回调通过 ref.current 访问 |
| 5 种状态菜单合并时行为差异遗漏 | 抽取前逐一对照每种状态的操作项，列出完整操作矩阵确保配置覆盖全部场景 |
| mention/phrase 自动补全与 textarea ref 的耦合 | hooks 接收 `inputRef` 参数，由 `ChatInput` 组件传入，保持 ref 控制链路清晰 |
| Hook 间循环依赖 | 严格按依赖方向抽取（utils → queries → mutations → selection → realtime），禁止反向引用 |
| IME 输入法兼容性 | `isComposing` 状态保留在 `ChatInput` 组件内部，不上提到 hook 层 |

## 预期收益

| 指标 | 拆分前 | 拆分后 |
|---|---|---|
| 主页面文件行数 | 2,289 | ~200 (index.tsx) |
| 单文件最大行数 | 2,289 | ~232 (ChatInput.tsx) |
| useState 数量（主组件） | 23 | ~5 |
| 可独立测试的 hook | 0 | 7 |
| 状态菜单重复代码 | ~280 行 | ~100 行（配置驱动） |

## 变更边界

- 本次为前端内部重构，不涉及后端接口、路由路径与数据库结构变更
- 不涉及 meetingService.ts 的修改
- 不涉及 App.tsx 路由配置变更
