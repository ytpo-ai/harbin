# [已弃用] AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_E_SCHEMA_COLLECTION_GOVERNANCE

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Plan E - Schema 命名与模型一致性治理（P1）

## 1. 目标

统一 Mongo collection 命名规范并消除模型冲突，避免默认复数化导致的命名漂移和运行时不确定性。

## 2. 范围与非目标

### 范围

- `backend/src/shared/schemas/**`
- `backend/apps/agents/src/schemas/**`
- `backend/apps/engineering-intelligence/src/schemas/**`
- 迁移脚本、兼容策略、CI 校验规则

### 非目标

- 不在本计划内重构业务服务逻辑
- 不在本计划内替换数据库引擎或访问层

## 3. 对应问题

- N-28（未显式声明 collection，命名漂移）
- N-29（`AgentSession` 双 schema 定义冲突）

## 4. 前置依赖

1. 产出全量 schema 清单与当前 collection 名
2. 确认命名规范：统一 `module_model`（snake_case）
3. 确认迁移窗口与回滚窗口

## 5. 分阶段执行

### Phase E1 - 规范固化（不迁移数据）

1. 所有 schema 显式声明 `collection`
2. 新增规范文档与命名映射表（旧名 -> 新名）
3. CI 增加校验：禁止新增未声明 collection

### Phase E2 - 高风险冲突优先修复

1. 优先收敛 `AgentSession` 双定义冲突
2. 统一单一 schema 来源与字段定义
3. 验证模型注册顺序不再影响运行结果

### Phase E3 - 数据迁移与兼容

1. 生成迁移脚本（可重复执行、幂等）
2. 低峰执行 collection rename/migrate
3. 灰度期提供双读或兼容映射
4. 校验读写一致性后移除兼容逻辑

## 6. 问题映射表

| 问题 | 解决动作 | 核心文件 |
|---|---|---|
| N-28 | 全量 schema 显式 collection + CI 校验 | `backend/src/shared/schemas/**`, `backend/apps/**/schemas/**` |
| N-29 | AgentSession 单一定义收敛 | `backend/src/shared/schemas/agent-session.schema.ts`, `backend/apps/agents/src/schemas/agent-session.schema.ts` |

## 7. 验收标准（量化）

1. schema 显式 collection 覆盖率达到 100%
2. `AgentSession` 双 schema 冲突消除
3. 迁移后关键查询/写入路径无异常
4. CI 能阻断未声明 collection 的新增 schema

## 8. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build
npm run test -- --runInBand
```

另外需执行迁移前后数据一致性校验脚本（按项目脚本目录落地）。

## 9. 风险、灰度与回滚

### 风险

- 线上迁移可能影响历史查询路径
- 双读兼容期过长会增加维护成本

### 灰度

- 先迁移低风险集合并验证
- 再迁移高流量集合

### 回滚

- 每批迁移保留回滚脚本与快照
- 发现异常立即回退到旧 collection 映射

## 10. 本次会话确认后的命名映射（2026-03-15）

### 10.1 重命名项（old -> new）

- `agentprofiles` -> `agent_profiles`
- `toolexecutions` -> `agent_tool_executions`
- `orchestrationschedules` -> `orchestration_schedules`
- `agenttooltokenrevocations` -> `agent_tool_token_revocations`
- `agenttoolcredentials` -> `agent_tool_credentials`
- `orchestrationtasks` -> `orchestration_tasks`
- `apikeys` -> `api_keys`
- `plansessions` -> `orchestration_plan_sessions`
- `rdtasks` -> `ei_tasks`
- `orchestrationplans` -> `orchestration_plans`
- `operationlogs` -> `operation_logs`
- `agentsessions` -> `agent_sessions`
- `agentroles` -> `agent_roles`
- `agentmemoversions` -> `agent_memo_versions`
- `skills` -> `agent_skills`
- `agentmemos` -> `agent_memos`
- `engineeringrepositories` -> `ei_repositories`
- `tools` -> `agent_tools`
- `toolkits` -> `agent_toolkits`
- `model_registry` -> `agent_model_registry`
- `messages` -> `chats`

### 10.2 未重命名项（保持不变）

- `agents`
- `inner_messages`
- `inner_message_subscriptions`
- `ei_projects`
- `system_messages`
- `tasks`
- `employees`
- `invitations`
- `meetings`
- `agent_action_logs`
- `agent_runs`
- `agent_parts`
- `agent_messages`
- `agent_events_outbox`
- `agent_runtime_maintenance_audits`
- `ei_requirements`
- `ei_project_statistics_snapshots`
- `ei_opencode_run_analytics`
- `ei_opencode_event_facts`
- `ei_opencode_run_sync_batches`

### 10.3 结构治理项

- 删除 collection 对应 schema 中的 `organizationId` 字段（如存在历史残留，迁移脚本中统一 `$unset`）。
- `AgentSession` 采用单一目标集合名 `agent_sessions`，避免双 schema 默认命名冲突。

## 11. 本次追加治理（文件命名与 Schema 归属收敛）

### 11.1 目标

- 统一 schema 文件命名为 kebab-case，消除 camelCase 文件名（例如 `api-key.schema.ts`）。
- 将仅由 agents 领域使用的 schema 下沉到 `backend/apps/agents/src/schemas/`，明确领域归属（如 tools 相关 schema）。

### 11.2 执行步骤

1. 盘点 schema 文件命名不规范项并生成改名映射。
2. 盘点 agents 专属 schema 的实际引用范围并确认迁移名单。
3. 执行文件改名/迁移并修复所有 import 路径。
4. 清理 shared 层冗余导出，确保 shared 仅保留跨 app 复用模型。
5. 运行 build/test 校验，更新相关文档（plan/feature/dailylog）。

### 11.3 本次文件改名与迁移映射

文件改名（仅命名规范化）：

- `backend/src/shared/schemas/apiKey.schema.ts` -> `backend/src/shared/schemas/api-key.schema.ts`
- `backend/apps/agents/src/schemas/skill.schema.ts` -> `backend/apps/agents/src/schemas/agent-skill.schema.ts`
- `backend/src/shared/schemas/message.schema.ts` -> `backend/src/shared/schemas/chat.schema.ts`
- `backend/src/shared/schemas/rd-project.schema.ts` -> `backend/src/shared/schemas/ei-project.schema.ts`
- `backend/src/shared/schemas/rd-task.schema.ts` -> `backend/src/shared/schemas/ei-task.schema.ts`

文件迁移（下沉到 agents 领域）：

- `backend/src/shared/schemas/tool.schema.ts` -> `backend/apps/agents/src/schemas/tool.schema.ts`
- `backend/src/shared/schemas/toolkit.schema.ts` -> `backend/apps/agents/src/schemas/toolkit.schema.ts`
- `backend/src/shared/schemas/toolExecution.schema.ts` -> `backend/apps/agents/src/schemas/tool-execution.schema.ts`
- `backend/src/shared/schemas/agent-tool-credential.schema.ts` -> `backend/apps/agents/src/schemas/agent-tool-credential.schema.ts`
- `backend/src/shared/schemas/agent-tool-token-revocation.schema.ts` -> `backend/apps/agents/src/schemas/agent-tool-token-revocation.schema.ts`
