# Agents Prompt Context 调用链梳理计划

## 需求理解

- 用户希望明确：在 `backend/apps/agents` 中，哪些逻辑会把 `prompt`（用户口语写作 `promt`）填入执行上下文。
- 输出要求：按调用链表达，不仅列点，还要说明“写入点 -> 传递路径 -> 消费点/落库点”。
- 交付形式：沉淀为一份技术文档，便于后续排查与回归。

## 执行步骤

1. 盘点 `agents` 项目中与 `prompt/systemPrompt/taskPrompt/tool.prompt` 相关的入口与传递代码。
2. 按链路分类为：普通执行（native）、流式执行、OpenCode 执行、Orchestration 计划调用。
3. 提炼“上下文字段映射表”，明确每种 prompt 的来源、写入对象、是否进入 LLM `messages`、是否进入 runtime 持久化。
4. 绘制调用链图（Mermaid Sequence Diagram），直观展示各模块间 prompt 传递。
5. 形成技术文档并落盘到 `docs/technical/AGENTS_PROMPT_CONTEXT_CALLCHAIN.md`。

## 关键影响点

- 后端模块：`modules/agents`、`modules/tools`、`modules/opencode`、`modules/runtime`。
- 文档模块：`docs/technical`（新增文档，不改业务逻辑）。

## 风险与约束

- 术语风险：代码实际字段为 `prompt`，文档需显式注明与用户输入 `promt` 的对应关系。
- 语义风险：`orchestration` 相关 `prompt` 多为内部 API 透传，并非都进入 LLM `messages`，需单独标注避免误解。
- 范围约束：本次仅做现状梳理与文档沉淀，不改动运行逻辑。

## 交付物

- `docs/technical/AGENTS_PROMPT_CONTEXT_CALLCHAIN.md`
