# OpenCode TODO Round1 开发总结

## 1. 交付概览

- 按 `docs/issue/TODO.md` 串行完成了 `TODO 0` 到 `TODO 12A`，并推进到 `TODO 12B` 文档最终收口。
- 研发主线覆盖：Agent `config` 扩展、OpenCode 执行门禁、配额审批、Runtime→EI 同步链路、补偿重试与前端最小可用入口。
- 关键约束保持一致：前端能力保留在主应用 `frontend/`，未新增独立前端工程。

## 2. 后端实现要点

### 2.1 Agents 侧

- `agent` 模型新增 `config` JSON 字段，创建/更新/查询全链路打通，历史数据兼容默认 `{}`。
- OpenCode 门禁落地：
  - 角色准入：`engineering`、`operations`、`technical-expert`
  - 模型绑定匹配：`agent.config.execution.modelPolicy.bound`
  - 配额校验：`agent.config.budget`（`period+limit+unit=runCount`）
- 超限审批链路落地：触发 `permission.asked` 并暂停，审批通过后 `permission.replied` + 恢复执行。
- Runtime 数据扩展：`agent_runs` 增加 `roleCode`、`executionChannel`、`executionData`、`sync` 对象。

### 2.2 Runtime 与同步补偿

- 新增 OpenCode 适配层骨架：`OpenCodeAdapter` + `OpenCodeExecutionService`。
- OpenCode 事件到 Runtime 落库已打通，并保留映射扩展点。
- 新增 EI 同步补偿服务 `RuntimeEiSyncService`：
  - run 终态后自动入队同步
  - 失败重试（退避）
  - 死信标记与重投
  - run 级 replay 同步补齐
- 新增运行补偿接口：
  - `POST /agents/runtime/runs/:runId/sync-ei-replay`
  - `GET /agents/runtime/sync-ei/dead-letter`
  - `POST /agents/runtime/sync-ei/dead-letter/requeue`

### 2.3 Engineering Intelligence 侧

- 新增同步接口：`POST /engineering-intelligence/opencode/runs/sync`。
- 新增 ingest 接口：`POST /engineering-intelligence/opencode/ingest/events`（含节点验签骨架）。
- 落地分析模型：
  - `ei_opencode_event_facts`
  - `ei_opencode_run_analytics`
  - `ei_opencode_run_sync_batches`
- 实现幂等与顺序保障：
  - 批次幂等：`runId + syncBatchId`
  - 事件幂等：`runId + eventId`
  - 序列校验：`sequence` 连续升序

## 3. 前端实现要点

- Agent 创建/编辑弹窗新增 `config` JSON 编辑入口（文本模式）。
- Agent 详情页新增运行状态卡片：运行状态、同步状态、重试次数、最近同步时间。
- Agent 详情页新增授权处理入口：待授权 run 支持“同意并恢复/拒绝并取消”。
- 前端 `agentService` 补充 Runtime Run 查询与控制调用。

## 4. 文档与口径收口

- 已更新 feature/api/technical 文档口径，统一 `sync` 对象字段表达。
- 已补齐工程智能 2 级功能文档与 feature 索引映射。
- 已同步 OpenCode API 约束、验签头、补偿接口说明。

## 5. 风险与后续建议

1. 当前 ingest 验签为骨架模式，建议下阶段默认启用强校验并接入节点密钥轮换。
2. OpenCode 事件映射仍属第一阶段，建议补齐更细粒度 eventType→runtime event 映射表。
3. 前端授权入口目前为最小可用，建议后续补充独立审批列表与批处理能力。
