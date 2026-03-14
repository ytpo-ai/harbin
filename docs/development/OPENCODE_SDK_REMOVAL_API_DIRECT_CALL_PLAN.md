# OpenCode SDK Removal API Direct Call 开发总结

## 1. 交付概览

- 完成后端 OpenCode 调用链路去 SDK 化，移除 `@opencode-ai/sdk`，统一改为 HTTP API 直连。
- 覆盖 Runtime 执行适配层与 RD 管理 OpenCode 集成层，保持原有业务入口与数据语义兼容。
- 降低动态导入失败、SDK 导出结构变更导致的运行风险，提升接口层排障可观测性。

## 2. 实现明细

### 2.1 Agents Runtime 侧

- 重构 `backend/apps/agents/src/modules/opencode/opencode.adapter.ts`：
  - `createSession` 改为 `POST /session`（支持 `directory` 参数）
  - `promptSession` 改为 `POST /session/:id/message`
  - `subscribeEvents` 改为 `GET /event`（SSE）并在适配层解析 `event/data` 帧
- 保留 `OpenCodeExecutionService` 对外契约不变，继续通过适配层消费会话与事件能力。

### 2.2 RD 管理侧

- 重构 `backend/src/modules/rd-management/opencode.service.ts`：
  - 删除 SDK 初始化、动态导入和 endpoint client 缓存分支
  - 新增统一 HTTP 请求封装（baseUrl、Basic Auth、超时、错误日志）
  - 会话/项目/上下文/事件/健康检查接口统一走 API
  - 后台事件缓存改为基于 SSE 订阅填充 `recentEvents`

### 2.3 依赖清理

- `backend/package.json` 移除 `@opencode-ai/sdk`。
- 同步更新 lockfile（`backend/pnpm-lock.yaml`）。

## 3. 验证结果

- `npm run build:agents`：通过
- `npm run build`：通过
- 目标文件 ESLint：通过（`opencode.adapter.ts`、`opencode.service.ts`）
- 全量 `npm run lint` 存在仓库既有报错（与本次改造无直接关系）：
  - `apps/agents/src/modules/tools/local-repo-updates-reader.util.ts`
  - `src/modules/auth/auth.service.ts`
  - `src/modules/invitations/invitation.service.ts`

## 4. 风险与后续建议

1. 建议补充 OpenCode API 契约测试（特别是 SSE 事件格式与字段漂移）。
2. 建议将 `/find/text`、`/file/read` 等辅助接口能力与 serve 版本做矩阵兼容校验。
3. 若后续引入多 endpoint 路由，建议在请求封装层增加 endpoint 级熔断与重试策略。
