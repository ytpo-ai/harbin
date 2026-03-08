# Agent Runtime Hook 413 Mitigation Plan

## 背景

- 运行时出现告警：`Hook dispatch failed ... tool.completed: Request failed with status code 413`。
- 问题发生在 runtime hook 同步写入 legacy `agent-action-logs` 时，请求 payload 过大。

## 执行步骤

1. 梳理 `tool.completed` 事件的 payload 结构，确认大体积字段来源（重点是工具输出 `output`）。
2. 在 runtime action log 同步链路新增 payload 瘦身逻辑，对超大输出进行截断摘要并保留必要元信息。
3. 增加统一大小守卫，确保发送到 legacy 的最终请求体不会超过可接受阈值。
4. 保持 runtime outbox 原事件数据不变，仅压缩同步到 legacy 的副本，避免影响重放与排障。
5. 执行构建验证，确认 agents 应用编译通过且修复不引入类型错误。

## 关键影响点

- 后端：`apps/agents` 的 runtime hook dispatch / action-log sync。
- API：legacy `POST /agent-action-logs/internal/runtime-hooks` 的请求体大小。
- 可观测性：保留 `outputPreview / outputTruncated / outputSize` 等字段用于诊断。

## 风险与依赖

- 风险：截断后 legacy 侧日志将不再保存完整工具输出。
- 依赖：当前日志查询与诊断流程可接受“摘要 + 大小信息”的形式。
