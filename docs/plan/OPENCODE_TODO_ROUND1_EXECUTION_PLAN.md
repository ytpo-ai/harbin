# OpenCode TODO Round1 执行计划

## 1. 背景

- 本计划用于落实 `docs/issue/TODO.md` 当前轮次的研发工作。
- 本轮先进行文档功能设计与执行清单微调，确保后续开发按统一口径串行推进。

## 2. 执行目标

1. 在不改变主目标的前提下，调整 TODO 执行结构，降低并行冲突与口径漂移风险。
2. 先完成 2 级功能文档设计（Agent 管理、Agent Runtime、Engineering Intelligence）。
3. 后续按 TODO 严格串行推进代码实现，每个 TODO 完成后等待确认再进入下一项。

## 3. 执行步骤（本次确认版）

1. 重排 `docs/issue/TODO.md`：新增文档设计前置项（TODO 0），并将文档收口拆为前置设计与后置回填。
2. 更新 `docs/feature/AGENT_MG.md`：补充 Agent `config` 的 JSON 编辑入口与数据约束。
3. 更新 `docs/feature/AGENT_RUNTIME.md`：补充 OpenCode 执行前门禁、`agent_runs` 扩展字段与同步状态口径。
4. 新增 `docs/feature/ENGINEERING_INTELLIGENCE.md`：补充 EI 在 OpenCode 事件同步与分析层职责设计。
5. 更新 `docs/feature/INDEX.md`：修复工程智能功能文档索引缺失。
6. 完成以上文档后进入研发执行：从 TODO 1 开始严格串行，单项完成后汇报并等待确认。

## 4. 关键影响点

- 后端：`apps/agents`、`apps/engineering-intelligence` 的 schema/service/controller。
- API：Agents 与 EI 同步接口契约（`config`、`roleCode`、`executionData`、`syncState`、`envId/nodeId`）。
- 前端：主应用内 Agent config 入口、运行状态卡片与授权入口。
- 文档：`docs/feature`、`docs/api`、`docs/technical`、`docs/development` 口径一致性。

## 5. 风险与依赖

1. 历史 Agent 缺失 `config` 可能引发行为不一致
   - 缓解：默认 `{}` 与运行时兜底策略。
2. 事件明细同步存在顺序与幂等风险
   - 缓解：`runId+eventId` 幂等、`runId+sequence` 顺序校验。
3. 配额超限审批可能阻塞执行链路
   - 缓解：明确 `permission.asked` 状态与超时处理策略。

## 6. 当前边界

- 本计划阶段不直接提交代码实现，仅完成“TODO 结构调整 + 功能文档设计落盘”。
- GitHub 状态联动（PR/CI）继续维持在暂缓列表，不纳入本轮。
