# Agent Tool 鉴权升级技术设计（Agent Credential + JWT）

## 1. 背景与问题

当前 tools 调用链以内部签名头为主，主体身份固定为 system。该模式在“内部服务互调”场景可用，但存在以下问题：

1. 主体不可追溯：审计日志无法可靠映射真实调用 agent
2. 授权不闭环：`requiredPermissions` 与 `assigned whitelist` 未在工具执行入口统一硬校验
3. 外部调用不可扩展：缺少标准化、可吊销、可轮换的对外调用凭证体系
4. 安全边界偏弱：输入强校验与输出净化覆盖不足

本设计目标是将该链路升级为“Agent 凭证换 token + JWT 验签 + 统一授权链”的标准安全模型。

---

## 2. 设计目标

### 2.1 功能目标

1. 支持 agent 通过凭证换取短期 JWT 并调用系统工具
2. 统一工具执行入口鉴权：`enabled + whitelist + permissions + scope`
3. 支持外部系统安全调用 tools API

### 2.2 安全目标

1. 最小权限原则（Least Privilege）
2. 凭证可轮换、token 可吊销
3. 鉴权失败默认拒绝（Fail Closed）
4. 全链路可审计（agentId/jti/traceId/session）

### 2.3 非目标

1. 不在本次方案引入企业级 IAM（如 OIDC Provider 托管）
2. 不在本次方案完成所有下游服务的细粒度 scope 重构

---

## 3. 术语定义

1. Agent Credential：`agentKeyId + agentSecret`，用于 exchange 获取 token
2. Access Token：短期 JWT，仅用于 tools 调用
3. Tool Scope：token 中的工具授权快照（如 `tool:execute:xxx`）
4. Required Permission：工具元数据要求的权限能力（如 `repo_read`）
5. Permission Version：权限快照版本号，用于权限漂移检测

---

## 4. 总体架构

## 4.1 架构组件

1. Credential Service
   - 负责 agent 凭证创建、轮换、吊销、校验
2. Token Issuer Service
   - 接收有效 credential，签发短期 JWT
3. Tools Auth Guard
   - 验签、校验 claims、注入请求上下文
4. Tool Authorization Evaluator
   - 在 `ToolService.executeTool()` 做最终授权决策
5. Audit Logger
   - 输出结构化安全审计日志与指标

## 4.2 信任边界

1. 外部调用方仅可信到 credential exchange 接口
2. tools 执行接口仅信任平台签发 JWT
3. 业务授权必须在服务端实时复核，不能仅信任 token scope

---

## 5. 数据模型设计

## 5.1 `agent_credentials` 集合

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 凭证记录 ID |
| `agentId` | string | 归属 agent |
| `keyId` | string | 公共标识，调用方可见 |
| `secretHash` | string | `agentSecret` 的哈希值（bcrypt/argon2） |
| `status` | enum | `active`/`revoked`/`expired` |
| `scopeTemplate` | string[] | 凭证允许换取的最大 scope 集 |
| `createdBy` | string | 创建人 |
| `createdAt` | date | 创建时间 |
| `rotatedAt` | date | 轮换时间 |
| `lastUsedAt` | date | 最近使用时间 |
| `expiresAt` | date | 凭证过期时间 |

索引建议：

1. 唯一索引：`keyId`
2. 组合索引：`agentId + status`
3. TTL/过期清理：`expiresAt`（按业务需要）

## 5.2 `token_revocations`（可选）

用于紧急吊销 token：

| 字段 | 类型 | 说明 |
|---|---|---|
| `jti` | string | JWT 唯一 ID |
| `agentId` | string | 归属 agent |
| `reason` | string | 吊销原因 |
| `expiresAt` | date | 与 token exp 对齐 |

---

## 6. JWT 设计

