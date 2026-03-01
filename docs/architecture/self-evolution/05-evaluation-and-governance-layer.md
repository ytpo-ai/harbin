# 分层 5：评估与治理层（Evaluation & Governance）

## 1. 分层职责

把实验结果转为治理决策，确保“进化有效且可控”。

## 2. 价值函数

推荐统一价值函数：

```text
U = w1 * success + w2 * throughput + w3 * collaboration
    - w4 * cost - w5 * risk
```

说明：
- `success`：任务与计划成功表现
- `throughput`：交付效率与时效
- `collaboration`：跨 Agent 协作质量
- `cost`：token 与工具成本
- `risk`：故障、审计异常、合规风险

权重由架构师按季度设定并版本化。

## 3. 决策模型

新增集合：`evolution_decisions`

推荐字段：
- `decisionId`
- `experimentId`
- `decisionType`（promote/hold/rollback/reject）
- `decisionReason`
- `evidencePack`
- `approvers`
- `effectiveAt`

默认策略：
- low risk：系统自动建议 + 人类快速确认
- medium risk：必须审批后推广
- high risk：双人审批 + 分阶段放量

## 4. 审计与可追溯

要求：
- 每次策略变更有唯一版本号
- 记录变更前后差异与生效窗口
- 实验报告、审批记录、回滚记录可关联查询

## 5. 回滚机制

回滚触发条件：
- 护栏越线
- 上线后出现新型高频错误
- 人工紧急停机

回滚要求：
- 一键切回基线策略
- 回滚后自动进入观察期
- 自动生成事故复盘草稿

## 6. 反模式控制

必须规避：
- 只优化单一指标（奖励劫持）
- 样本不足就宣告成功
- 没有稳定窗口就持续迭代
- 无审批越权推广高风险变更

## 7. 验收标准

- 100% 决策有证据包
- 100% 推广动作可回滚
- 关键护栏触发时 5 分钟内停机
