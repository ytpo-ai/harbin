# Agents.tsx 页面拆分重构计划

## 背景

`frontend/src/pages/Agents.tsx` 共 **1680 行**，是一个单体页面文件，包含 3 个 React 组件、16 个工具函数、4 组常量。两个 Modal 组件占约 1100 行（66%），且存在大量重复逻辑。需要拆分以提升可维护性和可读性。

## 现状分析

| 模块 | 行范围 | 行数 | 说明 |
|---|---|---|---|
| 工具函数 + 常量 | 33-181 | ~150 | 16 个函数 + 4 组常量 |
| `Agents` 主页面组件 | 183-563 | ~380 | Agent 列表页、过滤、卡片渲染 |
| `CreateAgentModal` | 566-999 | ~433 | 创建 Agent 的表单弹窗 |
| `EditAgentModal` | 1002-1678 | ~676 | 编辑 Agent 的三 Tab 弹窗（含模型测试） |

### Create/Edit Modal 重复逻辑

- 角色白名单过滤（`allowedToolIds` / `allowedTools`）
- Provider / Namespace 过滤状态与分组 `useMemo`
- 角色切换联动（同步 tier、prompt、tools 默认值）
- 权限自动授予计算（`buildAutoGrantedPermissions`）
- 命名空间分组渲染

## 拆分目标

1. 参考已有 `components/agent-detail/` 目录结构，建立 `components/agents/` 目录
2. 抽取共享逻辑为 hooks 和 utils，消除 Create/Edit Modal 间的重复代码
3. 主页面 `Agents.tsx` 瘦身到 ~100 行，仅保留页面级编排

## 拆分后目录结构

```
frontend/src/
├── pages/
│   └── Agents.tsx                          # 瘦身后 ~100 行，仅编排
│
├── components/
│   └── agents/
│       ├── index.ts                        # barrel export
│       ├── constants.ts                    # TIER_LABEL_MAP, TIER_FILTER_OPTIONS, TIER_BADGE_CLASS_MAP, NAMESPACE_DISPLAY_MAP
│       ├── utils.ts                        # 16 个工具函数
│       ├── types.ts                        # TierFilter 等局部类型
│       │
│       ├── hooks/
│       │   ├── useAgentListData.ts         # 封装 agents/models/tools/roles/permissionSets 的 useQuery + mutations
│       │   ├── useAgentToolFilter.ts       # 角色白名单过滤、provider/namespace 过滤、分组逻辑
│       │   └── useAgentFormSync.ts         # 角色切换联动逻辑
│       │
│       ├── AgentCard.tsx                   # 单个 Agent 卡片组件 (~120 行)
│       ├── AgentListHeader.tsx             # 顶部过滤栏 + 创建按钮 (~50 行)
│       ├── CreateAgentModal.tsx            # 创建弹窗 (~250 行)
│       ├── EditAgentModal.tsx              # 编辑弹窗 (~350 行)
│       └── ModelTestPanel.tsx              # 模型测试面板 (~120 行)
```

## 详细拆分步骤

### 步骤 1：建立 `components/agents/` 骨架

- 创建目录及 `index.ts`、`types.ts`
- 影响：无代码变更

### 步骤 2：抽取常量和工具函数

- **`constants.ts`** ← `TIER_LABEL_MAP`, `TIER_FILTER_OPTIONS`, `TIER_BADGE_CLASS_MAP`, `NAMESPACE_DISPLAY_MAP`
- **`utils.ts`** ← `normalizeProvider`, `isProviderCompatible`, `shouldApplyNextDefault`, `getRoleDisplayName`, `normalizeTier`, `getTierLabel`, `getTierBadgeClassName`, `getToolKey`, `getToolNamespace`, `getToolNamespaceDisplay`, `getToolProvider`, `getToolRequiredPermissionIds`, `buildAutoGrantedPermissions`, `getAgentAvatarUrl`, `prettyConfigText`, `parseConfigText`
- **`types.ts`** ← `TierFilter` 及组件 Props 类型
- 影响：纯搬迁，~150 行

### 步骤 3：抽取共享 Hooks

- **`useAgentListData.ts`**：封装 `useQuery`（agents/models/tools/roles/permissionSets）+ `useMutation`（delete/toggle/update/create），以及 `roleMap` 的 `useMemo`
- **`useAgentToolFilter.ts`**：角色白名单计算（`allowedToolIds` / `allowedTools`）、provider/namespace 过滤状态、分组 `useMemo`（`groupedTools`、`providerOptions`、`namespaceOptions`）
- **`useAgentFormSync.ts`**：角色切换联动逻辑（`handleCreateRoleChange` / `handleEditRoleChange` 的统一抽象）
- 影响：消除 Create/Edit Modal 之间约 **100 行重复逻辑**

### 步骤 4：抽取 `AgentCard` 和 `AgentListHeader`

- **`AgentCard.tsx`**：单个 Agent 卡片的渲染逻辑，接收 `agent`、`roleMap`、action handlers 等 props
- **`AgentListHeader.tsx`**：顶部标题、tier 过滤下拉、创建按钮
- 影响：从主页面组件抽出约 **200 行** JSX

### 步骤 5：拆分 `CreateAgentModal.tsx`

- 独立文件，内部调用 `useAgentToolFilter`、`useAgentFormSync`
- 表单提交逻辑（`handleSubmit`）保留在组件内
- 影响：~250 行独立文件

### 步骤 6：拆分 `EditAgentModal.tsx` + `ModelTestPanel.tsx`

- **`EditAgentModal.tsx`**：三 Tab 结构，调用共享 hooks
- **`ModelTestPanel.tsx`**：从 Model Tab 中抽出模型测试区域（SSE 流式测试、结果展示）
- 影响：~350 + ~120 行独立文件

### 步骤 7：瘦身 `pages/Agents.tsx`

- 仅保留：状态管理（modal open/close、editingAgent）、`useAgentListData` 调用、组件编排
- 预期缩减到 **~100 行**

## 关键影响点

| 影响面 | 说明 |
|---|---|
| **前端** | 纯前端重构，不涉及后端/API/数据库 |
| **路由** | 无变更，`pages/Agents.tsx` 路径不变 |
| **类型** | 需要为组件 Props 补充类型定义 |
| **测试** | 如有相关测试需同步更新 import 路径 |
| **文档** | 功能文档无需变更（纯内部重构） |

## 风险

- Create/Edit Modal 存在细微差异（如 Edit 多了变更检测 `hasChanges`、测试面板 `handleTest`），合并共享逻辑时需仔细对齐
- `useAgentFormSync` 需统一 Create（`handleCreateRoleChange`）和 Edit（`handleEditRoleChange`）的联动差异
- Edit Modal 的 `arraysEqual` / `promptTemplateRefEqual` 等比较函数为 Edit 独有，不应强行抽入共享层

## 状态

- [x] 计划制定
- [x] 用户确认
- [x] 开发执行
- [x] 验证完成
