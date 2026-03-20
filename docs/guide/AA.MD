---
Explore the project structure at /Users/van/Workspace/harbin. I need to understand:

1. What's in the docs/ directory structure (especially docs/features/, docs/plan/, docs/issue/, docs/skill/)
2. What's in docs/features/RULES.md
3. What's in docs/skill/cto-rd-workflow-appendix.md if it exists
4. What frontend components exist related to "message" or "内部消息" - search for relevant files
5. What the general project structure looks like (top-level dirs, apps/, frontend/ structure)

Be thorough - list all directories and key files found. Return all content you find.
---

## 1. Top-Level Project Structure

```
/Users/van/Workspace/harbin/
├── .agents/
├── .git/
├── .gitignore
├── AGENTS.md               # AI Agent development protocol
├── DEPENDENCIES.md
├── README.md
├── backend/                # Nest.js + TypeScript + MongoDB
├── data/                   # Seed/static data (agents.json, memos/, skills/)
├── docs/                   # All documentation
├── docker-compose.yml
├── frontend/               # React + TypeScript + Tailwind CSS
├── opencode.json
├── package.json
├── reload.sh
├── start.sh
```

---

## 2. docs/ Directory Structure (Full)

### docs/ top-level
```
/Users/van/Workspace/harbin/docs/
├── README.md
├── TIP.MD
├── agent_type.md
├── BACKEND_GUIDELINE.md
├── FRONTEND_GUIDELINE.md
├── PRODUCTION_DEPLOYMENT.md
├── api/                    (9 files)
├── architecture/           (4 entries incl. self-evolution/)
├── dailylog/               (day/, week/, RULES.md, DAILY_PROGRESS_OLD.md)
├── development/            (62 files)
├── feature/                (16 files)
├── guide/                  (5 files)
├── issue/                  (5 entries incl. fix/)
├── learn/                  (1 file)
├── plan/                   (178 files!)
├── skill/                  (5 files)
├── technical/              (27 files)
```

### docs/feature/ (16 files)
```
AGENT_MCP.md
AGENT_MEMO.md
AGENT_MG.md
AGENT_RUNTIME.md
AGENT_SKILL.md
AGENT_TOOL.md
ENGINEERING_INTELLIGENCE.md
GATEWAY_API_MANAGEMENT.md
INDEX.md                     # Feature module index with hierarchy
INNER_MESSAGE.md             # Agent inner collaboration messages
MEETING_CHAT.md
MESSAGE_CENTER.md            # Message center (system + inner + subscriptions)
ORCHETRATION_SCHEDULER.md
ORCHETRATION_TASK.md
RULES.md                     # Feature doc maintenance rules
SYSTEM_UI_MANAGEMENT.md
```

### docs/plan/ (178 files)
A massive collection of plan documents covering every feature area. Key message-related ones:
- `AGENT_COLLAB_MESSAGE_REDIS_PLAN.md`
- `AGENT_UNIFIED_INNER_MESSAGE_RUNTIME_PLAN.md`
- `MESSAGE_CENTER_MODULE_PLAN.md`
- `MESSAGE_CENTER_INNER_MESSAGES_TAB_PLAN.md`
- `MESSAGE_CENTER_INNER_SUBSCRIPTION_MANAGEMENT_PLAN.md`
- `MESSAGES_UNIFICATION_PLAN.md`
- `INNER_MESSAGE_SEND_TOOL_PLAN.md`
- `AGENT_MESSAGE_CONTENT_VALIDATION_PLAN.md`

### docs/issue/
```
AGENT_TASK_CANCEL_FLOW_FIX.md
AGENTS_ORCHESTRATION_CODE_REVIEW.md
HISTORY.md
TODO.md
fix/
├── 2026-03-16-runtime-ei-sync-404.md
├── 2026-03-17-identity-memo-tool-id-list.md
├── 2026-03-17-orchestration-replan-sse-task-reset.md
├── 2026-03-19-inner-message-tool-input-preflight.md
├── TEMPLATE.md
```

### docs/skill/ (5 files)
```
AGENT_ROLE_TIER_SKILL.md
cto-rd-workflow-appendix.md     # CTO R&D workflow skill appendix
cto-rd-workflow.md              # CTO R&D workflow core skill
meeting-sensitive-skill.md
orchestration-planner-guard.md
```

