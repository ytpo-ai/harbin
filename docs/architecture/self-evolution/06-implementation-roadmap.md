# 分层 6：实施路线图（Implementation Roadmap）

## 1. 里程碑概览

- Phase A（2 周）：可观测与能力快照
- Phase B（2 周）：目标管理与提案生成
- Phase C（2 周）：实验编排与自动护栏
- Phase D（2 周）：价值评估与治理闭环

建议总周期：8 周。

## 2. Phase A：能力快照 MVP

交付物：
- `capability_snapshots` 数据模型
- 日级快照任务
- 基础能力看板（可先 API 输出）

验收指标：
- 连续 7 天快照成功率 >= 99%
- execution/efficiency/reliability 三维稳定输出

## 3. Phase B：目标与提案 MVP

交付物：
- `architect_intents` 模型与 CRUD
- Gap Analyzer
- `evolution_proposals` 模型与提案工作流（draft/review/approved）

验收指标：
- 每个 active Intent 至少 1 条提案
- 提案完整率（含回滚）= 100%

## 4. Phase C：实验 MVP

交付物：
- `evolution_experiments` 模型
- 小流量 A/B 执行器
- 护栏监控 + 自动停机 + 自动回滚

验收指标：
- 可成功运行至少 2 个真实实验
- 护栏越线时自动停机成功率 = 100%

## 5. Phase D：治理闭环 MVP

交付物：
- 价值函数配置与评估结果
- `evolution_decisions` 模型
- 审批、推广、回滚全链路记录

验收指标：
- 100% 决策有 evidence pack
- 至少 1 个实验成功推广并稳定运行 14 天

## 6. 首批推荐实验（按优先级）

1. 任务分配策略优化（降低 `waiting_human`）
2. 工具调用策略优化（降低完成任务成本）
3. 协作模式选择优化（提升计划完成率）

## 7. 风险与应对

- 指标口径漂移：建立指标字典与版本化
- 数据质量不足：低置信度不触发自动提案
- 实验污染：严格分桶与隔离
- 自动化越权：按风险级别强制审批

## 8. 上线策略

- 先单组织试点，再多组织推广
- 先低风险策略，再中高风险策略
- 每阶段设置 freeze window，避免并行大改
