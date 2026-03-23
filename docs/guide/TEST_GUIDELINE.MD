# API 接口测试与编排验证指南

本文档沉淀了在测试 Orchestration 增量编排等后端功能时总结的经验教训，避免在后续测试中重复踩坑。

---

## 1. 网络环境：必须通过 Gateway 测试

### 教训

直接 `curl http://localhost:3001/api/...` 或 `curl http://127.0.0.1:3001/api/...` 会被本机 **socks5 代理** (`ALL_PROXY=socks5://127.0.0.1:7890`) 拦截，导致 HTTP_CODE=000（connection refused / timeout）。即使 `lsof` 确认端口在监听，curl 仍然无法连通。

### 正确做法

- **始终通过 Gateway (端口 3100) 测试所有 API 接口**，不要直接访问 3001/3002/3003/3004。
- curl 命令加 `--noproxy '*'` 绕过代理：
  ```bash
  curl -s --noproxy '*' "http://127.0.0.1:3100/api/orchestration/plans" \
    -H "Authorization: Bearer <token>"
  ```
- 启动服务时需确保 gateway 也启动：
  ```bash
  cd backend && bash start.sh development -p 3100
  ```

### Gateway 路由规则速查

| URL 前缀 | 目标服务 | 端口 |
|-----------|----------|------|
| `/api/agents/*`, `/api/tools/*`, `/api/skills/*`, `/api/prompt-registry/*` 等 | Agents | 3002 |
| `/api/ei/*`, `/api/engineering-intelligence/*` | EI | 3004 |
| 其他所有 `/api/*`（包括 `/api/orchestration/*`） | Legacy | 3001 |

---

## 2. 服务启动：最小启动集合

### 教训

首轮测试时只启动了 3001 和 3002，忘记启动 3100 gateway，导致所有 curl 请求超时，浪费了排查时间。

### 正确做法

根据测试场景确定最小启动集合：

| 测试场景 | 必须启动的服务 |
|----------|---------------|
| Orchestration Plan 创建与编排 | gateway(3100) + legacy(3001) + agents(3002) |
| Prompt Registry 操作 | gateway(3100) + agents(3002) |
| Agent 执行与工具调用 | gateway(3100) + agents(3002) |
| 全功能集成测试 | gateway(3100) + legacy(3001) + agents(3002) + ws(3003) |

启动命令：
```bash
cd backend
bash start.sh development -p 3100   # gateway 优先启动
bash start.sh development -p 3001   # legacy
bash start.sh development -p 3002   # agents
```

---

## 3. 代码热更新：watch 模式不可靠，改动后必须 reload

### 教训

修改 `planner.service.ts` 后依赖 `--watch` 自动重编译，但实际测试时 plan 在 reload 之前就已经跑完了（增量编排执行极快，3 轮重试在几秒内完成），导致新代码根本没生效。

### 正确做法

1. 修改代码后，**先 reload 服务再创建测试 plan**：
   ```bash
   cd backend && bash reload.sh development -p 3001
   ```
2. reload 完成后验证新代码已生效（检查 dist 产物）：
   ```bash
   strings backend/dist/apps/legacy/src/modules/orchestration/planner.service.js | grep "<关键特征字符串>"
   ```
3. **不要依赖 `autoGenerate=true` 的异步触发来测试**——plan 创建后编排会立即启动，如果代码未热更新完毕，编排可能在旧代码上跑完。

---

## 4. 理解需求：区分"直接执行"与"通过编排系统执行"

### 教训

用户要求"通过创建 Plan 来测试增量编排能力"，但第一轮误解为"直接写脚本执行导入"，浪费了一整轮编写导入脚本的时间。

### 正确做法

- 用户说"测试计划编排"/"验证编排能力" → 通过 **Orchestration API 创建 Plan**，让系统自动编排
- 用户说"执行导入"/"直接做" → 写脚本或直接调 API 完成任务
- 不确定时**先问**，不要假设

---

## 5. API 响应解析：处理含控制字符的 JSON

### 教训

用 Python `json.loads()` 解析 API 响应时，因 `sourcePrompt` 字段包含 `\n` 等控制字符导致 `JSONDecodeError: Invalid control character`。

### 正确做法

- 用 `python3 -c "import json; json.loads(open('/dev/stdin').read())"` 时，对含控制字符的响应改用 `strict=False`：
  ```python
  json.loads(sys.stdin.read(), strict=False)
  ```
- 或直接用 Node.js 脚本通过 mongoose 查 MongoDB，绕过 curl + JSON 解析问题：
  ```bash
  cd backend && pnpm exec node -e "const mongoose = require('mongoose'); ..."
  ```

---

## 6. Agent 行为验证：日志 + 数据库双通道排查

### 教训

首次发现 planner agent 返回自然语言时，只看 `/tmp/harbin-logs/` 日志文件，日志中只记录了 `responseLength` 但不含实际响应内容，无法判断 agent 究竟返回了什么。

### 正确做法

排查 agent 行为问题的标准路径：

1. **日志文件** (`/tmp/harbin-logs/agents-app.log`) — 看 `responseLength`、`status`、`durationMs`
2. **MongoDB `agent_messages` 集合** — 看 agent 的实际输入输出内容：
   ```javascript
   db.collection('agent_messages').find({
     sessionId: { $regex: /task-<taskId片段>/ }
   }).sort({ createdAt: -1 }).limit(10)
   ```