### docs/technical/ (27 files)
Includes:
- `AGENT_COLLAB_MESSAGE_REDIS_ARCHITECTURE.md`
- `INNER_MESSAGE_REDIS_EVENT_SUBSCRIPTION_ROUTING_DESIGN.md`
- Various agent, orchestration, meeting, MCP, and tooling designs

### docs/api/ (9 files)
```
API.md, agents-api.md, agent-action-logs-api.md, engineering-intelligence-api.md,
gateway-api.md, legacy-api.md, opencode-api.md, prompt-registry-api.md, ws-api.md
```

### docs/architecture/
```
ARCHITECTURE.md
AGENT_ROLE_TIER_ARCHITECTURE.md
MICROSERVICES_MIGRATION.md
self-evolution/  (6 files: 01-scope-and-principles through 06-implementation-roadmap)
```

### docs/development/ (62 files)
Development summaries for completed plans.

### docs/guide/ (5 files)
```
AGENT&ROLE.MD, EXECUTOR.MD, ORCHESTRATION_PLAN.MD, PLANER&PROMPT.MD, SKILL_LOAD.md
```

### docs/dailylog/
```
RULES.md
DAILY_PROGRESS_OLD.md
day/    (2026-03-11.md through 2026-03-20.md -- 10 daily logs)
week/   (2026-W11.md)
```

### docs/learn/
```
llm-streaming-tool-persistence.md
```

---

## 3. docs/feature/RULES.md (Full Content)

This is the **feature documentation maintenance specification**. Key points:

- **3-level feature hierarchy**: Level 1 (major modules like `agent`, `memo`, `meeting`), Level 2 (specific features like `agent/agent_mcp`), Level 3 (sub-features)
- **Each Level-2 feature gets one doc** at `docs/feature/<L1>_<L2>.md`
- **Required sections**: Feature Design (goals, data structures, core logic), Related Docs (plan/, development/, technical/, api/), Related Code Files (backend + frontend)
- **Rule: Read feature docs before coding** -- if the doc exists and is sufficient, do not scan code files
- **Update triggers**: New features, refactoring, API changes, tech optimizations
- Feature docs **reference** (not duplicate) plan/development/technical/API docs

---

## 4. docs/skill/cto-rd-workflow-appendix.md (Full Content)

This is the **CTO R&D Workflow Skill Appendix** (version 0.2.0, `on-demand` load mode, parent skill: `cto-rd-workflow`).

It contains three sections:

**A. Trigger Rules:**
- High-probability trigger phrases: "做一个需求", "修一下这个问题", "出一个方案", "提 PR / 提交代码", etc.
- Recommended trigger scenarios: when requirements enter R&D pipeline, need classification, involve 2+ stages
- Non-trigger scenarios: pure Q&A, one-off edits, explicit discussion-only
- Minimum trigger condition: item is feature/fix/doc AND needs 2+ pipeline stages

**B. Output Templates for Each Step:**
- Step1: Requirement understanding (goals, understanding, impact, unknowns, assumptions)
- Step2: Classification & tagging (type: feature/fix/doc, level, module, priority, risk)
- Step3: Plan & design (tasks, complexity, doc filing, acceptance criteria, agent assignment)
- Step4: Development execution (input docs, assignment, progress tracking)
- Step5: Acceptance (build, test, review, consistency checks)
- Step6: Release (version, environment, execution, results)

**C. Pending Meeting Template:** For unresolved issues needing human decision.

---

## 5. Frontend Components Related to "message" / "内部消息"

### Primary Message Center Files

