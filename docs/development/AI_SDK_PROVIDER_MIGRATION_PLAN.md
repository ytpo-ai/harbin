# AI SDK Provider 渐进式迁移开发总结

## 1. 目标与范围

- 目标：在保留既有 `BaseAIProvider` 与 V1 Provider 的前提下，引入 `AIV2Provider`，支持按配置灰度切流到 Vercel AI SDK。
- 范围：后端模型调用层、模型管理字段扩展（reasoning）、前端模型管理配置项。

## 2. 实施内容

### 2.1 渐进式迁移能力

- 新增 `AIV2Provider`（Vercel AI SDK）：
  - OpenAI / Anthropic / Google 直接接入 AI SDK provider。
  - Moonshot/Kimi 通过 OpenAI 兼容 `baseURL` 接入。
- `ModelService` 增加 V1/V2 路由开关：
  - `LLM_PROVIDER_V2_ENABLED`
  - `LLM_PROVIDER_V2_PROVIDERS`
  - `LLM_PROVIDER_V2_MODELS`
- 保留原 `OpenAIProvider/AnthropicProvider/GoogleAIProvider/MoonshotProvider`，实现平滑回滚。

### 2.2 Reasoning 配置与参数治理

- 在模型管理中新增 `reasoning` 属性：
  - `enabled: boolean`
  - `effort: none|minimal|low|medium|high|xhigh`
  - `verbosity: low|medium|high`
- `AIV2Provider` 参数处理增强：
  - 对 OpenAI reasoning 模型（显式开启 reasoning 或模型前缀命中）不再传 `temperature/topP`。
  - 映射 reasoning 参数到 providerOptions：`reasoningEffort`、`textVerbosity`。

### 2.3 前端模型管理

- 模型管理页面新增 reasoning 配置 UI：
  - 开关 `enabled`
  - `effort` 下拉
  - `verbosity` 下拉
- 列表卡片中显示 reasoning 状态与配置值。

## 3. 关键文件变更

- 后端迁移与路由：
  - `backend/libs/models/src/aiv2-provider.ts`
  - `backend/libs/models/src/index.ts`
  - `backend/apps/agents/src/modules/models/model.service.ts`
  - `backend/.env.example`
- 后端模型管理与数据结构：
  - `backend/libs/contracts/src/model.types.ts`
  - `backend/apps/agents/src/schemas/model-registry.schema.ts`
  - `backend/apps/agents/src/modules/models/model-management.service.ts`
  - `backend/src/shared/schemas/agent.schema.ts`
  - `backend/apps/agents/src/modules/agents/agent.service.ts`
- 前端：
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/Models.tsx`
- 依赖与计划文档：
  - `backend/package.json`
  - `backend/pnpm-lock.yaml`
  - `docs/plan/AI_SDK_PROVIDER_MIGRATION_PLAN.md`

## 4. 验证结果

- `backend`：`pnpm run build:agents` 通过。
- `frontend`：`pnpm run build` 通过。

## 5. 灰度建议

1. 初始仅放量单一 provider（建议 `openai`）并限定模型。
2. 观察 `ModelService` 的 `route=v1/v2` 日志和失败率。
3. 稳定后逐步扩大 provider 与模型范围。
4. 若出现异常，设置 `LLM_PROVIDER_V2_ENABLED=false` 快速回滚到 V1。
