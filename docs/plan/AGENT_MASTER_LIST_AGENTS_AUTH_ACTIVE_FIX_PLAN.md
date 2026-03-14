# Agent Master list-agents 鉴权与活跃态校验修复计划

## 背景

- 现象：`CEO助理-小武` 在调用 `list-agents` 时返回 `Agent not found or inactive`，无法拉取实时 Agent Master 列表。
- 目标：确认问题是否由新鉴权（JWT/hybrid）启用导致；若否，也需修复当前阻断问题并补齐回归保障。

## 执行步骤

1. 复现并定位 `list-agents` 调用链路，区分鉴权阶段失败还是业务查询阶段失败。
2. 对比 `legacy/hybrid/jwt-strict` 下的主体解析与权限校验逻辑，确认是否为新鉴权回归。
3. 修复调用者 Agent 活跃态与列表查询逻辑中不合理耦合（若存在），保证合法调用可返回列表。
4. 若根因为鉴权，修复 scope/白名单/主体校验缺陷并保持向后兼容策略。
5. 增加回归测试（成功调用、无权限拒绝、inactive 边界），验证修复有效且不放宽安全边界。
6. 输出根因结论与改动说明，评估是否需要同步更新 API/功能文档。

## 关键影响点

- 后端：`tools` 模块执行入口、`agent-master` 工具处理器、Agent 查询服务。
- 鉴权：Bearer token claims、tool scopes、whitelist、active 状态校验。
- 测试：工具执行与鉴权边界回归测试。
- 文档：必要时更新 `docs/api/agents-api.md` 与相关 feature/technical 文档。

## 风险与依赖

- 依赖可用日志与测试环境以准确判定根因。
- 若存在历史脏数据（调用方 Agent 状态异常），需明确策略并保持最小权限原则。
