# AgentDetail.tsx 页面拆分重构计划

## 背景

`frontend/src/pages/AgentDetail.tsx` 当前为 **1,953 行**的单体组件，包含：
- 3 个 Tab 视图（Memo / Log / Session）
- 3 个 Modal/Drawer 覆盖层（MemoDetail / MemoEditor / SessionDrawer）
- 21 个 `useState`、6 个 `useQuery`、3 个 `useMutation`、6 个 `useMemo`
- ~18 个辅助/处理函数，零子组件提取

可读性、可维护性和测试性均较差，需按领域职责拆分。

## 拆分目标

将单文件拆分为 ~12 个文件，主页面降至 ~150 行的"组装壳"。

## 目标目录结构

```
frontend/src/components/agent-detail/
├── constants.ts              # 常量 + 类型定义
├── utils.ts                  # 纯工具函数（无 React 依赖）
├── hooks/
│   ├── useAgentDetail.ts     # Agent 基本信息 query + 导航
│   ├── useMemoState.ts       # Memo 相关 state + queries + mutations
│   ├── useLogState.ts        # Log 相关 state + queries + useMemo(taskGroups)
│   └── useSessionState.ts    # Session 相关 state + queries + useMemo(groupedSessionMessages)
├── MemoTab.tsx               # 备忘录 Tab 视图
├── LogTab.tsx                # 日志 Tab 视图
├── SessionTab.tsx            # Session Tab 视图
├── SessionDrawer.tsx         # Session 详情侧滑面板
├── MemoDetailModal.tsx       # Memo 详情弹窗
├── MemoEditorModal.tsx       # Memo 编辑弹窗
└── index.ts                  # barrel export
```

## 分步执行计划

### Step 1 - 提取常量 + 类型定义 → `constants.ts`

**涉及原文件行**：L31~179

**搬出内容**：
- 分页常量：`DEFAULT_MEMO_PAGE_SIZE`, `DEFAULT_LOG_PAGE_SIZE`, `DEFAULT_SESSION_PAGE_SIZE`
- 映射表：`LOG_STATUS_META`, `CONTEXT_TYPE_LABEL`, `ACTION_SEMANTIC_MAP`
- Memo 表单相关：`emptyDraft`, `memoKindOptions`, `standardMemoKinds`, `memoTypeOptions`, `todoStatusOptions`
- 类型定义：`LogStatus`, `TaskGroup`, `MemoDraft`

**影响点**：纯数据搬迁，无功能影响

---

### Step 2 - 提取纯工具函数 → `utils.ts`

**涉及原文件行**：L78~109, L478~596

**搬出内容**：
- `getActionSemantic(action)` — 解析 action 语义标签
- `getActionDescription(item)` — 构建 action 可读描述
- `getTaskStatusMeta(status)` — 查找日志状态元信息
- `getSessionPartText(part)` — 提取 session part 文本
- `getSessionPartType(part)` — 获取 part 类型
- `getSessionMessageText(message)` — 提取消息文本
- `getSessionMessageRawText(message)` — JSON 序列化消息
- `shouldClampPartContent(content)` — 判断是否截断内容
- `getSystemMessageTag(message)` — 系统消息分类标签
- `formatSyncState(run)` — 同步状态中文映射
- `getSessionId(session)` — 提取 session id
- `getSessionMessageKey(message, index)` — 生成 React key

**影响点**：纯函数搬迁，无 React 依赖，无功能影响

---

### Step 3 - 提取自定义 Hooks

**涉及原文件行**：L185~360（state + query + mutation + effect + useMemo）

#### 3.1 `hooks/useAgentDetail.ts`

| 封装内容 | 说明 |
|----------|------|
| useQuery | `['agent-detail', agentId]` 获取 Agent 基本信息 |
| useNavigate | 返回 Agent 列表导航 |

#### 3.2 `hooks/useMemoState.ts`

| 类别 | 封装内容 |
|------|----------|
| useState (7个) | `memoCategory`, `memoSearch`, `memoPage`, `selectedMemo`, `editingMemo`, `memoEditorOpen`, `memoDraft` |
| useQuery | memos 查询 |
| useMutation (3个) | create / update / delete memo |
| useEffect | 编辑器打开时同步 memoDraft |
| useMemo (2个) | `displayedMemos`, `memoSummary` |
| handler | `handleSaveMemo` |

#### 3.3 `hooks/useLogState.ts`

| 类别 | 封装内容 |
|------|----------|
| useState (4个) | `logFilters`, `expandedTaskKeys`, `taskViewModes`, `handlingApprovalRunId` |
| useQuery (2个) | logs 查询, runtime-run 查询 |
| useMemo (3个) | `latestRunIdFromLogs`, `approvalRunCandidates`, `taskGroups` |
| handler | `updateLogFilter`, `toggleTaskExpanded`, `handleApprovalDecision` |

