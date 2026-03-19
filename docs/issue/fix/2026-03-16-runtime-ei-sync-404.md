# Runtime EI Sync 404 修复记录

## 1. 基本信息

- 标题：RuntimeEiSyncService 同步 EI 接口持续 404
- 日期：2026-03-16
- 负责人：OpenCode
- 关联需求/会话：用户反馈日志 `EI sync failed ... status code 404`
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：`RuntimeEiSyncService` 对同一 run 持续重试并最终 dead-letter，日志显示 `Request failed with status code 404`。
- 触发条件：run 终态后触发 EI 同步（自动轮询或手动 replay）。
- 影响范围：Agents Runtime 的 EI 同步链路（`sync.state` 无法进入 `synced`）。
- 严重程度：中

## 3. 根因分析

- 直接原因：同步请求地址缺少全局前缀 `/api`，实际请求打到 `/ei/sync-batches`，而 EI 服务路由实际为 `/api/ei/sync-batches`。
- 深层原因：`RuntimeEiSyncService` 的 `ENGINEERING_INTELLIGENCE_SERVICE_URL` 默认值与内部拼接逻辑未与其他内部客户端保持一致（其他模块默认带 `/api`）。
- 相关模块/文件：
  - `backend/apps/agents/src/modules/runtime/runtime-ei-sync.service.ts`

## 4. 修复动作

- 修复方案：统一在 Runtime EI Sync 内对 EI base URL 做标准化处理，确保最终 base 始终包含 `/api`，再拼接 `ei/sync-batches`。
- 代码改动点：
  - 新增 `resolveEiBaseUrl()`：去尾部 `/`，若末尾不是 `/api` 则自动补齐。
  - 新增 `eiSyncUrl` 常量，统一请求目标。
  - `onModuleInit` 增加一次启动日志，打印最终命中同步地址，便于排障。
- 兼容性处理：若环境变量已经配置到 `.../api`，不会重复追加；若配置到根地址（如 `http://localhost:3004`），自动补齐到 `.../api`。

## 5. 验证结果

- 验证步骤：
  - 执行 `npm run build:agents`（已按协议先初始化 nvm 环境）。
  - 检查编译通过，确认 `runtime-ei-sync.service.ts` 改动无类型/构建错误。
- 验证结论：通过
- 测试与检查：完成构建检查；未新增单测（当前 runtime 目录无现成 spec 基座）。

## 6. 风险与后续

- 已知风险：若部署环境将 EI 服务挂在非 `/api` 前缀的反向代理子路径，需显式在 `ENGINEERING_INTELLIGENCE_SERVICE_URL` 写完整路径（例如 `https://xxx/custom-prefix/api`）。
- 后续优化：可为 `RuntimeEiSyncService` 增补单测，覆盖 URL 标准化与重复 `/api` 场景。
- 是否需要补充功能文档/API文档：否
