# CTO Agent 日常研发工作流改造计划

## 1. 背景与目标

### 1.1 背景

当前系统已具备以下独立能力：
- **需求管理**（EI 服务）：需求创建、状态流转、分发、讨论、GitHub Issues 同步
- **任务编排**（Orchestration）：自然语言拆解、顺序/并行/混合执行、调度器
- **Agent Runtime**：run 生命周期、OpenCode 执行桥接、Hook 事件体系、EI 同步

但这三层能力之间 **缺乏闭环串联**，无法实现 CTO Agent 驱动的自动化研发工作流：
> 读取需求 → 规划/拆解任务 → 分发给执行 Agent → 监控 OpenCode 执行 → 验证完成 → 更新需求状态 → 同步 GitHub Issues

### 1.2 目标

构建 **CTO Agent 日常研发工作流**，实现：
1. CTO Agent 通过 MCP 工具读取、创建、分配、流转需求
2. CTO Agent 将需求拆解为编排任务，任务关联回需求
3. 执行 Agent（fullstack-engineer / devops-engineer / technical-architect）通过 OpenCode 完成开发
4. 任务完成后自动回写需求状态，同步关闭 GitHub Issue
5. 全流程可在定时调度或 CTO 主动触发下运行，不强依赖会议上下文

### 1.3 架构定位

采用 **两层架构**：

| 层级 | 角色 | 职责 |
|------|------|------|
| 治理层（Orchestration） | CTO Agent | 读需求、拆任务、分发、监控、验收、关闭反馈环 |
| 执行层（OpenCode） | 研发 Agent | 接收任务 prompt → OpenCode session → 编码/测试/提交 |

**关键原则**：CTO Agent 不写代码，只做编排、治理和验收。

---

## 2. 现状差距分析（6 项关键缺口）

### Gap 1：无需求管理 MCP 工具

**现状**：需求管理仅有 HTTP API（`/engineering-intelligence/requirements/*`），Agent 无法通过 MCP 工具操作需求。

**影响**：CTO Agent 在会议/编排中无法读取、创建、分配、流转需求。

### Gap 2：编排任务无 `requirementId` 关联

**现状**：`orchestration_tasks` schema 无字段关联回 `ei_requirements`。

**影响**：任务完成后无法自动触发需求状态更新，闭环断裂。

### Gap 3：OpenCode 角色门禁排除 CTO

**现状**：Runtime 角色准入仅允许 `devops-engineer`、`fullstack-engineer`、`technical-architect`。

**影响**：CTO Agent 无法触发 OpenCode 执行（即使是为其他 Agent 代理触发）。注意：本改造中 CTO 不直接执行 OpenCode，但编排触发链路需要能以 CTO 身份发起任务分发。

### Gap 4：编排 MCP 工具强依赖会议上下文

**现状**：全部 10 个编排工具 + 3 个会议工具在执行前调用 `assertMeetingContext()`，无会议上下文时抛错。

**影响**：定时调度（cron）、CTO 主动触发等非会议场景无法使用编排 MCP 工具。

### Gap 5：GitHub 同步仅创建不关闭

**现状**：`syncRequirementToGithub` 仅创建 Issue 并回写映射，不会在需求 `done` 时关闭 Issue。

**影响**：需求关闭后 GitHub Issue 仍为 open 状态，信息不一致。

### Gap 6：无代码级完成验证门禁

**现状**：任务完成验证仅检查邮件/调研类证明（EMAIL_SEND_PROOF / RESEARCH_EXECUTION_PROOF），无代码构建/测试/lint 验证。

**影响**：开发类任务无法自动化验收，需人工确认。

---

## 3. 执行步骤

### 步骤 1：新增需求管理 MCP 工具（Gap 1）

在 `tool.service.ts` 中注册需求管理 MCP 工具，代理到 EI 服务 HTTP API：

| 工具 ID | 功能 | 代理接口 |
|---------|------|----------|
| `builtin.sys-mg.mcp.requirement.list` | 列出需求（支持状态/负责人/项目筛选） | `GET /engineering-intelligence/requirements` |
| `builtin.sys-mg.mcp.requirement.get` | 获取需求详情 | `GET /engineering-intelligence/requirements/:id` |
| `builtin.sys-mg.mcp.requirement.create` | 创建需求 | `POST /engineering-intelligence/requirements` |
| `builtin.sys-mg.mcp.requirement.update-status` | 流转需求状态 | `PATCH /engineering-intelligence/requirements/:id/status` |
| `builtin.sys-mg.mcp.requirement.assign` | 分配需求负责人 | `PATCH /engineering-intelligence/requirements/:id/assign` |
| `builtin.sys-mg.mcp.requirement.comment` | 追加讨论 | `POST /engineering-intelligence/requirements/:id/comments` |
| `builtin.sys-mg.mcp.requirement.sync-github` | 同步到 GitHub Issue | `POST /engineering-intelligence/requirements/:id/sync-github` |
| `builtin.sys-mg.mcp.requirement.board` | 看板视图（按状态泳道聚合） | `GET /engineering-intelligence/requirements/board` |