#### 3.4 `hooks/useSessionState.ts`

| 类别 | 封装内容 |
|------|----------|
| useState (10个) | `sessionKeyword`, `sessionIdInput`, `sessionPage`, `selectedSessionId`, `isSessionDrawerOpen`, `sessionCopyNotice`, `expandedSessionMessageIds`, `expandedSessionRawInfoIds`, `expandedSessionPartsIds`, `expandedSessionPartContentIds` |
| useQuery (2个) | sessions 查询, session-detail 查询 |
| useEffect | 自动选中第一个 session |
| useMemo (1个) | `groupedSessionMessages` |
| handler | `copyText`, `handleCopySessionContent`, `buildSessionClipboardText` |

**影响点**：状态管理从主组件迁出，需确保 hook 返回值接口稳定

---

### Step 4 - 提取 Memo Tab + 两个 Modal

**涉及原文件行**：L846~1012 (Tab), L1796~1826 (Detail Modal), L1828~1948 (Editor Modal)

**产出文件**：
- `MemoTab.tsx` — 列表、筛选、分页，内部使用 `useMemoState` hook
- `MemoDetailModal.tsx` — 只读查看弹窗
- `MemoEditorModal.tsx` — 创建/编辑表单弹窗

**Props 设计**：
- `MemoTab`: `agentId: string`
- `MemoDetailModal`: `memo: AgentMemo | null`, `onClose: () => void`
- `MemoEditorModal`: 从 `useMemoState` 获取所有状态，`agentId`, `agentName`

---

### Step 5 - 提取 Log Tab

**涉及原文件行**：L1014~1353

**产出文件**：`LogTab.tsx`

**内部使用**：`useLogState` hook

**包含渲染逻辑**：
- 筛选器栏（日期范围、contextType、status 下拉）
- Summary Cards（Latest Run / Sync State / Authorization 审批）
- TaskGroup 折叠列表（可读时间线 / 原始 JSON 双模式）
- 分页

**跨 Tab 依赖**：末条 action 的 "View Session" 链接需触发 Session Tab → 通过回调 prop `onViewSession(sessionId)` 向上传递

---

### Step 6 - 提取 Session Tab + Drawer

**涉及原文件行**：L1355~1502 (Tab), L1504~1794 (Drawer)

**产出文件**：
- `SessionTab.tsx` — Session 列表 + 筛选 + 分页
- `SessionDrawer.tsx` — 右滑面板（基本信息、上下文、消息列表、Parts 展开）

**内部使用**：`useSessionState` hook

**渲染辅助函数转为子组件**：
- `renderSessionRole` → `<RoleBadge />`（可内联在 SessionDrawer 中）
- `renderMessageStatus` → `<MessageStatusBadge />`
- `renderFinishStatus` → `<FinishStatusBadge />`
- `renderTokenUsage` → `<TokenUsageBadge />`
- `renderCost` → `<CostBadge />`

---

### Step 7 - 精简主页面

**重写**：`pages/AgentDetail.tsx` → ~150 行

**保留内容**：
- `useParams` 获取 `agentId`
- `useAgentDetail(agentId)` 获取 Agent 信息
- `activeTab` 状态 + Tab 切换 UI
- 条件渲染 `<MemoTab />`, `<LogTab />`, `<SessionTab />`
- Header / Agent Info Card

**跨 Tab 通信**：
- LogTab 的 "View Session" → 主页面提供 `onViewSession` 回调，切换 `activeTab` 为 `'session'` 并传递 `sessionId`
- 通过 `SessionTab` 暴露 `ref` 或 prop 接收外部指定的 `sessionId`

---

## 风险点 & 注意事项

| 风险 | 应对措施 |
|------|----------|
| 跨 Tab 数据依赖（Log → Session 跳转） | 主页面提供回调 prop `onViewSession(sessionId)` 传递 |
| queryClient key 散落各处 | 在 `constants.ts` 中定义 query key factory 统一管理 |
| 渲染辅助函数含 JSX | 转为独立小组件（Badge 类），放在对应 Tab/Drawer 文件中 |
| useEffect 依赖链变化 | 拆分后需逐一验证 effect 依赖项是否完整 |
| 编译回归 | 每步完成后立即运行 `npm run build` 确认无编译错误 |

## 执行顺序

**严格按 Step 1 → 7 顺序执行**，每步完成后确保编译通过再进入下一步。

## 预期效果

| 指标 | 拆分前 | 拆分后 |
|------|--------|--------|
| 主文件行数 | 1,953 | ~150 |
| 最大单文件行数 | 1,953 | ~300（LogTab 或 SessionDrawer） |
| 子组件数 | 0 | 6 个视图组件 + 4 个 hooks |
| 可独立测试模块 | 0 | constants / utils / 4 hooks / 6 组件 |
