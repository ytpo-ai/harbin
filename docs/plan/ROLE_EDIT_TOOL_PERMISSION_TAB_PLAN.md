# Plan: 角色编辑弹窗增加"工具权限管理" Tab

## 背景

当前角色编辑弹窗（`HRManagement.tsx:381-503`）仅包含基础字段表单，Tools 字段为纯文本输入（逗号分隔），不可视化、不可勾选。而工具权限集管理能力（可视化工具勾选列表、权限配置、Exposed 开关）仅存在于"工具管理"页面的 `EditToolPermissionSetModal`（`Tools.tsx:1245-1424`），与角色管理页面割裂。

用户在管理角色时，需要在两个不同页面之间切换才能完成角色基础信息 + 工具权限配置的完整操作。

## 目标

- 角色编辑弹窗分为两个 Tab：**基础信息** + **工具权限管理**
- 将工具权限集管理的可视化能力复制到角色编辑弹窗中
- 抽取可复用的工具权限编辑组件，供角色管理和工具管理两个页面共用
- 保持工具管理页面现有功能不变

## 现状

### 角色编辑弹窗（HRManagement.tsx）

内联在 `HRManagement.tsx:381-503`，无独立组件。

当前表单字段：

| 字段 | 控件类型 | 说明 |
|------|---------|------|
| Code | text input | 角色编码 |
| 名称 | text input | 角色中文名 |
| Tier | select | leadership/operations/temporary |
| 描述 | textarea | 角色描述 |
| Capabilities | text input | 逗号分隔文本 |
| Tools | text input | 逗号分隔文本（不可视化） |
| Prompt 模板 | textarea | 提示词模板 |
| 状态 | select | active/inactive |

### 工具权限集编辑弹窗（Tools.tsx EditToolPermissionSetModal）

内联在 `Tools.tsx:1245-1424`，提供完整的工具权限管理能力：

| 字段 | 控件类型 | 说明 |
|------|---------|------|
| 描述 | textarea | 权限集描述 |
| Permissions | text input | 逗号分隔权限列表 |
| Exposed | checkbox | 是否在 MCP 可见列表中展示 |
| Tools | checkbox 列表 | 按 namespace 分组、按 provider/namespace 可筛选的可视化工具勾选列表 |

调用 API: `PUT /agents/tool-permission-sets/:roleCode`

### 依赖的辅助函数（当前定义在 Tools.tsx 文件作用域内）

- `getToolKey(tool)` - 获取工具唯一标识
- `getToolProvider(tool)` - 获取工具 provider
- `normalizeNamespace(namespace)` - 标准化 namespace
- `getNamespaceLabel(namespace)` - 获取 namespace 中文标签
- `NAMESPACE_OPTIONS` / `NAMESPACE_ALIAS_MAP` / `NAMESPACE_LABEL_MAP` - namespace 常量

---

## 改造后的角色编辑弹窗结构

```
<Modal max-w-3xl>
  ├── 标题区: "编辑角色" / "创建角色" + 关闭按钮
  │
  ├── Tab 切换条:
  │   ├── [基础信息]        ← 默认激活
  │   └── [工具权限管理]     ← 创建模式下禁用（角色创建后才能配置）
  │
  ├── Tab 1: 基础信息
  │   ├── Code (text input)           ← 左列
  │   ├── 名称 (text input)           ← 右列
  │   ├── Tier (select)               ← 左列
  │   ├── 状态 (select)               ← 右列
  │   ├── 描述 (textarea)             ← 跨两列
  │   └── Prompt 模板 (textarea)      ← 跨两列
  │
  ├── Tab 2: 工具权限管理 (ToolPermissionSetEditor 组件)
  │   ├── Permissions (text input)     ← 逗号分隔
  │   ├── Exposed (checkbox)           ← MCP 可见性开关
  │   └── Tools (checkbox 列表)        ← 按 namespace 分组，支持 provider/namespace 筛选
  │
  └── 底部操作栏:
      ├── "取消" 按钮
      └── "保存" 按钮
```

### Tab 1 字段变更说明

- **移除** `Capabilities`（逗号文本输入）：能力标签由 Tab 2 的 Permissions 承载
- **移除** `Tools`（逗号文本输入）：工具配置由 Tab 2 的可视化勾选列表承载
- **保留** Code、名称、Tier、描述、Prompt 模板、状态

### 创建模式下的 Tab 2 行为

创建角色时尚无 `roleCode`，无法匹配 `toolPermissionSet`。处理策略：
- Tab 2 显示为**禁用状态**，提示"请先创建角色，再配置工具权限"
- 创建完成后，弹窗关闭；用户再次点击编辑进入时，Tab 2 可用

---

## 执行步骤

### Step 1: 抽取 ToolPermissionSetEditor 为独立可复用组件

**新增文件**: `frontend/src/components/agents/ToolPermissionSetEditor.tsx`

**内容**:
- 从 `Tools.tsx` 的 `EditToolPermissionSetModal`（L1245-1424）中提取表单区域（description/permissions/exposed/tools 选择区）为独立组件
- 组件 Props:
  ```typescript
  interface ToolPermissionSetEditorProps {
    initialData: {
      description?: string;
      permissions: string[];
      exposed: boolean;
      tools: string[];
    };
    availableTools: Array<{
      id: string;
      toolId?: string;
      name: string;
      provider?: string;
      namespace?: string;
      enabled?: boolean;
    }>;
    onChange: (data: { description: string; permissions: string[]; exposed: boolean; tools: string[] }) => void;
  }
  ```
