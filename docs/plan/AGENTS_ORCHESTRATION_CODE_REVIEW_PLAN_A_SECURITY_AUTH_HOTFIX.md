# [已弃用] AGENTS_ORCHESTRATION_CODE_REVIEW_PLAN_A_SECURITY_AUTH_HOTFIX

> 状态：已弃用（2026-03-24）
>
> 说明：该文档为历史方案/设计沉淀，仅用于归档追溯，不再作为当前实现依据。
> 当前实现请以 `docs/guide/ORCHESTRATION_SERVICE_SPLIT_RUNTIME.MD` 与 `docs/feature/ORCHETRATION_TASK.md` 为准。
# Plan A - 安全与鉴权热修（P0，JWT + Agent Credential 升级版）

## 1. 目标

在最短周期内将工具调用鉴权从“固定 system 身份签名”升级为“Agent 凭证换取短期 JWT + 统一授权链”，实现：

1. 可拒绝：未授权调用在执行入口被硬拦截
2. 可审计：每次调用可定位真实 agent、会话与 token jti
3. 可追踪：端到端 traceId + jti 串联网关/工具/下游日志
4. 可回滚：支持兼容模式与灰度开关，紧急情况下快速降级

---

## 2. 范围与非目标

### 2.1 范围

- `backend/apps/agents/src/modules/tools/**`
- `backend/apps/agents/src/modules/agents/**`（授权来源与白名单收敛）
- 新增认证与密钥管理模块（Agent Credential + Token Issuer + Guard）
- 工具执行入口鉴权链、输入强校验、输出净化、审计扩展
- 配置校验、灰度开关、安全回归测试

### 2.2 非目标

- 不在本计划内重构 `tool.service.ts` 领域结构（结构性重构留在 Plan C/F）
- 不在本计划内完成所有下游服务的细粒度 scope 拆分（先覆盖 tools 主链路）
- 不在本计划内引入第三方 IAM（保持平台内建能力）

---

## 3. 现状问题与对应缺陷

1. N-17/N-32：`INTERNAL_CONTEXT_SECRET` 依赖运行时判错，缺少启动 fail-fast
2. N-30：`ToolService.executeTool()` 未统一执行 `assigned whitelist + requiredPermissions`
3. N-31：内部调用主体固定为 `agents-service/system`，无法审计真实 actor
4. N-33：`input/output` 缺少 schema 强校验与净化
5. 新增风险：当前模式无法安全支持“系统工具外部调用”

---

## 4. 目标架构（执行态）

### 4.1 核心原则

- Agent 不自签 JWT，仅持有 `agentKeyId + agentSecret` 用于换取短期 token
- JWT 统一由平台私钥签发（推荐 `RS256` 或 `EdDSA`）
- token 只承载授权快照，服务端仍做实时授权复核（防权限漂移）

### 4.2 双层授权模型

1. Token 层：验签 + 过期 + audience + scope 基础校验
2. 业务层：`tool.enabled + assigned whitelist + requiredPermissions + strict mode`

---

## 5. 分阶段执行（可交付导向）

### Phase A1 - Secret 治理与启动校验

执行项：

1. 删除 `INTERNAL_CONTEXT_SECRET` fallback 语义
2. 服务启动时强校验关键安全配置（缺失立即 fail-fast）
3. 输出结构化错误日志（包含配置名，不输出敏感值）

交付物：

- 安全配置校验器
- `.env.example` 与部署文档更新

### Phase A2 - Agent Credential 与 Token 签发

执行项：

1. 新增 Agent 凭证模型（`agentKeyId`、`secretHash`、`status`、`expiresAt`、`lastUsedAt`）
2. 新增 token 签发接口（credential exchange）
3. JWT claims 固化：`sub/agentId/orgId/toolScopes/permVersion/profileVersion/jti/iat/exp/aud`
4. token TTL 默认 10 分钟（可配置）

交付物：

- Agent Credential 管理服务（创建/轮换/吊销）
- Token Issuer 与验签组件
- API 契约文档（换 token 与错误码）

### Phase A3 - 工具执行入口统一鉴权链

执行项：

1. 在 `ToolService.executeTool()` 强制收敛全部鉴权：
   - `tool.enabled`
   - `assigned whitelist`
   - `requiredPermissions`
   - token scope