**实现要点**：
- 复用现有编排工具的 API 代理模式（`callOrchestrationApi` → `callEiApi`）
- 工具定义注册到 `getBuiltinToolDefinitions()`
- 执行分发加入 `executeToolImplementation` switch-case
- **不要求会议上下文**（与编排工具区分）

**涉及文件**：
- `backend/apps/agents/src/modules/tools/tool.service.ts`

### 步骤 2：编排任务关联需求（Gap 2）

在 `orchestration_tasks` schema 中新增可选字段：

```typescript
@Prop({ type: Types.ObjectId, ref: 'EiRequirement', required: false })
requirementId?: Types.ObjectId;
```

**配套修改**：
- `orchestration.service.ts`：创建任务时透传 `requirementId`
- `planner.service.ts`：在 AI 拆解 prompt 中支持携带来源需求 ID
- `create-plan` MCP 工具：参数新增可选 `requirementId`
- 任务完成回调中：若任务关联需求且计划下所有任务完成，自动触发需求状态流转

**涉及文件**：
- `backend/src/shared/schemas/orchestration-task.schema.ts`
- `backend/src/modules/orchestration/orchestration.service.ts`
- `backend/src/modules/orchestration/planner.service.ts`

### 步骤 3：放宽编排 MCP 工具的会议上下文约束（Gap 4）

**策略**：引入 **上下文分级**，而非简单移除断言。

| 级别 | 适用场景 | 要求 |
|------|----------|------|
| `meeting` | 会议中使用 | 完整会议上下文（现有逻辑） |
| `autonomous` | 定时调度 / CTO 主动触发 | 仅需 `organizationId` + `agentId`（不要求 meetingId） |

**实现方式**：
- 在 `assertMeetingContext` 旁新增 `assertExecutionContext`，接受 meeting 或 autonomous 两种模式
- 编排工具按需切换：`create-plan`、`run-plan`、`update-plan` 等允许 autonomous 模式
- 会议工具保持 meeting 模式不变
- 调度器触发时注入 autonomous 上下文

**涉及文件**：
- `backend/apps/agents/src/modules/tools/tool.service.ts`（上下文断言）
- `backend/src/modules/orchestration/scheduler/scheduler.service.ts`（调度触发上下文）

### 步骤 4：CTO 角色编排权限适配（Gap 3）

**策略**：CTO 不需要直接执行 OpenCode，但需要能通过编排系统分发任务给执行 Agent。

- 编排系统任务分配时，执行者由任务 `assignment` 决定（目标 Agent 的角色），不受发起者角色限制
- 确认 CTO Agent 可以调用编排 MCP 工具（步骤 3 已解决上下文问题）
- 确认编排执行链路中 `runTaskForAgent` 使用目标 Agent 身份启动 OpenCode session，而非发起者身份

**涉及文件**：
- `backend/src/modules/orchestration/orchestration.service.ts`（任务执行入口）
- `backend/apps/agents/src/modules/agents/agent.service.ts`（OpenCode 角色门禁确认）

### 步骤 5：GitHub Issue 生命周期同步（Gap 5）

在需求状态流转到 `done` 时，自动关闭关联的 GitHub Issue：

```typescript
// engineering-intelligence.service.ts - updateRequirementStatus
if (newStatus === 'done' && requirement.github?.issueNumber) {
  await this.closeGithubIssue(requirement);
}
```

**补充能力**：
- 新增 `closeGithubIssue` 方法：调用 GitHub API `PATCH /repos/:owner/:repo/issues/:number` 设置 `state: 'closed'`
- 需求从 `done` 回退时，重新 open Issue（幂等）
- 错误处理：GitHub API 失败不阻塞状态流转，记录 `syncError` 供后续补偿

