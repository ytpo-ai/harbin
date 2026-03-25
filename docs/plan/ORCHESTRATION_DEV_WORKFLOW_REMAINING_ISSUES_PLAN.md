# 编排开发工作流 - 待完成问题 Plan

## 上游背景

上一 session 已完成的改动（commit `0085756`）：
- `resolveRuntimeChannelHint` 支持 review 类型路由到 opencode
- 增量规划 task 自动填充 `dependencyTaskIds`
- planner `outputSummary` 截断限制 500→2000
- opencode message 请求超时 120s→30min
- Worker 活动感知超时（方案 A 事件桥接 + 方案 B 轮询兜底）
- `isResearchTask` 关键词收紧
- step0 完成后动态回写 plan `requirementId`
- Prompt 模板更新（taskType 约束 + 输出契约）

验证进度：step0 ✅ step1 ✅ step2 in_progress（路由到 opencode 成功，超时已解决）

---

## 1. 【严重】开发任务被错误分配给非开发角色（CTO助理-小吴）

### 现象

step2 planner 生成任务时，将技术方案制定任务分配给了 **CTO助理-小吴**（role=`role-management-assistant`），而不是技术专家或全栈开发。CTO助理没有 opencode 执行能力（`exec.provider=NOT_SET`），导致任务被路由到 native 引擎，无法执行代码操作。

日志证据：
```
[execution_route] agent=CTO助理-小吴 taskType=development channel=native source=opencode_disabled opencodeEnabled=false
```

### 根因分析方向

需要排查 **executor selection** 链路（`executor-selection.service.ts`）：

1. **Planner 分配的 agentId 是否正确**：检查 planner 生成的 `taskResult.agentId` 是否指向了 CTO助理而非技术专家
2. **Fallback 逻辑是否错误**：如果 planner 没有指定 agentId，fallback 逻辑是否将 development 类型任务错误地分配给了管理助理
3. **Agent 发现指令是否充分**：planner 的 `agentManifest` 中是否包含足够信息让 planner 区分技术角色和管理角色
4. **角色能力匹配**：`resolveAssignmentForPlannerTask` 方法是否基于 taskType 过滤可用 agent

### 修复方向

- 在 `resolveAssignmentForPlannerTask` 或 executor selection 中，development/review 类型任务必须分配给 opencode-enabled 的 agent
- 或者在 Prompt 的 step 定义中，更精确地指定执行角色的 agent name/role，而不是让 planner 自由选择

### 相关文件

| 文件 | 说明 |
|------|------|
| `backend/src/modules/orchestration/services/executor-selection.service.ts` | executor 选择逻辑 |
| `backend/src/modules/orchestration/services/incremental-planning.service.ts` | `resolveAssignmentForPlannerTask` |
| `backend/src/modules/orchestration/services/planning-context.service.ts` | `buildAgentDiscoveryInstruction` |
| `backend/src/modules/orchestration/planner.service.ts` | planner prompt 构建 |

---

## 2. 【中等】`getSessionStatus` 活跃检测始终返回 false

### 现象

Worker 活动感知日志显示：
```
[activity_check] taskId=xxx sessionId=xxx active=false lastActivityAt=n/a
```

即使 opencode 正在正常执行，`getSessionStatus` 始终返回 `active=false`。

### 根因分析方向

`getSessionStatus` 解析 opencode `GET /session/:id` 返回的 message 格式可能与预期不同。需要确认：
1. opencode API 返回的 session 对象结构
2. message 是否包含 `status` 字段
3. `role === 'assistant'` 的判断是否正确

### 影响

当前不影响流程执行（因为 inactivityTimeout 设置了 5 分钟，加上绝对超时 30 分钟兜底）。但如果 opencode 真的卡死，5 分钟后才能检测到，而不是实时感知。

### 修复方向

1. 在本地调用 `GET /session/:id` 查看实际返回 JSON 结构
2. 根据实际结构调整 `getSessionStatus` 的解析逻辑
3. 补充日志输出 session 原始响应，方便调试

---

## 3. 【中等】`tryBackfillRequirementId` 正则匹配不稳定

### 现象

step0 output 中 requirementId 格式为换行分隔（`requirementId\nreq-xxx`），第一版正则 `requirementId[=：:]` 无法匹配。已修复为 `requirementId[=：:\s]*`，但仍需覆盖更多格式变体。

### 修复方向

- 补充测试用例覆盖常见 agent 输出格式
- 考虑用更宽松的模式：在 output 中搜索 `req-` 前缀的 ID

---

## 4. 【低等】step0/step1 完成后 planner 上下文中需求详情仍可能为空

### 现象

`tryBackfillRequirementId` 在 step0 完成后回写 requirementId，但 step1 的 planner context 构建（`buildPlannerContext`）调用 `buildRequirementDetail` 时，如果 step0 回写在同一轮 `executePlanningStep` 中还未持久化到 DB，后续 step 的 planner 可能仍看不到 requirementDetail。

### 影响

planner 生成 step2/step3/step4 时可能缺少需求详情上下文。但由于已有 `dependencyContext`（完整前序 output），实际影响较小。

### 修复方向

确保 `tryBackfillRequirementId` 的 `updateOne` 在 `buildPlannerContext` 之前完成（当前已是顺序执行，应该没问题，但需确认）。

---

## 5. 待验证项

| 项目 | 状态 | 说明 |
|------|------|------|
| step0 → step1 流程 | ✅ 通过 | general 类型，需求详情完整 |
| step2 opencode 路由 | ✅ 通过 | development → opencode |
| step2 超时不再发生 | ⏳ 待确认 | axios 30min + 活动感知超时已部署 |
| step2 执行完成 | ⏳ 待确认 | 需在新 session 中继续观察 |
| step3 开发执行 | ⏳ 待验证 | development → opencode |
| step4 review 路由 | ⏳ 待验证 | review → opencode |
| 全流程 step0→step4 | ⏳ 待验证 | 需完整跑通一次 |

---

## 6. 实施优先级

1. **P0 — 修复 executor selection 错误分配**（问题 1）：开发任务被分配给 CTO助理是阻塞性问题
2. **P1 — 修复 getSessionStatus 活跃检测**（问题 2）：影响超时检测准确性
3. **P2 — 完善 requirementId 回写正则**（问题 3）
4. **P3 — 验证全流程 step0→step4**（问题 5）
