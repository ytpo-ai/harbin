# 组织管理与公司治理模块下线计划

> 状态：已完成 - 后端 organizationId 遗留清理完成
> 更新时间：2026-03-09

## 背景

已完成组织管理与公司治理模块的主体清理（前后端功能代码已删除），但后端其他模块仍遗留大量 `organizationId` 字段和关联逻辑，需要持续清理以消除技术债务。

---

## 待清理文件清单

### 1. engineering-intelligence 模块 (3个文件)

| 文件 | 清理内容 |
|------|----------|
| `apps/engineering-intelligence/src/schemas/engineering-repository.schema.ts` | 移除 `organizationId` 字段及唯一索引 |
| `apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.controller.ts` | 移除 `getUserFromAuthHeader` 返回的 `organizationId`，调整各接口 |
| `apps/engineering-intelligence/src/modules/engineering-intelligence/engineering-intelligence.service.ts` | 移除 service 方法中的 `organizationId` 参数 |

### 2. agents 模块 (7个文件)

| 文件 | 清理内容 |
|------|----------|
| `apps/agents/src/modules/runtime/contracts/runtime-control.contract.ts` | 移除 `organizationId` 字段 |
| `apps/agents/src/modules/runtime/contracts/runtime-event.contract.ts` | 移除 `organizationId` 字段 |
| `apps/agents/src/modules/runtime/contracts/runtime-run.contract.ts` | 移除 `organizationId` 字段 |
| `apps/agents/src/modules/runtime/hook-dispatcher.service.ts` | 移除 `organizationId` 相关逻辑 |
| `apps/agents/src/modules/runtime/runtime-action-log-sync.service.ts` | 移除 `organizationId` 字段 |
| `apps/agents/src/modules/runtime/runtime-persistence.service.ts` | 移除 `organizationId` 过滤条件 |
| `apps/agents/src/modules/tools/tool.service.ts` | 移除 `organizationId` 解析和传递逻辑 |

### 3. gateway 模块 (2个文件)

| 文件 | 清理内容 |
|------|----------|
| `apps/gateway/src/gateway-auth.guard.ts` | 移除组织相关验证逻辑 |
| `apps/gateway/src/gateway-proxy.service.ts` | 移除 `organizationId` 转发 |

### 4. libs (2个文件)

| 文件 | 清理内容 |
|------|----------|
| `libs/auth/src/token.util.ts` | 移除 token 中的 `organizationId` 解析 |
| `libs/contracts/src/user-context.ts` | 移除 `organizationId` 类型定义 |

### 5. src 核心模块 (5个文件)

| 文件 | 清理内容 |
|------|----------|
| `src/modules/auth/auth.service.ts` | 移除组织相关逻辑 |
| `src/modules/invitations/invitation.controller.ts` | 移除 `organizationId` 参数 |
| `src/modules/invitations/invitation.service.ts` | 移除 `organizationId` 关联 |
| `src/modules/meetings/meeting.service.ts` | 移除 `organizationId` 解析和传递 |
| `src/modules/orchestration/session-manager.service.ts` | 移除 `organizationId` 参数 |

---

## 执行计划

### 阶段一：engineering-intelligence 模块（P0）

- [x] 1.1 清理 Schema：`organizationId` 字段和唯一索引
- [x] 1.2 清理 Controller：移除 `organizationId` 提取逻辑，调整各接口
- [x] 1.3 清理 Service：移除 `organizationId` 参数传递

### 阶段二：session-manager.service.ts（P1）

- [x] 2.1 移除所有方法的 `organizationId` 参数
- [x] 2.2 更新调用方（orchestration 模块）

### 阶段三：meeting.service.ts（P2）

- [x] 3.1 移除 `resolveMeetingOrganizationId` 方法
- [x] 3.2 清理 `buildMeetingTeamContext` 中的 `organizationId` 传递

### 阶段四：invitation 模块（P2）

- [x] 4.1 清理 Controller 参数
- [x] 4.2 清理 Service 中的组织关联逻辑

### 阶段五：gateway 和 auth（P2）

- [x] 5.1 清理 token.util.ts
- [x] 5.2 清理 user-context.ts
- [x] 5.3 清理 gateway-auth.guard.ts
- [x] 5.4 清理 gateway-proxy.service.ts

### 阶段六：agents runtime 模块（P3）

- [x] 6.1 清理 runtime-persistence.service.ts 过滤条件
- [x] 6.2 清理 tool.service.ts 中的 organizationId 逻辑
- [x] 6.3 清理 contract 文件中的字段定义
- [x] 6.4 清理 hook-dispatcher 和 action-log-sync

---

## 关键影响点

- **API 变更**：engineering-intelligence API 将不再需要 organizationId 标识
- **Runtime**：Agent 运行时不依赖 organizationId 进行隔离
- **Session**：会话管理不再按组织隔离

## 风险与依赖

- engineering-intelligence 当前按组织隔离存储仓库，移除后需确认数据访问边界
- Agents runtime 中多处使用 `organizationId` 作为 Redis key 前缀，需确保不影响现有功能
- Session 管理中的 organizationId 传递涉及多个模块，需同步更新

---

## 验证清单

- [x] `backend npm run build` 通过
- [ ] `backend npm run lint` 通过
- [ ] `backend npm run typecheck` 通过（若配置）

## 阶段结果

- `backend/**/*.ts` 中 `organizationId` 已无命中
- 受影响模块已按阶段全部完成清理
- 已验证构建通过，后续可按需执行 lint/typecheck 与接口冒烟