- 内部管理 description/permissionsText/exposed/tools 状态，通过 `onChange` 回调向外同步
- 将 `getToolKey`、`getToolProvider`、`normalizeNamespace`、`getNamespaceLabel`、namespace 常量等辅助函数一并迁入组件文件或抽取到 `frontend/src/components/agents/tool-utils.ts`

**修改 `Tools.tsx`**:
- `EditToolPermissionSetModal` 改为引用 `ToolPermissionSetEditor` 组件，保持外壳弹窗 + 标题 + 操作按钮不变
- 移除内联的辅助函数，改为从共享位置 import

### Step 2: 改造角色编辑弹窗为 Tab 模式

**修改文件**: `frontend/src/pages/HRManagement.tsx`

**数据层新增**:
```typescript
// 新增查询：工具权限集列表
const { data: toolPermissionSets } = useQuery(
  'agentToolPermissionSets',
  agentService.getToolPermissionSets,
);

// 新增查询：可用工具列表
const { data: availableTools } = useQuery(
  ['tool-registry'],
  () => toolService.getToolRegistry(),
);

// 新增 mutation：保存工具权限集
const upsertPermissionSetMutation = useMutation(
  ({ roleCode, updates }: { roleCode: string; updates: ... }) =>
    agentService.upsertToolPermissionSet(roleCode, updates),
  {
    onSuccess: () => {
      queryClient.invalidateQueries('agentToolPermissionSets');
    },
  },
);
```

**State 新增**:
```typescript
const [roleModalTab, setRoleModalTab] = useState<'basic' | 'toolPermission'>('basic');
const [toolPermissionData, setToolPermissionData] = useState<{...} | null>(null);
```

**弹窗结构改造**:
1. 弹窗标题下方新增 Tab 切换条
2. `roleModalTab === 'basic'` 时渲染现有基础信息表单（去掉 Capabilities 和 Tools 字段）
3. `roleModalTab === 'toolPermission'` 时渲染 `ToolPermissionSetEditor` 组件
4. 创建模式下 "工具权限管理" Tab 显示禁用样式
5. 编辑模式下打开弹窗时，根据 `role.code` 从 `toolPermissionSets` 中找到对应数据初始化 Tab 2

**保存逻辑**:
- 点击"保存"按钮时：
  1. 始终调用 `PUT /agents/roles/:id` 保存基础信息（Tab 1 数据）
  2. 如果 Tab 2 数据有变更，同时调用 `PUT /agents/tool-permission-sets/:roleCode` 保存工具权限数据
  3. 两个请求均成功后关闭弹窗并刷新列表

### Step 3: 更新角色列表表格列

**修改文件**: `frontend/src/pages/HRManagement.tsx`

角色列表表格中：
- `Capabilities` 列改为显示 permissions 数量（从 `toolPermissionSets` 中匹配）
- `Tools` 列改为显示工具权限集中的 tools 数量（从 `toolPermissionSets` 中匹配，而非 `role.tools`）
- 可选：新增 `Exposed` 列

### Step 4: 验证

- 确认 `Tools.tsx` 工具权限集管理功能不受影响
- 确认角色编辑弹窗 Tab 切换正常
- 确认基础信息保存正常
- 确认工具权限保存正常
- 确认两个页面的 react-query cache key 共享（`'agentToolPermissionSets'`），数据自动同步
- 运行 `npm run lint` 和 `npm run build` 确认无错误

---

## 影响范围

### 新增文件

| 文件路径 | 说明 |
|----------|------|
| `frontend/src/components/agents/ToolPermissionSetEditor.tsx` | 可复用的工具权限编辑组件 |
| `frontend/src/components/agents/tool-utils.ts`（可选） | 共享的工具辅助函数 |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `frontend/src/pages/HRManagement.tsx` | Tab 改造 + 新增数据查询 + 保存逻辑 |
| `frontend/src/pages/Tools.tsx` | `EditToolPermissionSetModal` 改为引用 `ToolPermissionSetEditor`，移除内联辅助函数 |

### 不变文件

| 文件路径 | 说明 |
|----------|------|
| `frontend/src/services/hrService.ts` | 无变更 |
| `frontend/src/services/agentService.ts` | 无变更，复用现有 API |
| `frontend/src/services/toolService.ts` | 无变更，复用 `getToolRegistry` |
| 后端所有文件 | 无变更，复用现有 API |

---

## 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 辅助函数迁出 Tools.tsx 后影响原有引用 | 低 | Tools.tsx 内其他位置也使用这些函数，确保改为 import |
| 创建模式下 Tab 2 不可用导致用户困惑 | 低 | Tab 禁用时显示明确提示文案 |
| 弹窗两个 Tab 独立保存可能导致部分失败 | 低 | 统一保存按钮，任一 API 失败时提示具体错误，不关闭弹窗 |
| HRManagement 新增两个 query 增加页面加载请求 | 低 | 使用 `enabled: isRoleModalOpen` 控制仅弹窗打开时才查询 |

---

## 预计工作量

| 步骤 | 工作量 |
|------|--------|
| Step 1: 抽取 ToolPermissionSetEditor | 30min |
| Step 2: 改造角色编辑弹窗 Tab | 1-1.5h |
| Step 3: 更新角色列表表格列 | 15min |
| Step 4: 验证 | 15min |
| **合计** | **2-2.5h** |
