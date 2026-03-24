# tool.service.ts 拆分 & 内部工具 builtin 目录统一 — 开发计划

## 1. 背景

`backend/apps/agents/src/modules/tools/tool.service.ts` 已膨胀至 **2664 行 / 87 个方法**，混合了 Tool Identity 解析、Registry CRUD、执行引擎、分发路由、内联工具实现、执行统计等 6 类职责。同时所有内部工具 handler 散落在 `tools/` 根目录，缺少统一组织。

## 2. 目标

1. 将 `tool.service.ts` 按职责拆分为 4 个独立 service + 1 个 util + 1 个 Facade
2. 从 `tool.service.ts` 内联逻辑中抽出 5 个新 handler service
3. 将全部内部工具 handler（含已有 8 个 + 新建 5 个 + web-tools）统一迁入 `builtin/` 目录
4. 清理已确认的死代码（10 个 legacy wrapper 方法）
5. 保持外部接口（controller、其他模块引用）完全兼容

## 3. 开发项规划

### Phase 1：基础设施（无功能变更）

| # | 开发项 | 产出文件 | 预估行数 | 依赖 |
|---|--------|----------|----------|------|
| 1.1 | 创建 `builtin/` 目录 & barrel export | `builtin/index.ts` | 20 | — |
| 1.2 | 抽取 Tool Identity 工具函数 | `tool-identity.util.ts` | ~200 | — |

### Phase 2：迁移已有 handler 到 builtin/

| # | 开发项 | 涉及文件 | 说明 |
|---|--------|----------|------|
| 2.1 | 迁移 `orchestration-tool-handler.service.ts` | 移入 `builtin/` | 仅改路径 + 更新 import |
| 2.2 | 迁移 `requirement-tool-handler.service.ts` | 同上 | |
| 2.3 | 迁移 `repo-tool-handler.service.ts` | 同上 | |
| 2.4 | 迁移 `model-tool-handler.service.ts` | 同上 | |
| 2.5 | 迁移 `skill-tool-handler.service.ts` | 同上 | |
| 2.6 | 迁移 `audit-tool-handler.service.ts` | 同上 | |
| 2.7 | 迁移 `meeting-tool-handler.service.ts` | 同上 | |
| 2.8 | 迁移 `prompt-registry-tool-handler.service.ts` | 同上 | |
| 2.9 | 迁移 `web-tools.service.ts` | 同上 | |
| 2.10 | 更新 `tool.module.ts` 中所有 import 路径 | `tool.module.ts` | |
| 2.11 | 更新 `tool.service.ts` 中所有 import 路径 | `tool.service.ts` | |
| 2.12 | 更新测试文件 import 路径 | `*.spec.ts` | |
| 2.13 | 运行 lint + typecheck 验证 | — | 确保零编译错误 |

### Phase 3：新建 handler — 从 tool.service.ts 抽出内联实现

| # | 开发项 | 产出文件 | 抽出方法（原行号） | 预估行数 |
|---|--------|----------|-------------------|----------|
| 3.1 | Agent Master Handler | `builtin/agent-master-tool-handler.service.ts` | `getAgentsMcpList`(2253), `createAgentByMcp`(1970), `getAgentRuntimeStatusMap`(2425), `getRoleMapByIds`(2455), `resolveDefaultApiKeyId`(1917), `resolveRoleIdForCreate`(1937), `normalizeProvider`(1794) | ~350 |
| 3.2 | Agent Role Handler | `builtin/agent-role-tool-handler.service.ts` | `listAgentRolesByMcp`(2103), `createAgentRoleByMcp`(2127), `updateAgentRoleByMcp`(2177), `deleteAgentRoleByMcp`(2238), `normalizeRoleMcpPayload`(2078) | ~200 |
| 3.3 | Memo Handler | `builtin/memo-tool-handler.service.ts` | `searchMemoMemory`(1460), `appendMemoMemory`(1485), `resolveMemoActorContext`(1581) | ~200 |
| 3.4 | Communication Handler | `builtin/communication-tool-handler.service.ts` | `sendSlackMessage`(2514), `sendGmail`(2533), `sendInternalMessage`(1734) | ~120 |
| 3.5 | RD Intelligence Handler | `builtin/rd-intelligence-tool-handler.service.ts` | `runEngineeringStatistics`(1688), `runDocsHeat`(1714) | ~80 |
| 3.6 | 更新 `tool.module.ts` 注册 5 个新 provider | `tool.module.ts` | | |
| 3.7 | 更新分发路由对接新 handler | `tool.service.ts` (dispatch 区域) | | |
| 3.8 | 运行 lint + typecheck 验证 | — | | |