## 6.1 Header

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "tools-auth-key-2026-03"
}
```

## 6.2 Payload Claims

```json
{
  "iss": "harbin-agents-auth",
  "aud": "tools-api",
  "sub": "agent:<agentId>",
  "agentId": "<agentId>",
  "orgId": "<orgId>",
  "toolScopes": ["tool:execute:builtin.sys-mg.internal.agent-master.list-agents"],
  "requiredPermissionsSnapshot": ["repo_read", "orchestration_write"],
  "profileVersion": 12,
  "permVersion": 38,
  "originSessionId": "<sessionId>",
  "jti": "<uuid>",
  "iat": 1710000000,
  "exp": 1710000600
}
```

字段说明：

1. `toolScopes`：用于快速拒绝明显越权调用
2. `permVersion/profileVersion`：服务端用于判断 token 快照是否落后
3. `originSessionId`：提升跨链路审计可见性

## 6.3 生命周期策略

1. Access Token TTL：默认 10 分钟（建议范围 5-15 分钟）
2. 不提供长期 refresh token 给不可信外部系统（优先重新 exchange）
3. 关键操作支持 `jti` 级别紧急吊销

---

## 7. 鉴权与授权流程

## 7.1 Token Exchange 流程

1. 调用方提交 `agentKeyId + agentSecret`
2. 服务端查找 `agent_credentials`，校验状态与 hash
3. 读取 agent 当前授权集（白名单工具 + 权限）
4. 签发短期 JWT，并记录审计日志

简化时序：

```text
Caller -> Auth API: POST /auth/agent/token (keyId + secret)
Auth API -> Credential Store: verify credential
Auth API -> Agent Service: load current tool whitelist/permissions
Auth API -> Signer: issue JWT
Auth API -> Caller: access_token + expires_in
```

## 7.2 Tool Execute 流程

1. Guard 验签（alg/kid/iss/aud/exp/jti）
2. 提取 `agentId/toolScopes/permVersion/profileVersion`
3. `ToolService.executeTool()` 执行统一授权链：
   - `tool.enabled`
   - `assigned whitelist`
   - `requiredPermissions`
   - `toolScopes`
   - 权限版本实时复核
4. 执行前 input schema 校验；执行后 output 净化
5. 记录执行审计日志

---

## 8. 授权判定策略

## 8.1 判定顺序（Fail Closed）

1. 未携带 token -> `401 AUTH_MISSING_TOKEN`
2. token 无效/过期 -> `401 AUTH_INVALID_TOKEN` / `401 AUTH_TOKEN_EXPIRED`
3. tool 不在 token scope -> `403 AUTH_SCOPE_DENIED`
4. tool 未启用 -> `403 TOOL_DISABLED`
5. tool 不在 assigned whitelist -> `403 TOOL_NOT_ASSIGNED`
6. `requiredPermissions` 不满足 -> `403 TOOL_PERMISSION_DENIED`
7. 通过 -> 允许执行

## 8.2 权限来源优先级

建议采用：

1. agent 实例权限（`agent.permissions`）
2. role/profile 权限（按角色聚合）
3. tool 元数据 `requiredPermissions`

注：服务端应始终以实时数据为准；token 仅作快速预校验。

## 8.3 当前实现口径（2026-03）

以下为当前线上代码口径（用于替代仅“建议稿”的理解偏差）：

1. 工具可执行前置条件（`ToolService.executeTool()`）
   - tool 存在且 `enabled=true`
   - agent 存在；当鉴权模式为 JWT 时要求 `agent.isActive=true`

2. scope 校验
   - 若请求上下文携带 scopes，必须满足：
     - `tool:execute:*` 或
     - `tool:execute:<resolvedToolId>`
   - 否则拒绝：`TOOL_SCOPE_DENIED`

3. assigned whitelist 校验
   - 在 strict/JWT 场景下，或 agent 已配置 tools 时，目标 tool 必须在 `agent.tools` 中
   - 否则拒绝：`TOOL_NOT_ASSIGNED`

4. requiredPermissions 校验（强校验）
   - 工具声明：`tool.requiredPermissions[].id`
   - 授予来源按实时聚合：
     - `agent.permissions`
     - role/profile 权限（role 服务 + agent profile）
     - token/context 注入 permissions
   - 缺失任一 required permission 即拒绝：`TOOL_PERMISSION_DENIED`

5. role/profile 权限聚合口径
   - profile 主字段：`permissions`
   - 兼容字段：`permissionsManual`、`permissionsDerived`、`capabilities`
   - 服务端聚合时按并集处理；`capabilities` 仅作迁移期兼容

6. profile 自动派生口径
   - `permissionsDerived` 由 profile 下 `tools.requiredPermissions` 自动计算
   - `permissions = permissionsManual ∪ permissionsDerived`

7. Agent 继承口径
   - 创建 Agent 时：自动继承 role profile 权限到 `agent.permissions`（合并补齐）
   - 更新 Agent 时：当角色/工具/permissions 相关字段变更，重新执行继承合并

8. 前端配置口径（体验层，不替代后端鉴权）
   - Agent 管理页工具项展示 `requiredPermissions`
   - 默认开启“自动赋权”：勾选工具时自动补齐 `agent.permissions`
   - 关闭后仅更新 `agent.tools`；后端仍会在执行期按 requiredPermissions 拒绝越权调用

---

## 9. 内部调用主体透传

将原固定 system 身份改为真实 actor 透传：

1. `actorId`：来源 `token.agentId` 或执行上下文
2. `actorRole`：来源运行态角色映射
3. `originSessionId`：来源 token/session
4. `traceId`：每次执行生成并贯通

透传载体：

1. 内部 HTTP 头（签名或 JWT）
2. 执行日志字段
3. 下游审计字段

---

## 10. 输入校验与输出净化

## 10.1 输入校验

1. 基于 `tool.inputSchema` 强校验
2. 拒绝额外字段（`additionalProperties=false`）
3. 字符串长度、数组大小、枚举值、URL/路径规则校验
4. 校验失败返回 `400 TOOL_INPUT_INVALID`

## 10.2 输出净化

1. 大小上限（字符数/层级深度/数组长度）
2. 敏感字段过滤（如 `token`、`secret`、`password`、`authorization`）
3. 二进制/大对象裁剪并摘要化
4. 净化后再进入 LLM 上下文

---

## 11. 安全策略与密钥管理

## 11.1 密钥策略

1. JWT 使用非对称密钥对（私钥签发、公钥验签）
2. 密钥按 `kid` 轮换，允许多 key 并存
3. 私钥不落库，存放在安全配置中心或密钥管理服务

## 11.2 凭证策略

1. `agentSecret` 仅显示一次，服务端只存 hash
2. 默认 90 天强制轮换（可配置）
3. 连续失败阈值触发临时冻结

## 11.3 防重放

1. token 短 TTL + `jti`
2. 高风险工具可开启 nonce/一次性令牌策略

---

## 12. 兼容、灰度与回滚

## 12.1 运行模式

1. `legacy`：仅旧签名头（用于紧急兼容）
2. `hybrid`：同时支持旧签名头和 JWT（默认灰度）
3. `jwt-strict`：仅 JWT，拒绝 legacy

## 12.2 迁移步骤

1. 上线 credential 与 token exchange（不切流）
2. tools API 接入 Guard，开启 `hybrid`
3. 外部调用方改造完成后切 `jwt-strict`
4. 下线 legacy 头签名调用

## 12.3 回滚步骤

1. 切回 `hybrid` 或 `legacy`
2. 保留审计字段，避免回滚丢失可观测性
3. 排查后再恢复 `jwt-strict`

---

## 13. API 契约（建议稿）

## 13.1 获取 Token

- `POST /api/tools/auth/agent-token`

请求：

```json
{
  "agentKeyId": "ak_live_xxx",
  "agentSecret": "as_live_xxx",
  "requestedScopes": ["tool:execute:*"],
  "originSessionId": "sess_xxx"
}
```

响应：

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 600,
  "scope": "tool:execute:*"
}
```

