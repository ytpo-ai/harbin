# 技术开发计划：研发需求管理优化（req-1774422637571-orkvyi）

## 0. 目标与范围

- 锚定需求：`req-1774422637571-orkvyi`（研发需求管理优化）。
- 本计划聚焦 MVP：需求台账、状态流转、优先级排序、负责人机制、基础看板、操作留痕，并保证与编排链路 `requirementId` 闭环对接。
- 本计划明确不做：跨项目资源优化算法、复杂工时/成本核算、自动排期智能推荐、IM/邮件深度集成、BI 大屏与高级预测分析。

## 1. 当前实现边界（As-Is）

### 1.1 已具备能力

1. **需求台账基础字段已落库**
   - 集合：`ei_requirements`。
   - 关键字段已存在：`requirementId/title/description/status/priority/currentAssignee*/createdAt/updatedAt`。
   - 代码：`backend/apps/ei/src/schemas/ei-requirement.schema.ts`。

2. **状态流转与负责人机制已可用（但语义偏旧）**
   - 当前状态枚举：`todo/assigned/in_progress/review/done/blocked`。
   - 流转校验在服务内硬编码：`EngineeringIntelligence.requirementTransitions`。
   - 分发接口：`POST /ei/requirements/:requirementId/assign`。
   - 代码：`backend/apps/ei/src/services/ei.service.ts`。

3. **基础看板与查询已可用**
   - 列表：`GET /ei/requirements`（支持状态、负责人、项目、搜索，默认按 `updatedAt desc`）。
   - 看板：`GET /ei/requirements/board`（按状态分列）。
   - 前端页：`/ei/requirements`、`/ei/board`。

4. **操作留痕已有分散记录**
   - `statusHistory`、`assignments`、`comments` 已记录关键事件。
   - 但缺少统一审计视图（按操作类型统一检索/展示）。

5. **与编排链路已打通 requirementId**
   - 编排执行会 best-effort 回写需求状态：启动写 `in_progress`，完成写 `review -> done`。
   - 代码：`backend/src/modules/orchestration/services/plan-execution.service.ts`、`backend/src/modules/orchestration/services/orchestration-context.service.ts`。

### 1.2 与本次规格的主要差距

- 状态语义与规格不完全一致（规格倾向 `open/verify/closed`，现为 `assigned/review/done`）。
- 列表排序未体现“高优先级前置”的默认策略（仅 `updatedAt` 排序）。
- 缺少“更新需求元信息（标题/描述/优先级/负责人）”统一接口，流程“创建-分派-更新-关闭”中的“更新”能力不完整。
- 操作留痕分散，无法一站式输出审计时间线。

## 2. 最小可落地方案（To-Be）

## 2.1 实现步骤拆解（按先后顺序）

1. **统一状态词汇与兼容映射（先不做重迁移）**
   - 引入“规范状态别名层”：`open -> assigned`、`verify -> review`、`closed -> done`（MVP 兼容策略）。
   - API 接受新旧状态入参，内部统一映射后落库，避免一次性迁移风险。

2. **补齐需求“更新”接口，形成完整最小闭环**
   - 新增 `PATCH /ei/requirements/:requirementId`：支持更新标题、描述、优先级、负责人（可选重置）、标签。
   - 与现有 `assign/status/comment` 并存，减少调用方改造成本。

3. **落实优先级排序前置规则**
   - `GET /ei/requirements` 增加默认排序：`priorityWeight desc, updatedAt desc`。
   - 保留可选排序参数（如 `sortBy=updatedAt|priority`，`sortOrder=asc|desc`）。

4. **统一操作留痕模型与查询输出**
   - 新增 `operationLogs`（create/update/assign/status/comment/close/sync_github）。
   - 各写操作统一调用 `appendOperationLog`，并保持 `statusHistory/assignments/comments` 兼容。

5. **看板与列表按规范语义展示**
   - 前端展示层引入状态别名文案（Open/Verify/Closed），后端保留兼容。
   - 看板维持基础泳道，确保现有页面低风险升级。

