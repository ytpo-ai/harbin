# 编排开发工作流 OpenCode 路由优化 Plan

## 1. 背景

### 1.1 需求来源

计划编排系统（Orchestration）执行研发流程时，CTO agent 将任务下发给技术团队：技术专家负责方案制定和验收 review，全栈/前端开发负责开发工作。这些任务需要在 opencode 引擎中执行，因为 opencode 环境能直接读写代码、访问 AGENTS.md 行为约束文档，是开发类任务的最佳执行环境。

### 1.2 问题现象

计划 ID `69c2dca466a28616566783b7` 执行时，Step3（执行开发，分配给 Coder-T agent `69bd2c1af71ae480313d7f35`）失败，错误信息：

```
General output validation failed: agent reported inability to execute task
```

### 1.3 根因分析

编排层 `resolveRuntimeChannelHint` 方法存在两个阻塞点，导致任务未能路由到 opencode 引擎：

**阻塞点 A**：`runtimeTaskType !== 'development'` 时直接返回 `native`

- review 类型任务（step4 评估）永远走 native，无法使用 opencode

**阻塞点 B**：description 包含 `repo-writer`/`repo-read`/`builtin.sys-mg.` 等关键词时强制返回 `native`

- Planner 生成的 task.description 中经常包含"使用 repo-writer"等内部工具引用
- 触发关键词检测后被强制路由到 native

**完整路由决策链路**：

```
executeTaskNode (orchestration-execution-engine.service.ts:57)
  │
  ├─ runtimeTaskType 决策优先级：
  │   1. options.runtimeTaskTypeOverride          (运行时强制覆盖)
  │   2. task.runtimeTaskType                     (planner 指定的 taskType，持久化在 task 上)
  │   3. resolveAgentRuntimeTaskType()            (关键词自动分类: isReviewTask → 'review', isCodeTask → 'development')
  │
  ├─ resolveRuntimeChannelHint(runtimeTaskType, description) → 'native' | 'opencode'
  │   ├─ runtimeTaskType !== 'development' → 'native'     ← 阻塞点 A (review 被拦截)
  │   ├─ description 含内部工具关键词 → 'native'           ← 阻塞点 B (description 触发)
  │   └─ 其余 → 'opencode'
  │
  └─ sessionContext.runtimeChannelHint 传入 agent 侧
      └─ agent-executor.service.ts:890 resolvePreferredExecutionChannel()
          └─ 作为优先级最高的 channel 偏好 → 决定最终引擎
```

---

## 2. 方案设计

采用**双管齐下**策略：代码微调 + 计划 Prompt 约束。

### 2.1 代码微调：`resolveRuntimeChannelHint` 扩展

**目标**：让 `review` 类型任务也能路由到 opencode。

**文件**：`backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts`

**改动位置**：第 1028-1045 行，`resolveRuntimeChannelHint` 方法

**当前代码**：

```typescript
private resolveRuntimeChannelHint(
  runtimeTaskType: string,
  description: string,
): 'native' | 'opencode' {
  if (runtimeTaskType !== 'development') {
    return 'native';
  }

  const normalizedDescription = String(description || '').toLowerCase();
  const requiresInternalTools =
    normalizedDescription.includes('builtin.sys-mg.')
    || normalizedDescription.includes('repo-writer')
    || normalizedDescription.includes('repo-read')
    || normalizedDescription.includes('save-template')
    || normalizedDescription.includes('save-prompt-template');

  return requiresInternalTools ? 'native' : 'opencode';
}
```

**改为**：