**涉及文件**：
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts`

### 步骤 6：代码级完成验证门禁（Gap 6）

新增 `CODE_EXECUTION_PROOF` 验证策略，用于开发类任务：

**验证内容**：
- OpenCode session 中是否有 `build` / `test` / `lint` 命令执行记录
- 最终命令退出码是否为 0
- 是否产生了代码变更（git diff 非空）

**实现层级**：
- 在 `orchestration.service.ts` 的任务完成验证逻辑中，新增 `code` 类型任务的验证分支
- 验证数据来源于 OpenCode session events（通过 EI 同步数据或 Runtime events）

**涉及文件**：
- `backend/src/modules/orchestration/orchestration.service.ts`（验证逻辑）
- `backend/apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts`（提供验证数据查询）

### 步骤 7：CTO Agent 工作流编排 Prompt 与调度

最终串联步骤，定义 CTO Agent 的工作流调度：

**CTO Agent 日常工作流 Prompt**（系统级）：
1. 调用 `requirement.list` 获取 `todo` 状态需求
2. 对每个需求调用 `requirement.update-status` → `assigned`
3. 调用 `create-plan` 拆解需求为编排任务（携带 `requirementId`）
4. 调用 `run-plan` 执行编排
5. 监控任务状态，任务全部完成后：
   - 调用 `requirement.update-status` → `review` → `done`
   - 自动触发 GitHub Issue 关闭
6. 异常处理：任务失败 → 需求标记 `blocked`，追加讨论说明

**调度方式**：
- 通过 `orchestration_schedules` 创建定时计划，每日早上触发
- 或 CTO Agent 在会议中手动触发

---

## 4. 关键影响点

| 维度 | 影响范围 |
|------|----------|
| **后端（agents 服务）** | tool.service.ts 新增 8 个 MCP 工具、上下文断言重构 |
| **后端（主 backend）** | orchestration-task schema 新增 requirementId、编排服务任务完成回调 |
| **后端（EI 服务）** | GitHub Issue 关闭能力、代码验证数据查询接口 |
| **数据库** | `orchestration_tasks` 新增 `requirementId` 字段与索引 |
| **调度器** | 支持 autonomous 上下文注入 |
| **文档** | 功能文档、API 文档、dailylog |

---

## 5. 执行优先级与依赖

```
步骤 1（需求 MCP 工具） ──────────────────────────────┐
步骤 2（任务关联需求）   ──→ 步骤 7（工作流串联与调度）──→ 验收
步骤 3（放宽会议上下文） ──────────────────────────────┘
步骤 4（CTO 角色适配）   ─────┘
步骤 5（GitHub 生命周期） ── 可独立交付
步骤 6（代码验证门禁）   ── 可独立交付，优先级较低
```

**建议分批交付**：

| 批次 | 步骤 | 交付物 |
|------|------|--------|
| P0（核心闭环） | 1 + 2 + 3 + 4 | CTO Agent 可读需求→拆任务→分发执行→回写状态 |
| P1（GitHub 联动） | 5 | 需求 done 自动关闭 GitHub Issue |
| P2（质量门禁） | 6 | 开发类任务自动验证构建/测试/lint |
| P3（工作流调度） | 7 | 定时触发 CTO 日常工作流 |

---

## 6. 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 编排上下文分级引入新的权限漏洞 | autonomous 模式下工具可能被非预期调用 | autonomous 模式仅限 CTO 角色 + 调度器内部触发 |
| GitHub API 调用频率限制 | 大量需求同时关闭时可能触发 rate limit | 批量操作排队 + 指数退避重试 |
| 任务→需求回写竞态 | 并行任务同时更新需求状态 | 使用 MongoDB findOneAndUpdate 原子操作 |
| 代码验证门禁误判 | 某些合法场景无 build/test 输出 | 门禁设为 warning 而非 hard block，CTO 可覆盖 |
| 内存锁不持久化 | 编排执行中进程重启导致状态丢失 | 现有问题，本次不在 scope 内，后续独立改进 |

---

## 7. 完成标准

- [ ] CTO Agent 可通过 MCP 工具完成需求全生命周期操作（list/create/assign/status/comment/board/sync-github）
- [ ] 编排任务支持关联 requirementId，任务完成后自动回写需求状态
- [ ] 编排 MCP 工具支持 autonomous 模式（不依赖会议上下文）
- [ ] CTO Agent 可在非会议场景下发起编排计划
- [ ] 需求状态流转到 done 时自动关闭关联 GitHub Issue
- [ ] 开发类任务完成时验证 build/test/lint 执行证据（warning 级）
- [ ] 日常工作流可通过调度器定时触发或 CTO 手动触发
- [ ] 相关功能文档、API 文档、dailylog 按规范更新
