# CODE_DOCS_MCP 开发总结

## 背景与目标

本次迭代目标是将“可读取仓库 docs”升级为可在 CTO 问答中稳定使用的 `code-docs-mcp` 能力，确保对于“当前系统实现了哪些核心功能”类问题，回答可追溯、可验证，且避免泛化臆测。

## 关键实现

1. 新增内置工具 `code-docs-mcp`
   - 在 tools 模块注册并可执行。
   - 入参支持 `query/focus/maxFeatures/maxEvidencePerFeature`。
   - 输出包含 `coreFeatures`、`analyzedFiles`、`unknownBoundary`。

2. 新增 docs 功能抽取与聚合逻辑
   - 从 `README.md`、`docs/features/FUNCTIONS.md` 等文档提取候选功能。
   - 聚合为核心能力分组，并携带证据路径与行号。

3. CTO 侧能力控制与提示约束
   - 仅 CTO 默认具备 `code-docs-mcp`。
   - 非 CTO 默认移除该工具。
   - 提示词约束要求基于证据路径回答，并声明未知边界。

4. 后端硬触发（关键修复）
   - 对“核心功能盘点”意图增加后端识别。
   - 命中后先强制调用 `code-docs-mcp`，再格式化输出。
   - 避免模型跳过工具直接口播泛化内容。

5. OpenAI 超时稳定性修复
   - 将超时与重试改为环境变量可配置：
     - `OPENAI_TIMEOUT_MS`（默认 60000）
     - `OPENAI_MAX_RETRIES`（默认 1）
   - Agent 执行链路识别超时并输出兜底文案，避免直接异常中断。

## 影响文件

- `backend/apps/agents/src/modules/tools/tool.service.ts`
- `backend/apps/agents/src/modules/tools/code-docs-mcp.util.ts`
- `backend/apps/agents/src/modules/agents/agent.service.ts`
- `backend/libs/models/src/openai-provider.ts`
- `docs/plan/CODE_DOCS_MCP_PLAN.md`
- `docs/features/FUNCTIONS.md`
- `docs/api/API.md`
- `README.md`
- `backend/.env.example`

## 验证结果

- `npm run build:agents` 通过。
- 关键运行日志可见：`Forced tool call triggered: code-docs-mcp`。

## 结论

`code-docs-mcp` 已具备“可调用 + 可控 + 可追溯 + 可兜底”的闭环能力，能够支撑 CTO 在核心功能问答场景中稳定返回基于 docs 证据的答案。