| Absolute Path | Purpose |
|---|---|
| `/Users/van/Workspace/harbin/frontend/src/pages/MessageCenter.tsx` | **Full message center page** -- 3 tabs: 系统消息, 内部消息, 消息监听. 732 lines. Supports filtering by type/status/event, pagination, mark read, subscription management. |
| `/Users/van/Workspace/harbin/frontend/src/services/messageCenterService.ts` | **Message center API service** -- 166 lines. Defines `MessageCenterService` class with methods: `listMessages`, `getUnreadCount`, `listInnerMessages`, `listInnerMessageSubscriptions`, `upsertInnerMessageSubscription`, `listInnerMessageEventDefinitions`, `markAsRead`, `markAllAsRead`. Exports types: `MessageCenterItem`, `InnerMessageCenterItem`, `InnerMessageSubscriptionItem`, `InnerMessageEventDefinitionItem`. |
| `/Users/van/Workspace/harbin/frontend/src/components/Layout.tsx` | **Header message entry point** -- contains unread badge, message drawer, real-time SSE message listening (`message-center.message.created`), navigation to `/message-center`, mark-read actions. |
| `/Users/van/Workspace/harbin/frontend/src/App.tsx` | Route: `/message-center` -> `<MessageCenter />` (protected route, line 90) |

### Pages That Reference "message" Patterns (selected)

| Absolute Path | Context |
|---|---|
| `/Users/van/Workspace/harbin/frontend/src/pages/Orchestration.tsx` | Error messages, debug session messages display |
| `/Users/van/Workspace/harbin/frontend/src/pages/PlanDetail.tsx` | Debug session messages display |
| `/Users/van/Workspace/harbin/frontend/src/pages/RdConversation.tsx` | `extractMessageText()` helper for conversation messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/Agents.tsx` | Error messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/Skills.tsx` | Error messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/Tools.tsx` | Error messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/Login.tsx` | Error messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/EmployeeManagement.tsx` | Error messages |
| `/Users/van/Workspace/harbin/frontend/src/pages/AgentTaskRunner.tsx` | Error messages |

### Backend Message-Related Files

| Absolute Path | Purpose |
|---|---|
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message.controller.ts` | Direct/publish/ACK/subscription endpoints |
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message.service.ts` | Message persistence, subscription matching, status transitions, queueing |
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message-dispatcher.service.ts` | Redis dispatch consumer (retry/dead-letter) |
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message-agent-runtime-bridge.service.ts` | Bridge inner messages to Agent Runtime execution chain |
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message-collaboration-automation.service.ts` | Task event to anthropomorphic collaboration message automation |
| `/Users/van/Workspace/harbin/backend/src/modules/inner-message/inner-message.module.ts` | Module assembly |
| `/Users/van/Workspace/harbin/backend/src/modules/message-center/message-center.controller.ts` | System/inner message query, read ops, Hook endpoint |
| `/Users/van/Workspace/harbin/backend/src/modules/message-center/message-center.service.ts` | System + inner message query aggregation, read logic |
| `/Users/van/Workspace/harbin/backend/src/modules/message-center/message-center.module.ts` | Module assembly |
| `/Users/van/Workspace/harbin/backend/src/modules/messages/messages.controller.ts` | Legacy messages controller |
| `/Users/van/Workspace/harbin/backend/src/modules/messages/messages.service.ts` | Legacy messages service |
| `/Users/van/Workspace/harbin/backend/src/modules/messages/messages.module.ts` | Legacy messages module |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/tool.service.ts` | `send_internal_message` tool execution & validation |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/internal-api-client.service.ts` | Internal message API call wrapper |
| `/Users/van/Workspace/harbin/backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts` | Built-in tool seed (includes `send_internal_message`) |

---

## 6. General Project Structure

### backend/
```
backend/
├── .env, .env.example
├── .eslintrc.cjs
├── nest-cli.json
├── package.json, pnpm-lock.yaml
├── tsconfig.json
├── apps/                        # Microservice apps (Nest.js monorepo)
│   ├── agents/src/              # Agent execution, tools, skills, memos, models, runtime, opencode, prompt-registry, agent-tasks
│   ├── ei/src/                  # Engineering Intelligence service
│   ├── gateway/src/             # API Gateway
│   ├── legacy/                  # Legacy app (tsconfig only, code in src/)
│   └── ws/src/                  # WebSocket service
├── libs/                        # Shared libraries
│   ├── auth/
│   ├── common/
│   ├── contracts/
│   ├── infra/
│   └── models/
├── src/                         # Legacy main app source
│   ├── app.module.ts
│   ├── main.ts
│   ├── config/
│   ├── modules/                 # 14 modules:
│   │   ├── agent-action-logs/
│   │   ├── agents-client/
│   │   ├── api-keys/
│   │   ├── auth/
│   │   ├── employees/
│   │   ├── hr/
│   │   ├── inner-message/      # Inner message system (6 files)
│   │   ├── invitations/
│   │   ├── meetings/
│   │   ├── message-center/     # Message center (3 files)
│   │   ├── messages/           # Legacy messages (3 files)
│   │   ├── operation-logs/
│   │   ├── orchestration/
│   │   └── roles/
│   └── shared/
├── scripts/
├── test/
├── reload.sh, start.sh
```

