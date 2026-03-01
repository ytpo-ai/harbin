# 分层 4：实验层（Experimentation）

## 1. 分层职责

对提案进行受控验证，避免“直接上线式进化”。

## 2. 实验对象

优先支持三类低耦合实验：
- 任务分派策略（agent/human 选择逻辑）
- 工具调用策略（工具优先级、兜底策略）
- 协作策略（串行/并行/混合模式选择）

## 3. 实验模型

新增集合：`evolution_experiments`

推荐字段：
- `experimentId`
- `proposalId`
- `variants`（A 基线 / B 新方案）
- `trafficPolicy`（比例、分桶规则）
- `metrics`（主指标、护栏指标）
- `startAt` / `endAt`
- `status`（pending/running/stopped/completed/rolled_back）
- `result`

## 4. 实验流程

1. 创建实验（绑定提案）
2. 预检查（数据可用、风险评级、审批）
3. 小流量启动（如 5%-10%）
4. 周期评估（小时级或日级）
5. 达标扩大 / 触线停机 / 回滚
6. 产出实验报告

## 5. 统计与决策规则

最小规则：
- 主指标提升且护栏无显著恶化才允许推广
- 样本不足只允许延长观察，不允许直接宣告成功
- 任一硬护栏触发（稳定性/安全/合规）立即停机

可选规则（后续增强）：
- Sequential Test / Bayesian Test
- CUPED 等方差缩减方法

## 6. 自动护栏（Guardrails）

建议默认护栏：
- `failed_plan_ratio` 不高于基线 + 5%
- `cost_per_completed_task` 不高于基线 + 10%
- `p95_latency` 不高于基线 + 15%
- 审计异常数不高于基线

## 7. 验收标准

- 实验全链路可追踪（创建、运行、停机、回滚）
- 停机与回滚自动化可用
- 实验报告可直接用于治理审批
