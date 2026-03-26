# 研发需求管理优化（req-1774422637571-orkvyi）MVP 技术开发计划

## 1. 目标与边界（基于现状梳理）

### 1.1 锚定目标

- 锚定需求：`req-1774422637571-orkvyi`（研发需求管理优化）。
- MVP 范围：单项目需求台账、状态流转、优先级排序、负责人机制、基础看板、操作留痕。
- 强约束：与现有编排链路 `requirementId` 锚点兼容，不中断现有 Agent 工具调用。

### 1.2 当前实现边界（As-Is）

后端（EI）已具备：

- 数据模型：`ei_requirements`（含 `requirementId/title/status/priority/currentAssigneeAgentId/comments/assignments/statusHistory`）。
- API：`create/list/detail/delete/comment/assign/update-status/board/github-sync`。
- 状态机：`todo/assigned/in_progress/review/done/blocked`，并有转移校验。
- 基础看板：按状态列聚合返回。

前端已具备：

- 需求列表页：创建、按状态/关键词/项目筛选、跳转详情、GitHub 同步入口。
- 需求详情页：状态变更、分发（Agent）、讨论、状态轨迹、删除。
- 看板页：按状态泳道展示并 5 秒轮询。

当前与目标差距：

1. 状态语义与规格不完全一致（缺少 `open/verify/closed`，存在 `assigned/review` 旧语义）。
2. 列表/看板默认排序按 `updatedAt`，未体现“高优先级前置”。
3. 负责人模型偏 Agent（`currentAssigneeAgentId`），未抽象统一 Owner。
4. 操作留痕分散在 `statusHistory/assignments/comments`，缺少统一审计事件流。
5. 接口层缺少“台账视角”查询能力（排序字段、更多筛选、分页游标）。

---

## 2. 实现步骤拆解（按先后顺序）

### Step 1：状态机与兼容策略定稿（先协议后改造）

- 定义 MVP 目标状态：`todo/open/in_progress/verify/done/closed/blocked`。
- 定义兼容映射：`assigned -> open`、`review -> verify`（读写双向兼容过渡期）。
- 明确编排回写映射：`in_progress -> verify -> done`，保留旧值兼容处理。

### Step 2：Schema/DTO 扩展与数据迁移脚本

- 扩展需求模型：新增 `owner` 与 `operationLogs`，增强排序与审计字段。
- 扩展查询 DTO：支持 `priority/ownerId/sortBy/sortOrder/cursor/limit`。
- 提供一次性迁移脚本：旧状态批量映射、旧负责人字段回填 `owner`。

### Step 3：EI 需求服务改造（核心业务）

- 重构状态转移校验器（含目标状态与兼容别名处理）。
- 改造 `listRequirements/getRequirementBoard`：优先级排序优先，支持筛选与分页。
- 改造 `assign/updateStatus/comment/create/delete`：统一写入 `operationLogs`。

### Step 4：API 与 Agent 工具兼容升级

- EI Controller 增加或扩展台账参数（不破坏旧调用）。
- Agent `requirement` 工具参数跟进（支持新状态名与 owner 过滤）。
- 保持 `POST /status` 兼容路径，新增响应字段不影响旧消费者。

### Step 5：前端台账/详情/看板交互落地

- 需求列表：新增“优先级排序优先”的默认展示与可切换排序。
- 需求详情：负责人显示统一（Owner），状态按钮切换到新状态语义。
- 看板：泳道使用新状态列，并在兼容期可兜底显示旧状态数据。

### Step 6：联调与回归验证

- 覆盖 EI API、Agent MCP、前端页面三段联调。
- 验证与编排链路 `requirementId` 绑定不受影响。
- 完成验收映射清单（见第 5 节）。

---

## 3. 涉及文件/模块与接口清单（新增/修改点）

### 3.1 后端 EI（主要改造）

修改：

- `backend/apps/ei/src/schemas/ei-requirement.schema.ts`
  - 扩展 `status` 枚举为目标状态集（含兼容策略）。
  - 新增 `owner` 结构与 `operationLogs` 数组。
  - 新增组合索引：`status + priorityWeight + updatedAt`、`owner.ownerId + status + updatedAt`。