```typescript
private resolveRuntimeChannelHint(
  runtimeTaskType: string,
  description: string,
): 'native' | 'opencode' {
  // development 和 review 类型任务允许路由到 opencode；
  // 其余类型（general/research/external_action）走 native。
  const OPENCODE_ELIGIBLE_TASK_TYPES = new Set(['development', 'review']);

  if (!OPENCODE_ELIGIBLE_TASK_TYPES.has(runtimeTaskType)) {
    return 'native';
  }

  // review 类型不做 description 关键词排除，直接走 opencode。
  // 典型场景：技术专家在 opencode 中读代码做验收评审。
  if (runtimeTaskType === 'review') {
    return 'opencode';
  }

  // development 类型保留关键词排除逻辑（向后兼容）：
  // 如果 description 显式引用了系统内部工具，说明任务需要通过 native 引擎
  // 调用 MCP 内部工具，而非在 opencode 中直接操作文件。
  const normalizedDescription = String(description || '').toLowerCase();
  const requiresInternalTools =
    normalizedDescription.includes('builtin.sys-mg.')
    || normalizedDescription.includes('repo-writer')
    || normalizedDescription.includes('repo-read')
    || normalizedDescription.includes('save-template')
    || normalizedDescription.includes('save-prompt-template');

  return requiresInternalTools ? 'native' : 'opencode';
}
```

**改动说明**：

| 变更点 | 说明 |
|---|---|
| 新增 `OPENCODE_ELIGIBLE_TASK_TYPES` 白名单 | 将 `development` 和 `review` 加入可走 opencode 的类型集合 |
| review 类型直接返回 `opencode` | review 任务不需要调用内部工具，不做 description 关键词检测 |
| development 类型逻辑不变 | 保留 description 关键词排除，向后兼容现有行为 |

**影响范围**：仅 1 个方法（约 10 行改动），不影响其他 taskType 的路由行为。

### 2.2 计划 Prompt 约束：避免触发 description 关键词

**目标**：确保 Planner 生成的 step2/step3/step4 任务不触发 description 关键词排除（阻塞点 B）。

**在计划 prompt 中增加约束段落**（建议放在步骤定义之前）：

```markdown
## 执行引擎约束（Planner 必须遵守）

以下 step 需要在 opencode 代码工程环境中执行，Planner 生成任务时必须遵守：
1. step2（技术方案）、step3（执行开发）的 taskType 必须设为 `development`
2. step4（实现评估）的 taskType 必须设为 `review`
3. 所有 step 的 task.description 中，禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述
```

**效果矩阵**：

| Step | Planner 输出 taskType | task.runtimeTaskType | resolveRuntimeChannelHint 结果 | 最终引擎 |
|---|---|---|---|---|
| step0（选需求） | general | general | native | native ✅ |
| step1（需求点评） | general | general | native | native ✅ |
| step2（技术方案） | development | development | opencode（description 不含触发词） | opencode ✅ |
| step3（执行开发） | development | development | opencode（description 不含触发词） | opencode ✅ |
| step4（实现评估） | review | review | opencode（代码改动后支持） | opencode ✅ |

---

## 3. 前提条件检查

在执行方案前，需确认以下前提（通过 MongoDB 查询）：

### 3.1 确认 agent 的 opencode 执行配置

agent 侧路由的第一优先级检查（`agent-executor.service.ts:801`）：`agent.config.execution.provider` 必须为 `'opencode'`，否则无论编排层传什么 hint 都会走 native。

```javascript
// 查询 Coder-T 和技术专家的 opencode 配置
db.agents.find(
  { _id: { $in: [ObjectId('69bd2c1af71ae480313d7f35'), /* 技术专家 agentId */] } },
  { name: 1, 'config.execution': 1, roleId: 1 }
)
```

**期望结果**：每个 agent 的 `config.execution.provider` 为 `'opencode'`。

如果未配置，需要更新：

```javascript
db.agents.updateOne(
  { _id: ObjectId('<agentId>') },
  { $set: { 'config.execution': { provider: 'opencode' } } }
)
```

### 3.2 确认 agent 的角色在 opencode 白名单中

`agent-opencode-policy.service.ts:50` 定义了 opencode 允许的角色：

