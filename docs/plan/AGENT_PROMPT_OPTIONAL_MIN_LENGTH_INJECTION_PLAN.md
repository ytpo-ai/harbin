# Agent Prompt 可选化与最小注入长度优化计划

## 需求目标

围绕 Agent Prompt 管理与运行时注入策略做三项优化：

1. 当 Agent 配置的 prompt（`systemPrompt`）长度小于 5 个字符时，不注入到 session 上下文。
2. 将 Agent 的 `systemPrompt` 字段调整为可选字段，避免编辑时强制要求输入。
3. 前端 Agent 管理中“基础信息”编辑区域，将“能力集（逗号分隔）”字段移动到“描述”字段下方。

## 执行步骤

1. 梳理 Context 组装链路，定位 Agent `systemPrompt` 注入位置，并定义统一最小长度判定口径（`trim` 后长度 >= 5 才注入）。
2. 更新后端 Identity Context Builder：对 `systemPrompt` 做最小长度过滤，避免短 prompt 进入 identity base 与 system messages。
3. 更新后端 Agent 数据模型与共享类型：将 `systemPrompt` 改为可选字段，同时保留创建流程默认 prompt 兜底能力。
4. 更新前端 Agent 类型与编辑交互：将 `systemPrompt` 设为可选，移除“Prompt 不能为空”的前端阻断校验。
5. 调整前端 Agent 编辑表单顺序：将“能力集（逗号分隔）”移动到“描述”字段后，保持其余字段行为不变。
6. 执行回归验证（前端构建/类型检查 + 后端相关测试），确认改动不影响创建、编辑与运行时上下文组装。

## 关键影响点

- 后端：`agents` 模块 Context 组装与 Agent Schema/Type 定义。
- 前端：Agent 编辑弹窗基础信息区字段顺序与必填校验。
- 运行时：session 上下文中的 system message 组成将受最小长度规则影响。
- 测试：需覆盖短 prompt 不注入、可选 prompt 仍可创建/编辑的核心路径。

## 风险与依赖

- 历史依赖 `systemPrompt` 必填的逻辑可能存在隐式假设，需逐步回归关键入口。
- 最小长度阈值变更可能影响部分依赖极短 prompt 的 Agent 行为，需要通过默认 prompt 或模板补齐能力兜底。
- 前后端类型可选化需保持一致，避免出现请求体与模型定义不一致导致的编译或运行时错误。
