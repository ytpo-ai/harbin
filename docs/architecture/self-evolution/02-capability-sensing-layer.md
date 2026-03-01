# 分层 2：能力感知层（Capability Sensing）

## 1. 分层职责

能力感知层负责回答三个问题：
- 系统现在会什么（能力覆盖）
- 系统现在做得怎么样（能力质量）
- 这些判断有多可信（证据与置信度）

## 2. 输入数据

优先复用现有接口：
- 消息质量与成本：`/api/messages`
- 编排执行状态：`/api/orchestration/plans`、`/api/orchestration/plans/:id`
- 工具执行：`/api/tools/executions/stats`
- 团队绩效：`/api/hr/performance/:agentId`、`/api/hr/team-health`
- 操作风险：`/api/operation-logs`

## 3. 能力模型（Capability Vector）

建议统一能力向量：

```text
C_now = {
  planning: number,
  execution: number,
  collaboration: number,
  efficiency: number,
  reliability: number,
  compliance: number,
  confidence: number
}
```

维度解释：
- planning：计划可执行性、依赖合理性、计划完成率
- execution：任务完成率、失败率、重试率
- collaboration：多 Agent 协作完成时效与质量
- efficiency：成本/成功任务、token/完成任务
- reliability：延迟、错误率、计划中断率
- compliance：审计异常、越权风险、策略违规次数

## 4. 数据存储建议

新增集合：`capability_snapshots`

推荐字段：
- `snapshotId`
- `organizationId`
- `window`（daily/weekly）
- `scores`（各维度 0-100）
- `confidence`
- `evidenceRefs`（消息、计划、日志等引用）
- `generatedAt`

## 5. 关键流程

1. 定时任务拉取多源数据（日级）
2. 指标标准化（统一口径）
3. 计算能力向量与置信度
4. 持久化快照
5. 输出对比（昨日/7日均值/30日均值）

## 6. 异常与降级

- 数据缺失：保留上次快照，并降低 `confidence`
- 指标冲突：标记 `qualityFlag=warning`，不触发自动提案
- 数据延迟：允许 T+1 计算，不做实时决策

## 7. 验收标准

- 快照成功率 >= 99%
- 指标计算可追溯（每项有 evidenceRefs）
- 关键能力维度（execution/efficiency/reliability）均可稳定输出
