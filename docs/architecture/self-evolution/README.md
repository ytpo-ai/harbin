# 自我进化系统架构总览

## 1. 文档目标

本文档组定义 ytpo-ai 的“自我进化”方案，重点是让系统在明确边界内持续改进，而不是无约束地自动改动。

设计原则：
- 以现有能力为基础（消息中台、编排、工具统计、HR 评估、操作日志）
- 先可观测，再可优化，再可自治
- 所有进化动作可审计、可回滚、可停机

## 2. 分层架构

自我进化采用“执行面 + 进化控制面”双平面：

- 执行面（Runtime Plane）
  - 现有业务能力：会议、协作、编排、任务、工具、HR、模型管理
  - 按当前方式对外提供服务

- 进化控制面（Evolution Control Plane）
  - L1 感知层：能力与状态感知
  - L2 目标与提案层：目标管理、差距分析、方案生成
  - L3 实验层：A/B、灰度、自动停机与回滚
  - L4 评估与治理层：价值评估、审批闸门、策略固化

闭环流程：

1. 感知（Sense）
2. 目标对齐（Align）
3. 方案生成（Propose）
4. 实验验证（Experiment）
5. 价值评估（Evaluate）
6. 治理决策（Govern）
7. 策略固化（Promote）

## 3. 与现有系统映射

可直接复用的数据与能力：
- 统一消息：`/api/messages`
- 任务编排与执行状态：`/api/orchestration/*`
- 工具执行统计：`/api/tools/executions/stats`
- 人力与团队健康：`/api/hr/*`
- 审计操作日志：`/api/operation-logs`

推荐新增模块（逻辑模块，不强制一次性建完）：
- Evolution Intent Service
- Capability Snapshot Service
- Evolution Proposal Service
- Evolution Experiment Service
- Evolution Governance Service

## 4. 文档索引

- `docs/architecture/self-evolution/01-scope-and-principles.md`
- `docs/architecture/self-evolution/02-capability-sensing-layer.md`
- `docs/architecture/self-evolution/03-goal-and-proposal-layer.md`
- `docs/architecture/self-evolution/04-experimentation-layer.md`
- `docs/architecture/self-evolution/05-evaluation-and-governance-layer.md`
- `docs/architecture/self-evolution/06-implementation-roadmap.md`
