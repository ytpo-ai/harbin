# Agent 执行任务时 Skill 注入内容被截断

## 1. 基本信息

- 标题：Agent 任务执行链路中的 Skill 注入被硬截断
- 日期：2026-07-09
- 负责人：opencode
- 关联 Requirement：
- 所属 Feature：[Agent Skill（技能管理与绑定）](../../feature/AGENT_SKILL.md)
- 需求管理 ID：
- OpenCode Session：
- 是否落盘（用户确认）：是

## 2. 问题现象

- 用户侧表现：Agent 执行任务时，skill system message 末尾出现“内容已截断，可通过工具查询完整版本”，后续规则未注入到模型上下文。
- 触发条件：启用的 skill 内容长度超过 `SKILL_CONTENT_MAX_INJECT_LENGTH`（默认 4000）时。
- 影响范围：`toolset-context` 的 skill 注入与强制动作模板渲染链路。
- 严重程度：中。

## 3. 根因分析

- 直接原因：`toolset-context.builder.ts` 与 `agent-executor.service.ts` 对长文本采用 `slice(0, max)` 直接截断，只保留首段内容。
- 深层原因：原实现以 token 防护为优先，没有提供“保留完整语义”的分片注入策略。
- 相关模块/文件：
  - `backend/apps/agents/src/modules/agents/context/toolset-context.builder.ts`
  - `backend/apps/agents/src/modules/agents/agent-executor.service.ts`
  - `backend/apps/agents/src/modules/agents/agent.constants.ts`

## 4. 修复动作

- 修复方案：将“硬截断”改为“按上限分片注入”，每片长度不超过 `SKILL_CONTENT_MAX_INJECT_LENGTH`，但保留完整内容。
- 代码改动点：
  - 新增 `splitTextByMaxLength` 工具函数，统一处理文本分片。
  - `ToolsetContextBuilder` 对 skill content 逐片注入多个 system message，并在标题增加 `part i/n` 标识。
  - `AgentExecutorService` 强制动作模板渲染改为先分片再拼接，避免模板正文被裁断。
  - 新增单测覆盖分片行为与无截断标记行为。
- 兼容性处理：保留现有环境变量含义，单条消息仍受长度上限控制，仅改变超长内容的处理方式。

## 5. 验证结果

- 验证步骤：
  1. 运行新增测试：`pnpm test -- apps/agents/src/modules/agents/agent.constants.spec.ts apps/agents/src/modules/agents/context/toolset-context.builder.spec.ts`
  2. 执行编译验证：`pnpm run build:agents`
- 验证结论：通过。
- 测试与检查：
  - 通过：新增 2 个测试文件共 4 条用例。
  - 备注：`agent-executor.service.spec.ts` 存在一条既有断言与当前 canonical tool id 不一致导致失败，未在本次修复范围内处理。

## 6. 风险与后续

- 已知风险：超长 skill 会拆成多条 system message，可能增加上下文 token 消耗。
- 后续优化：
  1. 按模型上下文窗口动态调整分片上限。
  2. 对低优先级段落增加可选压缩/摘要策略。
- 是否需要补充功能文档/API文档：是（已更新 feature 追溯表）。
