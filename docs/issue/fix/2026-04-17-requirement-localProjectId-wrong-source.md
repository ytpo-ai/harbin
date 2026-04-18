# Fix 记录：需求列表项目字段显示原始 ID — Agent 创建需求写入了错误的 localProjectId

## 1. 基本信息

- 标题：Agent 创建需求写入了 IncubationProject ID 而非 local RdProject ID，导致项目字段显示和筛选异常
- 日期：2026-04-17
- 负责人：AI Agent
- 关联 Requirement：
- 所属 Feature：[研发需求管理](../../feature/ENGINEERING_INTELLIGENCE.md)
- 需求管理 ID：
- OpenCode Session：
- 是否落盘（用户确认）：是
- 关联 Fix：[需求列表排序倒序 & 项目过滤兼容 projectId](./2026-04-17-requirement-list-sort-and-project-filter.md)（该文档"后续优化"已预警此问题）

## 2. 问题现象

- 用户侧表现：
  1. 需求列表"项目"列显示 MongoDB ObjectId（如 `69da2b847e8280b9755af603`）或其他非项目名称的字符串（如 `gift_designer`），而非人类可读的项目名称
  2. "全部项目"筛选下拉选择特定项目后，Agent 创建的需求可能不被命中
- 触发条件：需求通过 Agent 工具（orchestration → engineering-requirement-tool-handler）创建
- 影响范围：所有通过 Agent orchestration 流程创建的需求
- 严重程度：高

## 3. 根因分析

### 3.1 数据流全链路

```
Agent.projectId (IncubationProject._id)
  ↓
plan.projectId = agent.projectId (plan-management.service.ts:64-116)
  ↓
planProjectId = resolvePlanProjectId(planId) (orchestration-execution-engine.service.ts:82,992-999)
  ↓
resolveProjectBinding(planProjectId) → { localPath, opencodeProjectPath, localProjectId }
  ↓ (localProjectId 已正确解析为 local RdProject._id，但未被透传)
collaborationContext = {
  projectId: planProjectId,           ← IncubationProject._id ❌
  projectBinding: { localPath, opencodeProjectPath }  ← 缺少 localProjectId ❌
}
  ↓
engineering-requirement-tool-handler.createRequirement():
  localProjectId = collaborationContext.projectId  ← IncubationProject._id ❌
  projectId      = collaborationContext.projectId  ← IncubationProject._id ❌
```

### 3.2 直接原因

1. **`ProjectBinding` 接口缺少 `localProjectId` 字段**
   - 文件：`backend/libs/contracts/src/collaboration-context.types.ts:33-36`
   - `resolveProjectBinding()` 返回了 `localProjectId`，但 `ProjectBinding` 类型只有 `localPath` 和 `opencodeProjectPath`，导致该字段在传入 `collaborationContext` 时丢失

2. **`collaborationContext.projectId` 传的是 IncubationProject `_id`**
   - 文件：`backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts:88`
   - `planProjectId` 来源于 `plan.projectId`，而 `plan.projectId` 继承自 `agent.projectId`
   - `agent.projectId` 存储的是 **IncubationProject** 的 `_id`（前端 Agent 配置下拉使用 incubationProjectService.list()）

3. **`createRequirement` 的 fallback 链无法取到正确的 local RdProject ID**
   - 文件：`backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts:206-207`
   - fallback 链：`params.localProjectId → params.projectId → executionContext.projectId → collaborationContext.projectId`
   - 所有 fallback 都指向 IncubationProject `_id`，没有任何路径能获取到 local RdProject `_id`

### 3.3 前端项目名称解析失败

- 文件：`frontend/src/pages/EngineeringRequirements.tsx:90-100,457`
- 前端通过 `getProjects({ sourceType: 'local' })` 获取 local RdProject 列表，构建 `Map<RdProject._id, RdProject>`
- 需求的 `localProjectId` 实际存的是 IncubationProject `_id`，无法在 Map 中命中，fallback 显示原始 ID

### 3.4 相关模块/文件

| 模块 | 文件 | 关键行 |
|---|---|---|
| ProjectBinding 类型 | `backend/libs/contracts/src/collaboration-context.types.ts` | 33-36 |
| Orchestration 执行引擎 | `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | 82-89, 905-986 |
| Agent Requirement 工具 | `backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts` | 206-207 |
| 前端需求列表 | `frontend/src/pages/EngineeringRequirements.tsx` | 90-100, 457 |
| ToolExecutionContext 类型 | `backend/apps/agents/src/modules/tools/tool-execution-context.type.ts` | 22 |
| Agent Schema | `backend/apps/agents/src/schemas/agent.schema.ts` | 118-119 |
| Plan 管理 | `backend/src/modules/orchestration/planner.service.ts` | 64-116 |

## 4. 修复方案

### 4.1 修复策略

从**数据源头**解决：确保 `collaborationContext` 中携带正确的 local RdProject `_id`，让 `createRequirement` 能写入正确的 `localProjectId`。

### 4.2 代码改动点

#### 改动 1：`ProjectBinding` 接口添加 `localProjectId`

文件：`backend/libs/contracts/src/collaboration-context.types.ts`

```typescript
export interface ProjectBinding {
  localPath?: string;
  opencodeProjectPath?: string;
  localProjectId?: string;            // 新增：local RdProject._id
}
```

#### 改动 2：`ToolExecutionContext` 注释更正

文件：`backend/apps/agents/src/modules/tools/tool-execution-context.type.ts`

`projectId` 字段的 JSDoc 注释应明确说明这是 plan 级别的项目 ID（可能是 IncubationProject ID），不等同于 ei_projects 中的 local project ID。

#### 改动 3：`createRequirement` 优先使用 `projectBinding.localProjectId`

文件：`backend/apps/agents/src/modules/tools/builtin/engineering-requirement-tool-handler.service.ts`

在 `localProjectId` 的 fallback 链中，**优先读取 `collaborationContext.projectBinding.localProjectId`**：

```typescript
localProjectId: String(
  params?.localProjectId
  || (executionContext?.collaborationContext as any)?.projectBinding?.localProjectId
  || params?.projectId
  || executionContext?.projectId
  || (executionContext?.collaborationContext as any)?.projectId
  || ''
).trim() || undefined,
```

### 4.3 兼容性处理

- 已创建的需求（localProjectId 为 IncubationProject ID 的历史数据）不自动迁移，可通过后续脚本批量修正
- 前端 `localProjectById` 映射逻辑不变，修复后新创建的需求将正确关联 local RdProject ID

## 5. 验证结果

- 验证步骤：
  1. 确认 `resolveProjectBinding()` 已返回 `localProjectId`（line 957），且 `ProjectBinding` 接口已补齐该字段
  2. 确认 `createRequirement` fallback 链已优先读取 `projectBinding.localProjectId`
  3. 运行 `tsc --noEmit` 全量类型检查 — 通过，无错误
  4. 运行 ESLint 对 3 个改动文件检查 — 通过，无警告
- 验证结论：修复已完成，新创建的 Agent 需求将正确写入 local RdProject._id 作为 localProjectId
- 测试与检查：TypeScript 编译通过、ESLint 通过；需部署后通过 Agent 创建需求进行端到端验证

## 6. 风险与后续

- 已知风险：
  - 历史数据中 `localProjectId` 为 IncubationProject ID 的需求仍会显示异常，需批量修正
- 后续优化：
  - 编写数据修正脚本：通过 IncubationProject ID 反查 local RdProject ID，批量更新历史需求
  - 长期方向：统一 `projectId` 字段语义，减少 `localProjectId` / `projectId` 二义性
- 是否需要补充功能文档/API文档：否