- `backend/apps/ei/src/dto/requirement.dto.ts`
  - `ListRequirementsDto` 增加筛选/排序/分页字段。
  - `AssignRequirementDto` 升级为可设置 `ownerType/ownerId/ownerName`（保留 `toAgentId` 兼容）。
  - `UpdateRequirementStatusDto` 增加兼容状态别名注释和校验。
- `backend/apps/ei/src/services/requirements.service.ts`
  - 重构 `requirementTransitions`。
  - 新增 `normalizeStatusAlias`、`appendOperationLog`、`buildLedgerQuery`。
  - 改造 `listRequirements/getRequirementBoard/assign/updateRequirementStatus/...`。
- `backend/apps/ei/src/controllers/requirements.controller.ts`
  - 透传新增查询参数；保留旧路由。

新增：

- `backend/apps/ei/scripts/migrate-requirement-status-owner.ts`
  - 一次性迁移：`assigned->open`、`review->verify`、owner 回填、历史事件补记。
- `backend/apps/ei/test/requirements.e2e-spec.ts`（或现有测试目录等价文件）
  - 状态机、排序、留痕、兼容路径回归。

### 3.2 Orchestration（兼容调整）

修改：

- `backend/src/modules/orchestration/services/plan-execution.service.ts`
  - 计划完成回写从 `review -> done` 调整为 `verify -> done`（兼容失败兜底）。
- `backend/src/modules/orchestration/services/orchestration-context.service.ts`
  - `tryUpdateRequirementStatus` 增加新状态调用注释与兜底映射。

### 3.3 Agents MCP 工具（参数同步）

修改：

- `backend/apps/agents/src/modules/tools/builtin/requirement-tool-handler.service.ts`
  - 新状态别名归一化（open/verify/closed + assigned/review 兼容）。
  - 新增 owner 过滤参数透传。
- `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
  - requirement 工具参数与描述更新。

### 3.4 前端（台账/详情/看板）

修改：

- `frontend/src/services/engineeringIntelligenceService.ts`
  - 类型定义升级：`RequirementStatus`、`RequirementOwner`、`RequirementOperationLog`。
  - 列表接口支持排序/owner 筛选参数。
- `frontend/src/pages/EngineeringRequirements.tsx`
  - 增加排序控件（默认 priority desc + updatedAt desc）。
  - 增加负责人筛选与显示统一。
- `frontend/src/pages/EngineeringRequirementDetail.tsx`
  - 状态操作切换为新语义；展示统一操作轨迹。
- `frontend/src/pages/EngineeringBoard.tsx`
  - 看板列调整为新状态集；兼容旧状态渲染。

---

## 4. 数据模型与状态机落地方案

### 4.1 需求数据模型（MVP）

在现有 `ei_requirements` 基础上扩展：

```ts
type RequirementOwner = {
  ownerType: 'human' | 'agent' | 'system';
  ownerId: string;
  ownerName?: string;
  assignedAt: Date;
};

