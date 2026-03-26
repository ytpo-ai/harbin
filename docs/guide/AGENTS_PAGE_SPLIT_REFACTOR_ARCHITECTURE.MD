# AGENTS PAGE SPLIT REFACTOR ARCHITECTURE

## 背景

`frontend/src/pages/Agents.tsx` 已从单文件大组件拆分为“页面编排 + 领域组件 + 共享 hooks/utils”的结构，目标是降低维护成本并消除 Create/Edit 弹窗重复逻辑。

## 拆分后结构

```
frontend/src/
├── pages/
│   └── Agents.tsx
└── components/
    └── agents/
        ├── index.ts
        ├── constants.ts
        ├── utils.ts
        ├── types.ts
        ├── AgentCard.tsx
        ├── AgentListHeader.tsx
        ├── CreateAgentModal.tsx
        ├── EditAgentModal.tsx
        ├── ModelTestPanel.tsx
        └── hooks/
            ├── useAgentListData.ts
            ├── useAgentToolFilter.ts
            └── useAgentFormSync.ts
```

## 职责分层

### 1) 页面层：`pages/Agents.tsx`

- 负责页面级状态：筛选条件、弹窗开关、当前编辑对象、头像加载错误、聊天跳转中状态。
- 负责页面级行为编排：删除/启停/进入聊天/查看详情/打开编辑。
- 负责将查询数据和 mutation 能力注入子组件。

### 2) 数据层 Hook：`hooks/useAgentListData.ts`

- 封装 `agents/models/tools/roles/toolPermissionSets` 查询。
- 封装 `create/update/delete/toggle` mutation 并统一刷新 `agents` 列表。
- 提供 `roleMap` 供页面和子组件复用。

### 3) 表单共享层

- `hooks/useAgentToolFilter.ts`
  - 基于角色权限集生成 `allowedToolIds` / `allowedTools`。
  - 管理 provider/namespace 筛选状态。
  - 输出按 namespace 分组后的工具列表与筛选项。
- `hooks/useAgentFormSync.ts`
  - 统一角色切换联动：同步 tier、按需覆盖 prompt、清理越权工具。
  - 抽象 Create/Edit 在空 prompt 回退行为上的差异（`keep-current` / `empty`）。

### 4) 视图组件层

- `AgentListHeader.tsx`：标题、tier 筛选、创建入口。
- `AgentCard.tsx`：卡片展示与操作入口。
- `CreateAgentModal.tsx`：创建表单。
- `EditAgentModal.tsx`：编辑三 Tab（模型/工具/基础信息）。
- `ModelTestPanel.tsx`：模型流式测试展示（从 Edit Modal 模型 Tab 抽离）。

### 5) 基础复用层

- `constants.ts`：tier 文案/样式与 namespace 展示映射。
- `utils.ts`：provider 兼容判断、tier 规范化、工具键/命名空间解析、自动赋权、config JSON 解析等纯函数。
- `types.ts`：局部类型与组件 Props，避免页面文件内联类型膨胀。

## 关键收益

- 页面主文件回归编排职责，阅读路径更短。
- Create/Edit 弹窗的角色联动与工具过滤逻辑共享，减少重复实现与偏差风险。
- 模型测试面板独立后，Edit 弹窗更易维护与测试。

## 变更边界

- 本次为前端内部重构，不涉及后端接口、路由路径与数据库结构变更。