6. **联动编排链路与工具层兼容**
   - `requirement-tool-handler` 状态规范化支持新旧别名。
   - 编排状态回写继续走旧值（兼容），由 EI 状态映射层统一处理。

7. **验证与灰度发布**
   - 后端先行，前端随后；启用兼容模式后灰度验证。
   - 验证通过后更新 feature/api/technical 文档并收口。

## 2.2 涉及文件/模块与接口清单（新增/修改点）

### A. 后端 EI（核心）

- 修改 `backend/apps/ei/src/schemas/ei-requirement.schema.ts`
  - 新增：`operationLogs`（统一审计数组）。
  - 可选新增索引：`{ priority: 1, updatedAt: -1 }`。

- 修改 `backend/apps/ei/src/dto/requirement.dto.ts`
  - 新增 `UpdateRequirementDto`。
  - 扩展 `ListRequirementsDto`：`sortBy/sortOrder/priority`。
  - `UpdateRequirementStatusDto` 支持别名状态入参。

- 修改 `backend/apps/ei/src/controllers/requirements.controller.ts`
  - 新增 `PATCH /ei/requirements/:requirementId`。
  - `GET /ei/requirements` 支持新查询参数。

- 修改 `backend/apps/ei/src/services/ei.service.ts`
  - 新增状态别名映射与统一校验。
  - 实现需求更新方法。
  - 调整列表排序逻辑。
  - 增加统一操作留痕写入函数。

- 修改 `backend/apps/ei/src/services/requirements.service.ts`
  - 透传新增更新接口。

### B. Agents 工具层

- 修改 `backend/apps/agents/src/modules/tools/builtin/requirement-tool-handler.service.ts`
  - 扩展 `normalizeRequirementStatus`（支持 `open/verify/closed`）。
  - 可选新增 `requirement.update` 工具调用封装。

