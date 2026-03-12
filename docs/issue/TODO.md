# OpenCode 研发能力开发 TODO

## 开发前必读（先统一认知）

在进入 TODO 1 之前，先完整阅读以下文档，确保对方案边界、数据流和多环境策略有一致理解：

1. `docs/plan/OPENCODE_SERVE_INTERACTION_MASTER_PLAN.md`
2. `docs/plan/AGENT_CONFIG_JSON_EXTENSION_PLAN.md`
3. `docs/technical/OPENCODE_EI_DATA_LAYER_TECHNICAL_DESIGN.md`
4. `docs/technical/OPENCODE_MULTI_ENV_COLLAB_TECHNICAL_DESIGN.md`
5. `docs/development/OPENCODE_RD_WORKFLOW_DISCUSSION_TOPICS.md`

阅读完成后再开始执行下方 TODO 列表。

## 执行规则（本轮）

1. 严格串行：一次只执行一个 TODO。
2. 每个 TODO 完成后，先汇报结果并等待你明确同意，再进入下一个 TODO。
3. 若当前 TODO 涉及风险决策（权限、数据口径、接口破坏性变更），先暂停并确认。
4. 执行前创建功能分支

## TODO 列表（按执行顺序）

- [x] 0. 文档设计前置：完成本轮功能设计文档更新（feature 层），统一 `config` / 门禁 / 同步口径后再进入代码开发。
- [x] 1. Agent 数据模型新增 `config` JSON 字段，并打通创建/更新/查询接口（兼容历史 Agent，默认 `{}`）。
- [x] 2. Agent 执行前门禁接入 `config` 解析：角色准入（engineering/operations/technical-expert）、模型绑定匹配校验。
- [x] 3. 实现 `agent + period` 配额检测与超限审批触发（`permission.asked`），审批通过后可继续执行。
- [x] 4. 新增 OpenCode 执行适配层骨架：`OpenCodeAdapter` + `OpenCodeExecutionService`，支持会话建立与流式事件接入。
- [x] 5. 打通 OpenCode 事件到 Runtime 的落库链路（run/message/part/outbox），保留映射函数为可扩展点。
- [x] 6. 在 `agent_runs` 扩展字段：`roleCode`、`executionChannel`、`executionData`，并将 `syncState/lastSyncAt/syncRetryCount` 合并为 `sync` 对象字段。
- [x] 7. Engineering Intelligence 新增同步接收接口：`POST /engineering-intelligence/opencode/runs/sync`（事件明细 A 方案）。
- [x] 8. Engineering Intelligence 新增分析模型：`ei_opencode_run_analytics`、`ei_opencode_event_facts`，完成幂等与顺序校验。
- [x] 9. 实现多环境同步字段与校验：`envId`、`nodeId`，并新增 Ingest 接口与节点验签骨架。
- [x] 10. 接入失败补偿：同步失败重试、死信重投、run 级 replay 补齐流程。
- [x] 11. 前端补充最小可用能力：运行状态卡片 + 授权处理入口 + Agent `config` 编辑入口（先 JSON 形式）。
- [x] 12A. 文档前置收口：在开发进行中持续更新 feature/api/technical 口径文档，避免后置集中补写。
- [x] 12B. 文档最终收口：全部 TODO 完成后更新 development/dailylog 并做最终一致性核对。

## 备注

- GitHub 状态联动（PR/CI）暂不纳入本轮开发，保留为后续议题。
