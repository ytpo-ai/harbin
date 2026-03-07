# LLM Provider 渐进式迁移到 Vercel AI SDK Plan

## 背景与目标

- 目标：在不删除既有 `BaseAIProvider` 和旧 Provider 的前提下，引入 `AIV2Provider`，通过开关灰度切流到 Vercel AI SDK，降低迁移风险。
- 范围：仅后端 provider 调用层和依赖配置，不改业务编排、模型注册和既有接口。

## 执行步骤

1. 梳理现有 provider 能力与参数映射（chat/streaming/maxTokens/temperature/topP/系统消息）。
2. 新增 AI SDK 依赖并更新 lockfile，确保 Nest 后端可编译。
3. 新增 `AIV2Provider`（内部按 provider 分流到 `@ai-sdk/openai/@ai-sdk/anthropic/@ai-sdk/google`，moonshot 使用 OpenAI 兼容 baseURL）。
4. 保留原 `OpenAIProvider/AnthropicProvider/GoogleAIProvider/MoonshotProvider` 实现，不做替换。
5. 在 `ModelService` 新增灰度路由开关（环境变量），按 provider/model 维度选择 V1 或 V2。
6. 增加切流日志（命中 V1/V2、provider、model），便于逐步放量与回滚。
7. 运行基础验证（至少 `build:agents`），修复迁移引入的类型或编译问题。
8. 更新相关文档说明（plan 与配置样例），输出灰度放量建议。

## 本轮补充：Reasoning 参数治理

1. 在模型管理中新增 `reasoning` 显式配置（包含 `enabled/effort/verbosity`）。
2. 在模型注册 Schema 与读写映射中持久化 `reasoning` 字段。
3. 在 AIV2 业务逻辑中实现 reasoning 参数分流：reasoning 模型不再透传 `temperature/topP`。
4. 对 OpenAI reasoning 模型增加 providerOptions 映射（如 `reasoningEffort`、`textVerbosity`）。
5. 更新 Agent 侧 `modelConfig` 组装逻辑，确保运行时能读取并应用模型的 `reasoning` 配置。

## 本轮补充：V1 Provider 目录归档

1. 新建 `backend/libs/models/src/v1/`，归档旧 Provider 实现。
2. 将 `base-provider.ts`、`openai-provider.ts`、`anthropic-provider.ts`、`google-provider.ts`、`moonshot-provider.ts` 迁移到 `v1/`。
3. 更新 `index.ts` 导出路径，保持 `@libs/models` 外部导入 API 不变。
4. 执行 `build:agents` 验证目录重构不影响运行。

## 关键影响点

- 后端：`backend/libs/models/src/aiv2-provider.ts`、`backend/apps/agents/src/modules/models/model.service.ts`
- 兼容层：`backend/libs/models/src/*-provider.ts`（保留）
- 依赖：`backend/package.json`、`backend/pnpm-lock.yaml`
- 运行配置：新增 V2 灰度开关 + API Key 环境变量兼容（OPENAI/ANTHROPIC/GOOGLE/MOONSHOT）
- 测试/构建：`backend` 编译链路（agents app）

## 风险与依赖

- Moonshot 官方 AI SDK provider 可用性不确定，V2 采用 OpenAI 兼容 provider + baseURL 方式。
- AI SDK 版本差异可能导致 `streamText` 返回结构变化，需要按当前版本类型适配。
- 代理转发（`getProxyDispatcher`）与 AI SDK fetch 注入兼容性需重点验证。
- 灰度阶段需避免一次性全量切换，先 provider 级小流量验证后再扩容。