2. 禁止旁路调用绕过统一入口
3. 未授权错误码标准化（401/403 + 业务错误码）

交付物：

- 统一授权链实现
- 审计字段扩展（agentId、actorRole、originSessionId、jti、traceId）

### Phase A4 - 输入校验、输出净化、主体透传

执行项：

1. `inputSchema` 强校验（类型、必填、额外字段、长度边界）
2. 工具输出进入 LLM 前净化（敏感字段掩码、尺寸上限、结构白名单）
3. 内部调用头透传真实 actor（不再固定 system 身份）

交付物：

- 参数校验器
- 输出净化器
- actor 透传协议文档

### Phase A5 - 回归测试、灰度与回滚

执行项：

1. 增加安全回归：越权、伪造 token、过期 token、权限变更漂移、缺密钥启动
2. 灰度开关：
   - `TOOLS_AUTH_MODE=legacy|hybrid|jwt-strict`
   - `TOOLS_AUTH_STRICT_PERMISSIONS=true|false`
3. 监控面板：401/403 比例、误拒绝率、token 签发失败率

交付物：

- 测试用例与报告
- 监控指标与告警阈值
- 回滚手册

---

## 6. 关键影响点

1. 后端：认证模块、tools 执行链、agent 权限读取逻辑
2. API：新增 token exchange 接口；tools 执行接口增加 Bearer token 支持
3. 数据库：新增 agent credential 集合与索引
4. 测试：单测 + 集成 + 安全回归
5. 文档：plan、technical、api、feature 交叉引用

---

## 7. 前置依赖

1. 部署环境提供 JWT 签名密钥（建议非对称密钥）
2. 网关与 agents 服务达成统一 `audience/issuer` 约定
3. 下游服务确认可消费 actor 透传字段
4. 业务确认 requiredPermissions 来源优先级（agent/profile/tool metadata）

---

## 8. 问题映射表

| 问题 | 解决动作 | 核心文件（计划） |
|---|---|---|
| N-17/N-32 | 移除默认密钥 + 启动 fail-fast | `backend/apps/agents/src/modules/tools/internal-api-client.service.ts` + 配置模块 |
| N-30 | 统一鉴权链（enabled/whitelist/requiredPermissions/scope） | `backend/apps/agents/src/modules/tools/tool.service.ts` |
| N-31 | 透传真实 actor + token 主体审计 | `backend/apps/agents/src/modules/tools/internal-api-client.service.ts` |
| N-33 | input 强校验 + output 净化 | `backend/apps/agents/src/modules/tools/tool.service.ts` + validator/sanitizer |
| 外部调用安全 | agent credential exchange + JWT guard | auth module + controller/guard |

---

## 9. 验收标准（量化）

1. 关键安全配置缺失时服务启动失败（100%）
2. 未授权调用拒绝率 100%（含外部调用与旁路尝试）
3. 权限变更后旧 token 在 10 分钟内自然失效，且实时复核可立即阻断
4. 审计日志可定位 `agentId + jti + toolId + traceId + originSessionId`
5. 安全回归测试通过，无 P0/P1 回归

---

## 10. 验证命令

在 `backend/` 执行：

```bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm run build:agents
npm test -- apps/agents/src/modules/tools/tool.service.spec.ts --runInBand
npm test -- apps/agents/src/modules/auth --runInBand
```

---

## 11. 风险、灰度与回滚

### 11.1 风险

1. 历史链路仍依赖 legacy 签名头
2. 凭证轮换初期可能导致外部调用失败
3. requiredPermissions 历史数据可能不完整

### 11.2 灰度策略

1. 环境顺序：dev -> staging -> pre -> prod
2. 模式顺序：`legacy` -> `hybrid` -> `jwt-strict`
3. 每阶段观察 24h：401/403、误拒绝率、P95 延时、签发失败率

### 11.3 回滚策略

1. 紧急回滚到 `hybrid` 或 `legacy` 模式
2. 保留 JWT 审计与日志能力，不回滚审计字段
3. 不恢复硬编码默认密钥

---

## 12. 文档关联

1. 技术设计：`docs/technical/AGENT_TOOL_AUTH_JWT_CREDENTIAL_TECHNICAL_DESIGN.md`
2. 功能文档：`docs/feature/AGENT_TOOL.md`
3. API 文档：`docs/api/agents-api.md`（待同步新增接口）
