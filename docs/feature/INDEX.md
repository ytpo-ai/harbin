# 功能模块索引

## 系统功能层级

### 一级功能模块

| 模块 | 说明 | 状态 |
|------|------|------|
| **agent** | Agent 智能体管理 | ✅ |
| **orchestration** | 任务编排 | ✅ |
| **meeting** | 会议协作 | ✅ |
| **engineering-intelligence** | 工程智能 ｜ ✅ |
| **hr** | HR 管理 | ✅ |
| **gateway** | 网关 ｜ ✅ |

---

## 二级功能详情

### 1. Agent 模块 (agent)

| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `agent/agent_mg` | Agent 管理 | `docs/feature/AGENT_MG.md` |
| `agent/agent_memo` | Agent 备忘录 | `docs/feature/AGENT_MEMO.md` |
| `agent/agent_session` | Agent 会话 | `docs/feature/AGENT_SESSION.md` |
| `agent/agent_skill` | Agent 技能绑定 | `docs/feature/AGENT_SKILL.md` |
| `agent/agent_mcp` | MCP 工具集成 | `docs/feature/AGENT_MCP.md` |
| `agent/agent_runtime` | Agent 运行时 | `docs/feature/AGENT_RUNTIME.md` |
| `agent/agent_message` | Agent 协作消息 | `docs/feature/INNER_MESSAGE.md` |

### 2. 任务编排模块 (orchestration)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `orchestration/task` | 任务管理 | `docs/feature/ORCHETRATION_TASK.md` |
| `orchestration.workflow` | 工作流编排 | (待完善) |
| `orchestration.scheduler` | 定时调度 | `docs/feature/ORCHETRATION_SCHEDULER.md` |

### 3. Meeting 模块 (meeting)

| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `meeting/meeting_chat` | 会议聊天 | `docs/feature/MEETING_CHAT.md` |
| `meeting/meeting_context` | 上下文同步 | (待完善) |

### 4. 工程智能模块 (engineering-intelligence)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `engineering-intelligence/code_self_awareness` | 自我感知 | `docs/feature/ENGINEERING_INTELLIGENCE.md` |
| `engineering-intelligence/code_self_evolution` | 自动进化 | `docs/feature/ENGINEERING_INTELLIGENCE.md` |

### 5. HR 模块 (hr)

| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `hr/hr_account` | 账户管理 | (待完善) |
| `hr/hr_kpi` | KPI 考核 | (待完善) |

### 6. 网关模块 (gateway)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `gateway/api_management` | API 管理 | `docs/feature/GATEWAY_API_MANAGEMENT.md` |
| `gateway/auth` | 认证授权 | (待完善) |

### 7. 消息中心模块 (message-center)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `message-center/system_notifications` | 系统通知中心 | `docs/feature/MESSAGE_CENTER.md` |

---

## 功能文档清单

### 已创建的功能文档

| 文件 | 覆盖的 2级功能 |
|------|---------------|
| `docs/feature/AGENT_MEMO.md` | memo/memo_mcp, memo/memo_identity, memo/memo_evaluation, memo/memo_todo, memo/memo_topic |
| `docs/feature/AGENT_MG.md` | agent/agent_mg |
| `docs/feature/AGENT_MCP.md` | agent/agent_mcp |
| `docs/feature/AGENT_MODEL.md` | agent/model |
| `docs/feature/AGENT_SESSION.md` | agent/session |
| `docs/feature/AGENT_TOOL.md` | agent/tool |
| `docs/feature/AGENT_SKILL.md` | agent/skill |
| `docs/feature/AGENT_RUNTIME.md` | agent/agent_runtime |
| `docs/feature/INNER_MESSAGE.md` | agent/agent_message |
| `docs/feature/ORCHETRATION.md` | orchestration |
| `docs/feature/ORCHETRATION_SCHEDULER.md` | orchestration/scheduler |
| `docs/feature/MEETING_CHAT.md` | meeting/meeting_chat |
| `docs/feature/ENGINEERING_INTELLIGENCE.md` | engineering-intelligence/code_self_awareness, engineering-intelligence/code_self_evolution |
| `docs/feature/MESSAGE_CENTER.md` | message-center/system_notifications |

### 待完善的功能文档


## 文档依赖关系示意

```
功能文档 (feature/)
    │
    ├── 引用 ──► 规划文档 (plan/)
    ├── 引用 ──► 开发总结 (development/)
    ├── 引用 ──► 技术文档 (technical/)
    └── 引用 ──► API文档 (api/)
```