- 修改 `backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
  - 新增/更新工具元数据与参数定义（如 `requirement.update`、状态枚举说明）。

### C. 编排链路（仅兼容性微调）

- 修改 `backend/src/modules/orchestration/services/orchestration-context.service.ts`
  - `DomainStatus` 类型支持别名状态（或继续旧值由 EI 映射）。

### D. 前端

- 修改 `frontend/src/services/engineeringIntelligenceService.ts`
  - 增加 `updateRequirement` API。
  - 扩展 `listRequirements` 查询参数。

- 修改 `frontend/src/pages/EngineeringRequirements.tsx`
  - 增加优先级排序控件（默认高优先级优先）。
  - 增加负责人筛选（最小可用）。

- 修改 `frontend/src/pages/EngineeringRequirementDetail.tsx`
  - 替换 prompt 式更新为表单式“更新需求元信息”。
  - 展示统一操作时间线（operationLogs）。

- 修改 `frontend/src/pages/EngineeringBoard.tsx`
  - 使用规范状态文案别名渲染（Open/Verify/Closed）。

### E. 文档

- 修改 `docs/api/engineering-intelligence-api.md`（补充新增接口与查询参数）。
- 修改 `docs/feature/ENGINEERING_INTELLIGENCE.md`（状态语义与排序规则）。
- 新增/更新 `docs/technical/*`（本方案文档）。

## 2.3 数据模型与状态机落地方案

### 2.3.1 数据模型（MVP）

在 `EiRequirement` 中新增统一审计结构：

```ts
type RequirementOperationLog = {
  logId: string;
  action: 'create' | 'update' | 'assign' | 'status_change' | 'comment' | 'sync_github' | 'close';
  actorId?: string;
  actorName?: string;
  actorType: 'human' | 'agent' | 'system';
  fromStatus?: string;
  toStatus?: string;
  patch?: Record<string, unknown>;
  note?: string;
  createdAt: Date;
};
```

说明：
- `statusHistory/assignments/comments` 保留不动（兼容历史数据与现有页面）。
- `operationLogs` 作为统一审计主视图，供列表/详情与验收统计使用。

### 2.3.2 状态机（MVP 兼容版）

1. **存储层状态（保持当前）**：`todo/assigned/in_progress/review/done/blocked`。
2. **规范语义别名（展示/接口层）**：
   - `open => assigned`
   - `verify => review`
   - `closed => done`
3. **流转约束（存储态）**：
   - `todo -> assigned|blocked`
   - `assigned -> in_progress|todo|blocked`
   - `in_progress -> review|blocked|todo`
   - `review -> done|in_progress|blocked`
   - `done -> todo`
   - `blocked -> todo|assigned|in_progress`

该策略可满足“open/in_progress/review/verify/done/closed”语义表达，同时避免历史数据迁移。

## 2.4 测试要点与验收映射

| 验收项 | 测试要点 | 验收标准 |
|---|---|---|
| 需求台账 | 创建后检查字段完整性（ID、标题、状态、优先级、负责人、时间） | `GET /ei/requirements/:id` 返回完整且可追踪 |
| 状态流转 | 覆盖合法/非法流转；别名状态入参 | 合法通过、非法返回 400，错误信息明确 |
| 优先级排序 | 构造 mixed priority 数据集验证默认顺序 | 默认列表高优先级前置，次序稳定 |
| 负责人机制 | 分派、改派、取消负责人路径 | `currentAssignee*` 与 `assignments`/`operationLogs` 一致 |
| 基础看板 | 状态变化后看板列归属与计数刷新 | 看板列与列表状态一致，无脏读 |
| 操作留痕 | create/update/assign/status/comment/sync 全链路 | 详情页时间线可还原操作顺序与操作者 |
| 编排对接 | 运行编排计划触发需求状态回写 | requirementId 锚点需求可看到 `in_progress -> review/done` 轨迹 |

建议自动化覆盖：
- 后端单测：状态映射、流转校验、排序函数、操作日志写入。
- 后端集成：`requirements.controller` 关键 API（含异常分支）。
- 前端最小回归：列表排序、详情更新、看板列归属。

## 2.5 技术风险与回滚思路

1. **风险：状态别名与旧调用方认知不一致**
   - 规避：接口层双向兼容，日志打印 normalized 状态。
   - 回滚：关闭别名转换，仅接受旧状态枚举。

2. **风险：新增 `operationLogs` 造成文档体积增长**
   - 规避：限制单条日志 payload 大小，必要时仅存 diff key。
   - 回滚：保留旧字段写入，停用 `operationLogs` 展示。

3. **风险：优先级排序变更影响现有使用习惯**
   - 规避：保留 `sortBy/sortOrder` 显式参数可覆盖默认行为。
   - 回滚：列表默认排序切回 `updatedAt desc`。

4. **风险：编排回写状态与新语义冲突**
   - 规避：编排侧暂不改协议，EI 统一映射。
   - 回滚：回写失败维持 best-effort，不阻断编排主流程。

5. **风险：前端页面改动导致交互回归**
   - 规避：先后端灰度，再逐页切换。
   - 回滚：保留旧交互入口（assign/status/comment）并可快速回退。

## 3. 交付里程碑（建议）

- M1（后端能力完成）：状态别名 + 更新接口 + 排序 + 操作留痕。
- M2（前端完成）：列表/详情/看板接入新能力并保持兼容。
- M3（联调验收）：与 agents/orchestration 闭环验证 + 文档更新。

## 4. 执行完成定义（DoD）

- 锚定需求 `req-1774422637571-orkvyi` 的完整生命周期可执行：创建、分派、更新、状态流转、关闭。
- 默认列表具备高优先级前置与负责人筛选能力。
- 看板、详情、工具调用、编排回写对同一 `requirementId` 行为一致。
- 审计留痕可按时间线还原关键操作。
- API/功能/技术文档同步更新，测试通过。
