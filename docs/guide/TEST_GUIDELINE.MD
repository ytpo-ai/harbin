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

### 9.1 测试场景汇总

| 轮次 | PlanId | Prompt 目标 | 结果 | 验证重点 |
|------|--------|------------|------|----------|
| v1 | `69c19204...` | agency-agents Prompt 全量导入（中文） | 3 task 全失败 → plan draft | 失败处理链路（#8 #9）、research taskType 误判 |
| v2 | `69c192ae...` | Prompt Registry 数据整理与汇总（中文） | 4 task 全 completed → plan planned | 成功执行全链路（#15）、isGoalReached 完成判定 |
| v3 | `69c193b9...` | Agent Prompt Config Export Report（英文） | 5 task、2 次合并触发 → 手动逐步 | 任务合并（#16）、generate-next 端点（#12） |

### 9.2 设计点验证矩阵

| # | 设计点 | 结果 | 验证方式 | 验证轮次 |
|---|--------|------|----------|----------|
| 1 | Schema 扩展（generationMode / generationConfig / generationState） | **PASS** | API 创建 Plan 返回字段验证：generationMode='incremental', generationConfig.maxRetries=3, generationState.currentStep=0 | v1/v2/v3 |
| 2 | createPlanFromPrompt 默认 draft + incremental | **PASS** | 三轮测试均确认 status='draft', generationMode='incremental' | v1/v2/v3 |
| 3 | autoGenerate=true 触发异步编排 | **PASS** | v1/v2 Plan 创建后 status 自动变为 'drafting'，任务自动生成 | v1/v2 |
| 4 | IncrementalPlanningService 主循环启动 | **PASS** | generationState.currentStep 从 0 递增到 3(v1)/4(v2)/5(v3) | v1/v2/v3 |
| 5 | 防重入（activePlannings Set） | **PASS** | 代码审计 + v3 手动逐步触发未出现并发冲突 | v3 |
| 6 | PlannerService.generateNextTask() 调用 agent | **PASS** | agent 成功返回 JSON 任务定义（title/description/priority/agentId/taskType） | v2/v3 |
| 7 | buildIncrementalPlannerPrompt 构建完整上下文 | **PASS** | prompt 包含目标/manifest/已完成任务/失败任务；v1 失败后 planner 调整了策略 | v1/v2 |
| 8 | 约束守护 maxRetries=3 兜底终止 | **PASS** | v1: consecutiveFailures=3 时 plan 回到 draft，编排终止 | v1 |
| 9 | failPlanning() 恢复 draft + 记录 lastError | **PASS** | v1: status='draft', lastError='Task "..." failed after 3 retries: missing or invalid research execution proof' | v1 |
| 10 | generationState 每步持久化到 MongoDB | **PASS** | 三轮测试均确认 currentStep/totalGenerated/totalRetries/consecutiveFailures 实时更新 | v1/v2/v3 |
| 11 | SSE 事件发射（status.changed / step.started / failed） | **PASS** | 代码审计确认 emitPlanStreamEvent 在 step.started/task.generated/task.executing/task.completed/task.failed/task.merged/planning.completed/planning.failed 等时机均有调用 | 代码审计 |
| 12 | generate-next 手动触发 endpoint | **PASS** | v3: POST plans/:id/generate-next 返回 `{accepted:true}`，单步执行后 generationState 正确递增 | v3 |
| 13 | 向后兼容（旧 Plan 不受影响） | **PASS** | 旧 plan 无 generationMode/generationConfig/generationState 字段不报错，API 正常返回 | 代码审计 + API |
| 14 | executor fallback（agentId 无效时降级） | **PASS** | 代码审计确认 resolveValidAgentId 失败时 fallback 到 ExecutorSelectionService；v1 中 fallbackUsed=false 说明正常路径工作 | 代码审计 |
| 15 | 任务创建 + 执行 | **PASS** | v2: 4 个 task 全部 completed (rtt=general)；v3: 5 个 task 中 3 个 completed；task 的 runLogs[0].metadata 包含完整诊断字段 | v2/v3 |
| 16 | 任务合并（tryMergeWithPreviousTask） | **PASS** | v3: Task[0]←Task[1] 合并（similarity≈0.43）、Task[2]←Task[3] 合并；mergedFromTaskIds 有值，cancelled task 状态正确 | v3 |

### 9.3 合并逻辑观察与改进建议

v2（中文 prompt）中 3 个连续同 agent completed task 未触发合并，原因分析：

- `extractKeywords()` 使用正则 `/[^a-zA-Z0-9\u4e00-\u9fa5]+/` 分割文本
- 中文连续字符（如"条目总量与分类分布并生成清单初稿"）作为单个长 token 处理
- 导致中文场景关键词重叠率仅 0.30-0.33，低于 0.40 阈值
- 英文场景（v3）因自然空格分词，关键词粒度合适，成功触发合并

**改进方向**：
1. 引入中文分词（如 jieba / nodejieba）替代纯正则分割
2. 或使用 embedding 向量相似度替代关键词匹配
3. 或降低阈值到 0.25-0.30 以兼容中文场景

### 9.4 runtimeTaskType 解析验证

| 场景 | plannerTaskType | planDefaultTaskType | resolvedTaskType | fallbackUsed |
|------|----------------|--------------------|--------------------|--------------|
| v1 Task[0-2] | research | general | research | false |
| v2 Task[0-3] | general | general | general | false |
| v3 Task[0-4] | general | general | general | false |

三层优先级解析 (`planner > plan.defaultTaskType > 'general'`) 工作正常：
- v1 中 planner 选择 research 覆盖了 plan 默认的 general
- v2/v3 中 planner 选择 general 与 plan 默认一致