```typescript
const OPENCODE_ALLOWED_ROLE_CODES = new Set([
  'devops-engineer',
  'fullstack-engineer',
  'technical-architect',
]);
```

- Coder-T：role = `fullstack-engineer` ✅
- 技术专家：role = `technical-architect` ✅

### 3.3 确认服务环境

- Gateway (3100) + Legacy (3001) + Agents (3002) 均已启动
- 已获取有效的 Bearer token

---

## 4. 实施步骤（执行者操作手册）

### Step 1: 应用代码改动

1. 打开文件 `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts`
2. 找到 `resolveRuntimeChannelHint` 方法（约第 1028 行）
3. 按照 2.1 节的目标代码替换该方法
4. 保存文件

### Step 2: 重启后端服务

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd /Users/van/Workspace/harbin/backend && bash reload.sh development -p 3001
```

等待重启完成后，验证新代码已编译：

```bash
grep -c 'OPENCODE_ELIGIBLE_TASK_TYPES' /Users/van/Workspace/harbin/backend/dist/apps/legacy/src/modules/orchestration/services/orchestration-execution-engine.service.js
```

期望返回 `1`（或大于 0），表示新代码已编译生效。

### Step 3: 检查 agent opencode 配置（前提条件）

向用户索取 Bearer token，然后通过 MongoDB 或 API 查询确认：

```bash
# 通过 mongosh 查询（如果可以直连 MongoDB）
mongosh --eval "
  db.agents.find(
    { isActive: true, 'config.execution.provider': 'opencode' },
    { name: 1, 'config.execution.provider': 1, roleId: 1 }
  ).forEach(printjson)
"
```

如果目标 agent 缺少 opencode 配置，按 3.1 节更新。

### Step 4: 创建测试计划（不自动运行）

```bash
curl -s --noproxy '*' -X POST "http://127.0.0.1:3100/api/orchestration/plans/from-prompt" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "<调整后的计划 prompt，见下方 5.1 节>",
    "mode": "sequential",
    "autoRun": false,
    "autoGenerate": false,
    "defaultTaskType": "development"
  }'
```

记录返回的 `planId`。

**注意**：`autoRun` 和 `autoGenerate` 都设为 `false`，确保不自动执行，便于逐步检查。

### Step 5: 逐步生成任务并验证

对每个 step 执行：

```bash
# 生成下一个任务（增量规划会同时执行生成的任务）
curl -s --noproxy '*' -X POST "http://127.0.0.1:3100/api/orchestration/plans/<planId>/generate-next" \
  -H "Authorization: Bearer <TOKEN>"
```

每步生成后检查：

```bash
# 查看当前所有任务
curl -s --noproxy '*' "http://127.0.0.1:3100/api/orchestration/plans/<planId>/tasks" \
  -H "Authorization: Bearer <TOKEN>" | python3 -c "
