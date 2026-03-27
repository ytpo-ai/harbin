# Orchestration runtimeTaskType 重构遗留清理 Plan

## 背景

- 评审报告与当前代码存在若干 runtimeTaskType 重构后的遗留项。
- 目标是消除死代码/死测试、修正过时断言，并补齐推断逻辑单测覆盖。

## 执行步骤

1. 移除 `orchestration-step-dispatcher.service.ts` 中对 `inferRuntimeTaskTypeFromPlanContext` 的 `typeof` 防御式分支，改为直接调用。
2. 新增 `orchestration-context-infer-tasktype.spec.ts`，覆盖 research/development/general 三类域下的 runtimeTaskType 推断与 override 保留规则。
3. 清理 `planner.service.ts` 中历史遗留的“发送邮件/外部动作”文案。
4. 删除 `task-output-validation.service.ts` 中未被引用的 `extractEmailSendProof()`。
5. 清理过时测试：删除 `task-classification.service.spec.ts`，并修复两个仍引用旧 `taskType` 字段的测试用例。

## 影响点

- 后端服务：`orchestration-step-dispatcher.service.ts`、`planner.service.ts`、`task-output-validation.service.ts`
- 测试：删除 1 个过时 spec，修复 2 个 spec，新增 1 个 spec
- 文档：补齐/重写 runtimeTaskType 路由链路 guide 文档

## 风险与依赖

- 风险较低，主要为测试兼容性风险（历史断言与当前类型定义不一致）。
- 依赖现有 `OrchestrationContextService.inferRuntimeTaskTypeFromPlanContext` 规则保持不变。
