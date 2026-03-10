# Agent Memo 成绩/批评与 Topic 聚合暂停计划

## 1. 需求理解与范围

- 在现有备忘录体系新增两个标准备忘录类型：`achievement`（成绩）与 `criticism`（批评）。
- 在 memo update 规则中增加写入主体限制：
  - 成绩：仅高管 / 人类专属助理 / HR 可记录，agent 自己不可写。
  - 批评：高管 / 人类专属助理 / HR / agent 自己均可记录。
- 暂停 `topic` 类型聚合：停止自动聚合写入，避免继续产出质量不稳定的 topic 聚合内容。

## 2. 执行步骤

1. 扩展 Memo 类型定义与默认规则，将 `achievement`、`criticism` 纳入 `MemoKind` 并归类为 `standard`。
2. 在 memo create/update 链路新增角色来源校验，按 memoKind 执行写权限控制。
3. 调整 topic 聚合流程，关闭事件队列到 topic memo 的自动落库聚合。
4. 更新单元测试，覆盖新增 memoKind、权限限制、topic 聚合暂停行为。
5. 更新 `docs/feature/AGENT_MEMO.md`，同步类型与规则变更说明。

## 5. 追加需求（2026-03-10）

- 强约束：仅当 `memoKind=topic` 时，`memoType` 必须为 `knowledge`，禁止出现 `topic + standard`。
- `achievement` / `criticism` 保持每个 agent 单文档策略，但写入模式改为“追加记录”，禁止覆盖历史。
- 追加写入格式：新记录写到文档末尾；若文档已有内容，先插入分割线 `—` 再追加本次记录。
- 同步更新 memo 工具提示词，明确上述写入规则（类型约束 + 追加 + 分割线）。

## 6. 目标对象与类型纠偏（2026-03-10 夜）

- 修复 `append-memo` 写入目标：支持显式 `targetAgentId`，并优先写入目标 agent，避免错误落到调用者自身。
- 当 `memoType=standard` 但未提供 `memoKind` 时，拒绝写入，防止默认回退到 `topic/knowledge`。
- 强校验：
  - `memoKind=achievement|criticism` 时，`memoType` 必须为 `standard`。
  - `memoKind=topic` 时，`memoType` 必须为 `knowledge`。
- 工具提示词补充“目标 agent 写入 + 类型约束 + achievement/criticism 追加分隔线 `—`”规则。

## 3. 关键影响点

- 后端：`agent-memo.schema.ts`、`memo.service.ts`、聚合调度与事件聚合流程。
- API：memo create/update 请求参数校验与行为变化。
- 测试：memo service 单测需要新增/调整断言。
- 文档：功能设计文档需同步更新，避免实现与文档偏差。

## 4. 风险与依赖

- 权限识别依赖调用方传入可判定来源字段（默认按 `source` 判定），若上游来源标识不规范可能导致误拒绝。
- 本次仅暂停 topic 自动聚合，不删除历史 topic 文档，后续可在质量方案明确后恢复。