### frontend/
```
frontend/
├── index.html
├── package.json, pnpm-lock.yaml
├── vite.config.ts, tsconfig.json, tsconfig.node.json
├── tailwind.config.js, postcss.config.js
├── src/
│   ├── App.tsx                  # Route definitions
│   ├── main.tsx                 # Entry point
│   ├── index.css
│   ├── vite-env.d.ts
│   ├── components/              # Layout.tsx, Toast.tsx
│   ├── config/
│   ├── hooks/                   # use-agent-task-sse.ts, useToast.ts
│   ├── lib/
│   ├── pages/                   # 29 page components:
│   │   ├── AgentDetail.tsx
│   │   ├── Agents.tsx
│   │   ├── AgentTaskRunner.tsx
│   │   ├── ApiKeys.tsx
│   │   ├── Dashboard.tsx
│   │   ├── EmployeeManagement.tsx
│   │   ├── EngineeringBoard.tsx
│   │   ├── EngineeringIntelligence.tsx
│   │   ├── EngineeringRequirementDetail.tsx
│   │   ├── EngineeringRequirements.tsx
│   │   ├── EngineeringStatistics.tsx
│   │   ├── HRManagement.tsx
│   │   ├── Login.tsx
│   │   ├── Meetings.tsx
│   │   ├── Memos.tsx
│   │   ├── MessageCenter.tsx    # ** Message center page **
│   │   ├── Models.tsx
│   │   ├── OperationLogs.tsx
│   │   ├── Orchestration.tsx
│   │   ├── PlanDetail.tsx
│   │   ├── ProjectManagement.tsx
│   │   ├── PromptRegistry.tsx
│   │   ├── PromptRegistryDetail.tsx
│   │   ├── RdConversation.tsx
│   │   ├── Register.tsx
│   │   ├── Scheduler.tsx
│   │   ├── Skills.tsx
│   │   ├── Tools.tsx
│   │   └── UiManagement.tsx
│   ├── services/                # 21 API service files
│   │   ├── messageCenterService.ts   # ** Message center service **
│   │   ├── agentService.ts, agentActionLogService.ts
│   │   ├── api.ts, apiKeyService.ts, authService.ts
│   │   ├── employeeService.ts, engineeringIntelligenceService.ts
│   │   ├── hrService.ts, invitationService.ts
│   │   ├── meetingService.ts, memoService.ts
│   │   ├── modelService.ts, operationLogService.ts
│   │   ├── orchestrationService.ts, promptRegistryService.ts
│   │   ├── rdConversationService.ts, schedulerService.ts
│   │   ├── skillService.ts, toolService.ts, wsService.ts
│   ├── stores/                  # agentStore.ts
│   └── types/                   # index.ts
```

### data/
```
data/
├── agents.json
├── memos/
├── skills/
```

---

## Summary

This is an **AI Agent management platform** (codename "Harbin") built with:
- **Backend**: Nest.js monorepo with 5 microservice apps (`agents`, `ei`, `gateway`, `legacy`, `ws`) + shared libs
- **Frontend**: React + Vite + Tailwind CSS, 29 pages, 21 services
- **Database**: MongoDB (Mongoose)
- **Messaging**: Redis-based async message dispatch with inner-message + message-center modules
- **Documentation**: Extremely thorough -- 178 plan docs, 62 development summaries, 27 technical designs, 16 feature docs, 5 skill docs, 9 API docs, daily logs

The "message/内部消息" feature spans two distinct systems:
1. **Inner Message** (`inner-message` module): Agent-to-agent collaboration messaging with Redis dispatch, subscription routing, retry/dead-letter, and runtime bridge
2. **Message Center** (`message-center` module): Unified UI for system notifications + inner messages + subscription management, with real-time SSE updates and unread badge