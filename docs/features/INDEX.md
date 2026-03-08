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
| `agent/agent_mg` | Agent 管理 | `docs/features/AGENT_MG.md` |
| `agent/agent_memo` | Agent 备忘录 | `docs/features/AGENT_MEMO.md` |
| `agent/agent_session` | Agent 会话 | `docs/features/AGENT_SESSION.md` |
| `agent/agent_skill` | Agent 技能绑定 | `docs/features/AGENT_SKILL.md` |
| `agent/agent_mcp` | MCP 工具集成 | `docs/features/AGENT_MCP.md` |
| `agent/agent_runtime` | Agent 运行时 | `docs/features/AGENT_RUNTIME.md` |

### 2. 任务编排模块 (orchestration)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `orchestration/task` | 任务管理 | `docs/features/ORCHETRATION_TASK.md` |
| `orchestration.workflow` | 工作流编排 | (待完善) |
| `orchestration.scheduler` | 定时调度 | `docs/features/ORCHETRATION_SCHEDULER.md` |

### 3. Meeting 模块 (meeting)

| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `meeting/meeting_chat` | 会议聊天 | `docs/features/MEETING_CHAT.md` |
| `meeting/meeting_context` | 上下文同步 | (待完善) |

### 4. 工程智能模块 (engineering-intelligence)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `engineering-intelligence/code_self_awareness` | 自我感知 | (待完善) |
| `engineering-intelligence/code_self_evolution` | 自动进化 | (待完善) |

### 5. HR 模块 (hr)

| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `hr/hr_account` | 账户管理 | (待完善) |
| `hr/hr_kpi` | KPI 考核 | (待完善) |

### 6. 网关模块 (gateway)
| 2级功能 | 说明 | 功能文档 |
|---------|------|----------|
| `gateway/api_management` | API 管理 | (待完善) |
| `gateway/auth` | 认证授权 | (待完善) |

---

## 功能文档清单

### 已创建的功能文档

| 文件 | 覆盖的 2级功能 |
|------|---------------|
| `docs/features/AGENT_MEMO.md` | memo/memo_mcp, memo/memo_identity, memo/memo_evaluation, memo/memo_todo, memo/memo_topic |
| `docs/features/AGENT_MCP.md` | agent/agent_mcp |
| `docs/features/AGENT_MODEL.md` | agent/model |
| `docs/features/AGENT_SESSION.md` | agent/session |
| `docs/features/AGENT_TOOL.md` | agent/tool |
| `docs/features/AGENT_SKILL.md` | agent/skill |
| `docs/features/AGENT_RUNTIME.md` | agent/agent_runtime |
| `docs/features/ORCHETRATION.md` | orchestration |
| `docs/features/ORCHETRATION_SCHEDULER.md` | orchestration/scheduler |
| `docs/features/MEETING_CHAT.md` | meeting/meeting_chat |
| `docs/features/ENGINEERING_INTELLIGENCE.md` | engineering-intelligence |

### 待完善的功能文档


## 文档依赖关系示意

```
功能文档 (features/)
    │
    ├── 引用 ──► 规划文档 (plan/)
    ├── 引用 ──► 开发总结 (development/)
    ├── 引用 ──► 技术文档 (technical/)
    └── 引用 ──► API文档 (api/)
```