3. **MongoDB `orchestration_tasks` 集合** — 看任务状态、执行结果
4. **MongoDB `orchestration_plans` 集合** — 看 `generationState` 字段的实时变化

日志和数据库结合才能完整还原编排过程。

---

## 7. 增量编排测试检查清单

执行增量编排 E2E 测试时，按此清单逐项确认：

- [ ] gateway(3100) + legacy(3001) + agents(3002) 全部启动并可达
- [ ] 代码修改已 reload 且 dist 产物包含最新变更
- [ ] 已确认可用的 `plannerAgentId`（通过 `GET /api/agents` 查询活跃 agent）
- [ ] `curl --noproxy '*'` 通过 3100 端口测试
- [ ] Plan 创建后立即通过 MongoDB 查询 `generationState` 确认编排是否启动
- [ ] 失败时检查 `agent_messages` 集合看 agent 实际响应内容
- [ ] 验证 `maxRetries` 兜底是否生效（`consecutiveFailures >= maxRetries` 时应终止）
- [ ] 验证 task 的 `runtimeTaskType` 字段已正确持久化（非 undefined）
- [ ] 验证 task 的 `assignment.reason` 包含 "Assigned by planner incremental output"（非 fallback）

---

## 8. 增量编排已知问题与修复记录

### 8.1 Agent Manifest 未暴露 id（已修复 — commit 976a7e8）

**问题**: `formatAgentManifest()` 只输出 agent name/role/capabilities，不输出 `id`（ObjectId）。planner 被要求"选择一个 agentId"但 manifest 中没有 id，导致 planner 瞎猜 → `resolveValidAgentId()` 校验失败 → fallback 到 `ExecutorSelectionService` 按评分选了不相关的 agent。

**修复**: `planning-context.service.ts:196` — manifest 格式改为 `- AgentName（id=xxx, roleName, L1层）`。

**验证**: task 的 `runLogs[0].metadata.fallbackUsed` 应为 `false`。

### 8.2 task type 被 keyword 误判为 research（已修复 — commit 976a7e8）

**问题**: `createTaskFromPlannerOutput()` 创建 task 时未设置 `runtimeTaskType`。执行时 `TaskClassificationService.detectResearchTaskKind()` 通过极宽泛的关键词匹配（`search`/`analyze`/`identify`/`collect`/`扫描`/`解析`等）将几乎所有任务误判为 `research`，触发 research 输出验证失败。

**修复**: 
1. Plan schema 新增 `defaultTaskType` 字段（创建 Plan 时可选指定）
2. Planner prompt JSON schema 新增可选 `taskType` 字段
3. `createTaskFromPlannerOutput()` 按优先级解析 `runtimeTaskType`: **planner 指定 > plan.defaultTaskType > 'general'**

**验证**: task 的 `runtimeTaskType` 应有值且不为 undefined；`runLogs[0].metadata` 包含 `resolvedTaskType`/`plannerTaskType`/`planDefaultTaskType` 三个诊断字段。

---

## 9. 增量编排 16 设计点验证状态（截至 2026-03-24）

| # | 设计点 | 结果 | 验证方式 |
|---|--------|------|----------|
| 1 | Schema 扩展（generationMode / generationConfig / generationState） | PASS | API 创建 Plan 返回字段验证 |
| 2 | createPlanFromPrompt 默认 draft + incremental | PASS | status='draft', generationMode='incremental' |
| 3 | autoGenerate=true 触发异步编排 | PASS | Plan 创建后 status 自动变为 'drafting' |
| 4 | IncrementalPlanningService 主循环启动 | PASS | generationState.currentStep 递增 |
| 5 | 防重入（activePlannings Set） | PASS | 同一 planId 不会重复启动编排 |
| 6 | PlannerService.generateNextTask() 调用 agent | PASS | agent 成功返回 JSON 任务定义 |
| 7 | buildIncrementalPlannerPrompt 构建完整上下文 | PASS | prompt 包含目标/manifest/已完成任务/失败任务 |
| 8 | 约束守护 maxRetries=3 兜底终止 | PASS | consecutiveFailures>=3 时 plan 回到 draft |
| 9 | failPlanning() 恢复 draft + 记录 lastError | PASS | status='draft', lastError 有值 |
| 10 | generationState 每步持久化到 MongoDB | PASS | currentStep/totalGenerated/totalRetries 实时更新 |
| 11 | SSE 事件发射（status.changed / step.started / failed） | PASS | 代码审计确认 emitPlanStreamEvent 调用 |
| 12 | generate-next 手动触发 endpoint | PASS | POST plans/:id/generate-next 返回 accepted |
| 13 | 向后兼容（旧 Plan 不受影响） | PASS | 旧 plan 无新字段不报错 |
| 14 | executor fallback（agentId 无效时降级） | PASS | 代码审计 + v1 测试中实际触发 |
| 15 | **任务创建 + 执行** | **PASS** | v3 测试 Task 0: planner 返回有效 JSON → 创建 task → 执行 completed |
| 16 | **任务合并（tryMergeWithPreviousTask）** | **待验证** | 需连续 2+ task completed 且同 agent + 相似度>40% 触发 |

**设计点 16 待验证原因**: 合并仅在 task completed 后触发。当前测试中 Task 0 completed 后 Task 1-3 连续失败（planner 自选 research type + agent 缺少仓库访问权限），未达到合并触发条件。需要一个能实际执行成功的多步编排场景来验证。
