# send-internal-message 入参修复回归记录

## 1. 基本信息

- 标题：AgentExecutorService 重构后，内部消息工具未在执行前按需校验参数契约，导致重复错误入参
- 日期：2026-03-19
- 负责人：OpenCode
- 关联需求/会话：用户反馈 `send-internal-message` 持续报 `requires receiverAgentId`
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：工具调用参数出现 `toAgentId/message`，执行直接失败并抛 `send_internal_message requires receiverAgentId`。
- 触发条件：Agent 在会议执行场景调用 `builtin.sys-mg.mcp.inner-message.send-internal-message`。
- 影响范围：内部消息通知链路稳定性；工具修复轮次增加，影响执行闭环时效。
- 严重程度：中

## 3. 根因分析

- 直接原因：运行时仅在工具执行失败后才给模型补充修复提示，缺少“执行前”的 schema 预检。
- 深层原因：AgentExecutorService 重构后工具详情读取从静态上下文迁移为按需注入，但未补齐 preflight 校验环节。
- 相关模块/文件：
  - `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
  - `backend/apps/agents/src/modules/agents/agent-executor.helpers.ts`

## 4. 修复动作

- 修复方案：新增工具调用 preflight 入参校验，按需读取当前工具 schema；若不匹配则不执行工具，先回填修复指令让模型重试。
- 代码改动点：
  - `agent-executor.service.ts`
    - 在 `tool_denied` 之后、`executeTool` 之前增加 `getToolInputContract + getToolInputPreflightError`。
    - preflight 失败时记录 `tool_input_preflight_failed` 并注入 `buildToolInputRepairInstruction`，跳过当轮执行。
    - 失败分支复用已有 `inputContract`，避免重复读取。
  - `agent-executor.helpers.ts`
    - `buildToolInputRepairInstruction` 增加可选 `errorReason`。
    - 新增 `getToolInputPreflightError`（required / unknown fields / type 检查）。
  - `agent-executor.service.spec.ts`
    - 补充 preflight helper 覆盖（缺必填、未知字段、合法参数）。
- 兼容性处理：不改变工具业务语义，仅新增执行前校验与修复提示，不引入参数别名映射。

## 5. 验证结果

- 验证步骤：
  - `npm test -- apps/agents/src/modules/agents/agent-executor.service.spec.ts`
  - `npm run build:agents`
- 验证结论：通过
- 测试与检查：定向单测通过，agents 构建通过。

## 6. 风险与后续

- 已知风险：若历史工具 schema 不完整（无 required），preflight 只能做有限约束。
- 后续优化：可引入 schema 质量巡检，统一补齐关键工具 `required` 字段。
- 是否需要补充功能文档/API文档：否（接口未变化，属于运行时修复）。
