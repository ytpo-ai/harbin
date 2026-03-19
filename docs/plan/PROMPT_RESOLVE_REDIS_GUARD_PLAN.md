# Prompt Resolve Redis 门禁优化计划

## 需求理解

- 当前 `AgentExecutorService` 的 systemPrompt resolve 逻辑存在对 DB/其他来源的依赖，不符合“仅在发布后 Redis 已写入时才生效”的期望。
- 目标是将 resolve 触发条件收敛为 Redis 单一事实来源：Redis 命中则走 resolve；Redis 未命中则直接回退默认 prompt。

## 执行步骤

1. 梳理 Prompt 发布链路，确认发布动作发生时写入 Redis 的 key/value 与 TTL 策略。
2. 在发布流程补齐 Redis 写入（若缺失），确保“发布完成”与“Redis 可读”状态一致。
3. 调整 `AgentExecutorService`：resolve 判定仅依赖 Redis 命中，不再以 DB 是否存在作为前置条件。
4. 当 Redis 未命中时，统一回退默认 systemPrompt，并记录可观测日志（命中来源与回退原因）。
5. 补充/更新测试，覆盖“Redis 命中走 resolve”与“Redis 未命中走默认（即使 DB 有记录）”路径。
6. 更新相关功能文档与当日日志，说明新判定口径与兼容边界。

## 关键影响点

- 后端：Prompt 发布服务、`AgentExecutorService` prompt 解析入口。
- 缓存：Redis key 规范、TTL 与失效后的回退行为。
- 测试：service 单测（resolve 触发条件与 fallback 分支）。
- 文档：功能文档与 dailylog 需同步新的判定规则。

## 风险与依赖

- 若 Redis 写入与发布事务未对齐，可能出现短暂“发布成功但 resolve 未命中”的窗口，需要通过顺序/重试降低风险。
- 若历史流程依赖 DB 兜底，本次收敛后行为将更严格，需要用测试和日志保证可解释性。

## 验证方式

- 发布 Prompt 后立即执行任务，Redis 命中时应触发 resolve。
- 手动清理 Redis 后执行任务，应直接使用默认 prompt，不应再回退读取 DB。
- 日志应可区分 `redis_hit` 与 `redis_miss_fallback_default` 两类路径。