### Phase 4：拆分 tool.service.ts 核心逻辑

| # | 开发项 | 产出文件 | 预估行数 | 说明 |
|---|--------|----------|----------|------|
| 4.1 | 抽取 Registry Service | `tool-registry.service.ts` | ~600 | 种子、CRUD、查询、路由、执行历史、View 转换 |
| 4.2 | 抽取 Execution Service | `tool-execution.service.ts` | ~400 | 执行主逻辑、鉴权链、校验、结果/错误归一化 |
| 4.3 | 抽取 Dispatcher Service | `tool-execution-dispatcher.service.ts` | ~200 | 中央分发路由 + 各域 dispatch |
| 4.4 | 瘦身 tool.service.ts 为 Facade | `tool.service.ts` | ~100 | 委托 registry + execution，保持外部 API 兼容 |
| 4.5 | 更新 `tool.module.ts` 注册拆分后的 service | `tool.module.ts` | | |
| 4.6 | 运行 lint + typecheck + 全量测试 | — | | |

### Phase 5：清理 & 收尾

| # | 开发项 | 说明 |
|---|--------|------|
| 5.1 | 删除死代码：10 个 legacy wrapper | `getCodeDocsReader`, `getCodeUpdatesReader`, `executeDocsWrite`, `executeRepoRead`, `listMeetings`, `sendMeetingMessage`, `updateMeetingStatus`, `listSkillsByTitle`, `createSkillByMcp`, `debugOrchestrationTask` |
| 5.2 | 拆分/更新测试文件 | `tool.service.spec.ts` 拆分对应到新 service |
| 5.3 | 更新 barrel export (`builtin/index.ts`) | 覆盖所有 handler |
| 5.4 | 全量运行 `npm run lint && npm run typecheck && npm run test` | |
| 5.5 | 更新功能文档 & 技术文档 | |

## 4. 关键影响点

| 影响范围 | 影响程度 | 说明 |
|----------|----------|------|
| `tool.controller.ts` | 低 | Facade 保持接口兼容，import 不变或仅微调 |
| `tool.module.ts` | 中 | 需注册所有新/迁移的 provider |
| 其他引用 `ToolService` 的模块 | 无 | Facade 模式保证签名不变 |
| `tool.service.spec.ts` | 高 | 需拆分测试到对应 service |
| 已有 handler `*.spec.ts` | 低 | 仅更新 import 路径 |

## 5. 风险

| 风险 | 应对 |
|------|------|
| 循环依赖 | `tool-identity.util.ts` 为纯函数无依赖；各 handler 仅依赖基础设施 service，不反向依赖 Facade |
| handler 抽出后缺少 DI 注入 | 明确每个 handler 的 constructor 依赖，在 module 中注册 |
| 迁移路径导致编译错误 | 每个 Phase 结束后运行 lint + typecheck 验证 |

## 6. 关联文档

- 技术设计：`docs/technical/TOOL_SERVICE_SPLIT_BUILTIN_UNIFICATION_DESIGN.md`
- 现有架构：`docs/technical/TOOLING_UNIFICATION_ARCHITECTURE_DESIGN.md`
- Tool ID 命名：`docs/technical/TOOL_ID_NAMESPACE_FORMAT_OPTIMIZATION_DESIGN.md`
- 鉴权设计：`docs/technical/AGENT_TOOL_AUTH_JWT_CREDENTIAL_TECHNICAL_DESIGN.md`

## 7. 实施结果（2026-03-24）

- [x] Phase 1：创建 `builtin/` 目录与 `tool-identity.util.ts`
- [x] Phase 2：已有 handler 与 web-tools 迁移到 `builtin/`，并完成 module/import 路径更新
- [x] Phase 3：新建 5 个 handler（agent-master/agent-role/memo/communication/rd-intelligence）并接入分发
- [x] Phase 4：拆分 `tool-registry/tool-execution/tool-execution-dispatcher`，`tool.service.ts` 变更为 Facade
- [x] Phase 5：移除 legacy wrapper、补齐/迁移测试、更新 feature/technical/dailylog 文档