import json, sys
tasks = json.loads(sys.stdin.read(), strict=False)
for t in (tasks if isinstance(tasks, list) else tasks.get('items', tasks.get('tasks', []))):
    print(f\"title={t.get('title','')[:60]}  runtimeTaskType={t.get('runtimeTaskType','?')}  status={t.get('status','?')}\")
"
```

**每步验证清单**：

| 检查项 | 方法 | 期望值 |
|---|---|---|
| task.runtimeTaskType | API 查询 tasks | step2/3: `development`, step4: `review` |
| task.description 不含触发词 | API 查询 tasks | 不含 `repo-writer`/`repo-read`/`builtin.sys-mg` |
| 路由决策日志 | `grep 'execution_route' /tmp/harbin-logs/agents-app.log` | step2/3/4: `channel=opencode` |
| 实际执行引擎 | MongoDB: `db.agent_runs.find({}).sort({createdAt:-1}).limit(5)` | `executionChannel: 'opencode'` |
| 任务执行结果 | API 查询 tasks | `status: 'completed'` |

### Step 6: 如果某步失败，排查路径

1. **查看任务详情**：

```bash
curl -s --noproxy '*' "http://127.0.0.1:3100/api/orchestration/plans/<planId>/tasks" \
  -H "Authorization: Bearer <TOKEN>"
```

2. **查看路由日志**：

```bash
grep 'execution_route' /tmp/harbin-logs/agents-app.log | tail -20
```

期望日志格式：`[execution_route] agent=<name> taskType=<type> channel=<channel> source=<source> opencodeEnabled=<bool>`

3. **查看 runtimeChannelHint 传递**：

```bash
grep 'runtimeChannelHint' /tmp/harbin-logs/legacy-app.log | tail -10
```

4. **查看 agent_runs 实际引擎**：

```javascript
db.agent_runs.find({}, { agentId: 1, executionChannel: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(10)
```

5. **查看 agent 实际输出**：

```javascript
db.agent_messages.find({ sessionId: /plan-<planId>/ }).sort({ createdAt: -1 }).limit(10)
```

### Step 7: 全流程验证（可选）

在单步验证全部通过后，可创建新计划并启用自动运行：

```bash
curl -s --noproxy '*' -X POST "http://127.0.0.1:3100/api/orchestration/plans/from-prompt" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "<完整计划 prompt>",
    "mode": "sequential",
    "autoGenerate": true,
    "defaultTaskType": "development"
  }'
```

监控 SSE 事件流：

```bash
curl -s --noproxy '*' -N "http://127.0.0.1:3100/api/orchestration/plans/<planId>/events" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Accept: text/event-stream"
```

---

## 5. 计划 Prompt 模板

### 5.1 完整 Prompt（供创建计划时使用）

```
## 流程原则

- 保持轻量可执行，优先跑通。
- **先采集事实，再做判断**——任何输出前必须先调用工具读取相关文档或代码。
- **数据锚定规则（强制）**：step0 选定的 requirementId 是本次编排的唯一锚点。后续所有 step 的 task.description 必须在开头显式引用该 requirementId 和标题原文，禁止替换为其他需求。

## 执行引擎约束（Planner 必须遵守）

以下 step 需要在 opencode 代码工程环境中执行，Planner 生成任务时必须遵守：
1. step0（选定需求）、step1（确认范围）的 taskType 必须设为 `general`
2. step2（技术方案）、step3（执行开发）的 taskType 必须设为 `development`
3. step4（实现评估）的 taskType 必须设为 `review`
4. 所有 step 的 task.description 中，禁止出现以下内部工具引用关键词：
   `repo-writer`、`repo-read`、`builtin.sys-mg`、`save-template`、`save-prompt-template`
   如需描述代码操作，使用"读取代码"、"修改代码"、"提交变更"等自然语言表述

## 步骤定义（严格按序执行）

### step0: 选定最高优先级需求
- **执行角色**: Kim-CTO（从 list-agents 中查找 role 包含 executive-lead 的 agent）
- **输入**: 当前 EI 需求池
- **动作**: 调用 requirement.board 或 requirement.list 获取需求列表；选择优先级最高且状态为 todo/open 的可执行需求；然后调用 requirement.detail 获取该需求的完整描述
- **输出契约（必须包含，缺一不可）**:
  1. requirementId（需求唯一标识）
  2. 标题原文
  3. **需求描述原文（description 字段的完整内容，禁止省略或改写）**
  4. 选择依据（1-2 条）
- **下游绑定**: 后续所有 step 在 task.description 开头必须注明 `【锚定需求】requirementId=<step0输出的ID>, 标题=<step0输出的标题>`

### step1: 确认需求范围
- **执行角色**: 与 step0 同一 agent（Kim-CTO）
- **输入**: step0 输出的 requirementId + 标题 + **需求描述原文**
- **动作**: 以需求描述原文为唯一事实来源，确认功能范围、验收标准；如无补充，直接复述需求描述原文
- **输出契约**: 必须包含需求描述原文，且明确列出本次要实现的功能点清单
- **约束**: 禁止改变 requirementId；禁止将需求替换为其他条目；**禁止对需求描述做泛化、扩展或重新定义——如果需求说"在前端页面将需求设置为 done"，输出就必须围绕这一具体功能**

### step2: 制定技术开发计划
- **执行角色**: 技术专家（从 list-agents 中查找能力标签包含"技术架构"或"系统设计"的 agent）
- **输入**: 读取需求详情和相关代码/文档；明确业务边界、验收标准、最小变更范围
- **动作**: 基于需求规格设计实现方案，拆解开发子任务，评估技术风险
- **输出契约**: 结构化开发计划（含实现步骤、涉及文件/接口清单、测试要点）
- **约束**: taskType 设为 development；输出中避免引用具体内部工具名称

### step3: 执行开发
- **执行角色**: 全栈开发（选择当前状态空闲的）
- **输入**: step2 输出的开发计划
- **动作**: 按计划实施代码变更并提交
- **输出契约**: 代码 commit 信息（含 commit hash、变更文件列表、变更摘要）
- **约束**: taskType 设为 development；描述中使用"读取代码"、"修改代码"、"提交变更"等自然语言，禁止引用内部工具名称

### step4: 实现评估
- **执行角色**: 技术专家（与 step2 同一 agent）
- **输入**: step3 输出的 commit 信息 + step2 的开发计划及验收清单
- **动作**: 对照验收标准评估实现质量，给出通过/修改意见
- **输出契约**: 评估结论（通过/需修改 + 具体意见）
- **约束**: taskType 设为 review
```

---

## 6. 回滚方案

### 6.1 代码回滚

如果 `resolveRuntimeChannelHint` 改动导致问题：

将 `OPENCODE_ELIGIBLE_TASK_TYPES` 改回仅含 `'development'`，并移除 review 的短路返回逻辑，即恢复为原始代码。改动集中在单一方法内，可一键回滚。

### 6.2 Prompt 回滚

移除计划 prompt 中的"执行引擎约束"段落即可，不影响其他功能。

---

## 7. 风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| review 任务在 opencode 中执行失败 | step4 评估无法完成 | opencode gate 已校验 agent role（technical-architect 在白名单中）；失败时可手动回退 |
| Planner 不遵守 taskType 约束 | 任务可能被错误分类 | plan.defaultTaskType='development' 作为兜底；planner prompt 中显式约束 |
| Agent config.execution.provider 未配置 | 即使编排层传 opencode hint，agent 侧仍走 native | Step 3 前提条件检查中强制确认 |
| description 关键词排除误伤 | development 任务被强制走 native | prompt 约束禁止使用触发关键词；planner 生成后逐步验证 |

---

## 8. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `backend/src/modules/orchestration/services/orchestration-execution-engine.service.ts` | 代码修改 | `resolveRuntimeChannelHint` 方法扩展 review 支持 |
| 计划 Prompt | 配置变更 | 增加"执行引擎约束"段落 |

---

## 9. 相关文档

| 文档 | 路径 | 关系 |
|---|---|---|
| 引擎路由技术设计 | `docs/technical/AGENT_EXECUTOR_ENGINE_ROUTING_TECHNICAL_DESIGN.md` | 引擎层架构 |
| Executor 选择链路分析 | `docs/guide/EXECUTOR.MD` | 执行者选择全链路 |
| taskType 路由链路分析 | `docs/guide/ORCHESTRATION_TASK_TYPE_ROUTING_CHAIN.MD` | taskType 从定义到路由的完整影响链路 |
| 测试指南 | `docs/guide/TEST_GUIDELINE.MD` | API 测试规范 |
| OpenCode Worker 技术设计 | `docs/technical/OPENCODE_AGENT_TASK_SSE_WORKER_TECHNICAL_DESIGN.md` | OpenCode 执行层 |
