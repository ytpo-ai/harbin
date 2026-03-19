# Agent 工具按需 Schema Grounding 开发总结

## 背景

在 Agent 工具调用链路中，默认上下文只注入工具目录（id/name/description），模型在复杂参数场景下会出现“字段名猜测 + 多轮报错修正”。
同时，将所有工具参数定义常驻注入会显著抬高上下文体积，不利于稳定执行。

## 本次实现

1. **新增工具参数契约读取能力（按需）**
   - 文件：`backend/apps/agents/src/modules/tools/tool.service.ts`
   - 新增 `getToolInputContract(toolId)`，统一从 `inputSchema` 与 `implementation.parameters` 提取工具入参契约。
   - 新增归一化逻辑：支持标准 JSON Schema 与历史 `{ field: "string" }` 形态，输出统一 `type/properties/required/additionalProperties` 结构。

2. **运行时失败后单工具 schema 修复重试**
   - 文件：`backend/apps/agents/src/modules/agents/agent-executor.service.ts`
   - 在工具失败分支识别参数类错误后，仅查询当前失败工具契约并追加修复指令。
   - 修复指令要求模型只输出新的 `<tool_call>`，避免冗余解释。
   - 默认路径仍保持轻量工具注入，不做全量 schema 常驻。

3. **内置 send-internal-message 升级为标准 JSON Schema**
   - 文件：`backend/apps/agents/src/modules/tools/builtin-tool-catalog.ts`
   - 将参数定义改为对象 schema，显式声明：
     - `required`: `receiverAgentId/title/content`
     - `additionalProperties: false`
   - 让关键必填约束直接来自工具定义。

4. **测试补充**
   - 文件：`backend/apps/agents/src/modules/tools/tool.service.spec.ts`
     - 增加“input contract 归一化”测试：覆盖标准 schema 与历史参数 map。
   - 文件：`backend/apps/agents/src/modules/agents/agent-executor.service.spec.ts`
     - 增加“参数错误识别/修复指令构造”测试。

## 验证结果

- `npm test -- apps/agents/src/modules/tools/tool.service.spec.ts apps/agents/src/modules/agents/agent-executor.service.spec.ts` 通过。
- `npm run build:agents` 通过。

## 影响与收益

- 默认上下文保持精简，减少无关工具参数信息占用。
- 参数错误场景可基于工具定义进行定向修复，降低反复试错。
- 关键工具（内部消息）的参数契约更清晰，失败模式更可预期。