type RequirementOperationLog = {
  logId: string;
  action:
    | 'created'
    | 'owner_assigned'
    | 'status_changed'
    | 'priority_changed'
    | 'comment_added'
    | 'github_synced'
    | 'deleted';
  operatorType: 'human' | 'agent' | 'system';
  operatorId?: string;
  operatorName?: string;
  from?: Record<string, unknown>;
  to?: Record<string, unknown>;
  note?: string;
  createdAt: Date;
};
```

字段策略：

- 保留旧字段：`currentAssigneeAgentId/currentAssigneeAgentName/assignments/statusHistory/comments`（兼容读取）。
- 新增统一字段：`owner`（当前负责人）+ `operationLogs`（统一操作审计）。
- 统一排序权重：运行时或持久化字段 `priorityWeight`（`critical=4/high=3/medium=2/low=1`）。

### 4.2 状态机（目标）

目标状态：

- `todo`：已建档待受理。
- `open`：已受理待执行（兼容 `assigned`）。
- `in_progress`：执行中。
- `verify`：待验收/评审（兼容 `review`）。
- `done`：已完成（可回退）。
- `closed`：已关闭归档（终态，允许受控 reopen）。
- `blocked`：阻塞。

允许流转（建议）：

- `todo -> open | blocked`
- `open -> in_progress | todo | blocked`
- `in_progress -> verify | blocked | todo`
- `verify -> done | in_progress | blocked`
- `done -> closed | in_progress | blocked`
- `closed -> open`（仅人工显式 reopen）
- `blocked -> todo | open | in_progress`

兼容期策略：

- 入参状态先 `normalizeStatusAlias`：`assigned=>open`、`review=>verify`。
- 出参默认返回新状态；若调用方显式 `compat=true` 可返回兼容别名（可选）。

### 4.3 与编排 requirementId 锚点贯通

- `requirementId` 继续作为唯一业务锚点，不改生成规则。
- Orchestration 回写维持 best-effort，不阻塞主流程。
- 计划执行完成写入 `verify/done`，失败时仅记录日志，不影响编排任务终态。

---

## 5. 测试要点与验收映射

| 验收项 | 测试要点 | 覆盖层 |
|------|------|------|
| 需求台账可建档查询 | 创建后可按状态/优先级/负责人/项目筛选；分页稳定 | EI API + 前端列表 |
| 状态流转受控 | 非法流转返回 400；兼容别名可正常转换 | EI API 单测/E2E |
| 优先级前置排序 | 默认排序为 `priority desc, updatedAt desc`；高优先需求前置 | EI API + 前端列表 |
| 负责人机制 | 可设置 owner（human/agent）；详情与列表显示一致 | EI API + 前端详情 |
| 基础看板 | 看板按新状态泳道聚合；轮询刷新正常 | EI API + 前端看板 |
| 操作留痕 | 创建/分配/状态变更/评论/GitHub 同步均落 `operationLogs` | EI API |
| 编排链路兼容 | Orchestration 触发回写后状态正确，`requirementId` 不变 | 编排集成回归 |

补充回归：

- `POST /ei/requirements/:id/status` 兼容接口仍可用。
- Agents requirement 工具对旧状态词与新状态词均可执行。
- GitHub issue 自动 close/reopen 与 `done/非done` 映射保持正确。

---

## 6. 技术风险与回滚思路

### 6.1 主要风险

1. **状态枚举升级破坏旧调用方**：Agent Prompt/工具可能继续发送 `assigned/review`。
2. **数据迁移不完整**：历史数据中缺少 assignee，owner 回填可能为空。
3. **排序策略变化引发体验差异**：业务方习惯“最近更新优先”。
4. **编排回写时序不一致**：`verify/done` 与旧 `review/done` 共存期可能出现混淆。

### 6.2 缓解措施

- 兼容层先行：状态别名归一化至少保留一个版本周期。
- 迁移脚本幂等：按批次执行并输出迁移报告（成功/跳过/异常）。
- 排序可配置：默认优先级排序，同时保留“最近更新”切换。
- 回写容错：Orchestration 仍 best-effort，失败不影响主执行链路。

### 6.3 回滚方案

**应用层回滚**（优先）：

- 回滚服务代码到上一版本，保留新增字段不使用。
- 将 API 响应切回旧状态字典（`assigned/review`）。

**数据层回滚**（必要时）：

- 执行反向脚本：`open->assigned`、`verify->review`（仅兼容窗口内执行）。
- `owner/operationLogs` 保留不删，避免二次破坏历史审计。

**流量层回滚**：

- 前端开关回退到旧状态按钮与旧排序。
- Agent 工具 catalog 切回旧参数描述。

---

## 7. MVP 不做项（保持与锚定规格一致）

- 跨项目资源优化算法。
- 复杂工时/成本核算。
- 自动排期智能推荐。
- 外部 IM/邮件深度集成。
- BI 大屏与高级预测分析。

以上项明确不进入本次开发与验收范围。
