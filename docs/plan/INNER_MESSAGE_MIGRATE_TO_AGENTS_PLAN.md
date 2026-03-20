# Inner Message 迁移至 Agents 模块计划

## 背景与目标

- 当前 Inner Message 主实现位于 legacy backend 模块（`backend/src/modules/inner-message`），与 Agents 运行时存在跨应用依赖。
- 本次目标是将 Inner Message 相关能力迁移到 `backend/apps/agents` 内聚管理，减少跨模块耦合，并统一到 Agents 应用内的执行与运维边界。

## 执行步骤

1. 盘点现有能力与入口，冻结本次迁移范围（direct/publish/ack/subscription/dispatcher/runtime-bridge/automation）。
2. 在 `backend/apps/agents` 新增 Inner Message 模块，迁移 controller/service/dispatcher/runtime-bridge/automation 及相关依赖。
3. 调整依赖方调用路径（orchestration、message-center、tools internal api client），切换到 agents 内实现。
4. 下线或瘦身 legacy `backend/src/modules/inner-message`，保留必要兼容层并避免双消费。
5. 补齐并更新测试，覆盖直发、订阅、ACK、自动协作、失败重试等关键链路。
6. 更新功能文档与日常记录，确保实现与文档一致。

## 关键影响点

- 后端：`backend/apps/agents` 模块装配、依赖注入、任务执行链整合。
- API：Inner Message 对外接口与 message-center 读接口的调用落点切换。
- 编排：任务事件触发的协作消息链路切换到 agents 侧。
- 测试：迁移相关集成与回归用例需要同步更新。

## 风险与依赖

- 迁移窗口内若新旧消费者并存，可能出现重复消费与状态错乱。
- 依赖链较长（orchestration/message-center/tools），需要分阶段切换并验证。
- 本次不将“Mongo collection 与 Redis 路由结构不变”作为硬约束，按迁移实现需要进行最小必要调整。
