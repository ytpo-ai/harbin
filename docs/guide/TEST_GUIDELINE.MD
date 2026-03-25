# API 接口测试与编排验证指南

本文档沉淀了在测试 Orchestration 增量编排等后端功能时总结的经验教训，避免在后续测试中重复踩坑。

---

## 0. 鉴权前置：先向用户索取测试 Token

### 规则

- 只要涉及需要鉴权的接口测试（例如带 `Authorization: Bearer ...` 的请求），**在发起请求前主动向用户索取测试 token**。
- 如果用户未提供 token，不要自行假设、伪造或复用不确定来源的历史 token。
- 拿到 token 后再执行接口验证，并在命令中使用占位方式避免明文扩散（如 `Bearer <USER_TEST_TOKEN>`）。

### 建议话术

- `为避免鉴权失败，请提供本次接口测试使用的 Bearer 测试 token。`

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
