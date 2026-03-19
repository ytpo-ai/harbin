# Agents Runtime Session/Message/Part 清理脚本计划

## 背景

- 需要提供一个可重复执行的清理脚本，用于清理 agents runtime 相关数据：`agent_sessions`、`agent_messages`、`agent_parts`。
- 清理需同时覆盖对应 Redis 侧运行时缓存，避免 Mongo 清理后遗留队列/事件键导致后续噪音。

## 执行步骤

1. 在 `backend/scripts/` 新增清理脚本，统一加载 `.env/.env.development/.env.local` 并初始化 Mongo/Redis 连接。
2. 设计命令参数：默认 `dry-run`，仅在显式确认参数下执行真实删除，降低误删风险。
3. 实现 Mongo 清理逻辑：按条件（可选）或全量删除 `agent_sessions`、`agent_messages`、`agent_parts`，并输出删除前后统计。
4. 实现 Redis 清理逻辑：清理与 agent task runtime 相关 key（默认队列 key + 事件 key 前缀），支持可扩展 pattern。
5. 在 `backend/package.json` 增加脚本命令，便于标准化调用。
6. 完成最小化验证（至少 dry-run + 构建校验），并补充功能文档与 dailylog 记录。

## 关键影响点

- 后端脚本：`backend/scripts`
- 数据库：`agent_sessions`、`agent_messages`、`agent_parts`
- 缓存：Redis runtime/task 相关 keys
- 文档：`docs/feature/AGENT_RUNTIME.md`、`docs/dailylog/day/2026-03-17.md`

## 风险与依赖

- 删除操作不可逆，必须通过 `dry-run` 默认值与显式确认参数控制。
- Redis key 采用前缀扫描删除，需保持白名单范围明确，避免误删与 runtime 无关数据。