## 13.2 执行工具

- `POST /api/tools/:id/execute`
- Header: `Authorization: Bearer <jwt>`

鉴权模式开关：

1. `TOOLS_AUTH_MODE=legacy`：仅内部签名上下文
2. `TOOLS_AUTH_MODE=hybrid`：内部签名 + Bearer token（灰度默认）
3. `TOOLS_AUTH_MODE=jwt-strict`：仅 Bearer token

失败码示例：

1. `401 AUTH_INVALID_TOKEN`
2. `403 TOOL_NOT_ASSIGNED`
3. `403 TOOL_PERMISSION_DENIED`
4. `400 TOOL_INPUT_INVALID`

---

## 14. 可观测性与审计

## 14.1 审计日志字段

1. `timestamp`
2. `agentId`
3. `toolId`
4. `jti`
5. `originSessionId`
6. `traceId`
7. `decision`（allow/deny）
8. `denyReasonCode`
9. `latencyMs`

## 14.2 指标与告警

1. `tools_auth_denied_total`（按原因分桶）
2. `tools_auth_token_issue_failed_total`
3. `tools_auth_invalid_token_total`
4. `tools_auth_decision_latency_ms`

告警建议：

1. 5 分钟内 `AUTH_INVALID_TOKEN` 激增 > 阈值
2. token 签发失败率 > 1%
3. `TOOL_PERMISSION_DENIED` 连续异常升高

---

## 15. 测试方案

## 15.1 单元测试

1. credential 校验：正常/过期/吊销/secret mismatch
2. jwt 验签：过期、aud 不匹配、kid 不存在、签名错误
3. authorization evaluator：enabled/whitelist/permissions/scope 全分支

## 15.2 集成测试

1. 外部 exchange -> execute 全链路
2. 权限变更后旧 token 拒绝策略
3. hybrid 与 strict 模式切换

## 15.3 安全测试

1. token 重放
2. 越权 scope 伪造
3. 参数注入
4. 输出敏感字段泄漏

---

## 16. 实施清单（代码落点）

建议落点：

1. `backend/apps/agents/src/modules/auth/**`
   - credential service
   - token issuer
   - jwt guard
2. `backend/apps/agents/src/modules/tools/tool.service.ts`
   - 统一授权链收敛
   - input/output 安全处理
3. `backend/apps/agents/src/modules/tools/internal-api-client.service.ts`
   - 真实 actor 透传
4. `backend/src/shared/schemas/**`
   - `agentCredential.schema.ts`
   - `tokenRevocation.schema.ts`（可选）

---

## 17. 风险与待决策项

1. 是否需要 refresh token（当前建议不开放给外部系统）
2. `toolScopes` 粒度到 toolkit 还是 tool id（建议先 tool id）
3. 吊销列表是否全量落库（与 QPS、存储成本相关）
4. 多组织场景下 `orgId` 约束来源（token claim vs runtime context）

---

## 18. 关联文档

1. 计划文档：`docs/plan/AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_A_SECURITY_AUTH_HOTFIX.md`
2. 功能文档：`docs/feature/AGENT_TOOL.md`
3. API 文档：`docs/api/agents-api.md`（需补充 token exchange 与错误码）
