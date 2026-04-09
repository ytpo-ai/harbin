# LLM 模型列表整理与价格对比展示 Plan

## 背景

当前 `AVAILABLE_MODELS` 硬编码了 46 个模型，其中大量已过时或在 `data/cache/models-pricing.json`（来自 models.dev）中无法匹配。前端模型管理页面不展示 token 价格，无法直观对比各模型成本。

## 目标

1. 清理模型列表，移除不可用模型，新增当前主流模型，确保与 pricing JSON 对齐
2. 前端模型卡片内增加价格条形柱+色阶，直观对比贵/便宜
3. 前端新增表格对比视图，支持按 input/output 价格排序

## 执行步骤

### Step 1: 更新后端 AVAILABLE_MODELS (config/models.ts)

**移除**（pricing 中不存在或已过时）：
- gpt-4-turbo（model名 `gpt-4-turbo-preview` 不匹配）
- gemini-pro、gemini-ultra
- deepseek-coder
- 全部 meta/llama（pricing 中 cost=0）
- 全部 baichuan（pricing 中无此 provider）
- 全部 xunfei（pricing 中无此 provider）
- 全部 microsoft（pricing 中无此 provider）
- moonshot-v1-8k/32k/128k/auto、kimi-k1（provider 名不匹配且为旧模型）

**新增**主流模型：
- OpenAI: gpt-5, gpt-5-mini, o3, o3-mini, o4-mini, gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
- Google: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash
- DeepSeek: deepseek-reasoner
- Alibaba: qwen-max, qwen-plus, qwen-turbo (保留)
- Moonshot: kimi-k2.5 (provider 改为 moonshotai)
- xAI: grok-4, grok-3
- MiniMax: minimax-m2.5
- Zhipu: glm-4.5 (provider 改为 zhipuai)

**保留**（pricing 可匹配）：
- gpt-4, gpt-4o, gpt-4o-mini, gpt-3.5-turbo, o1-preview, o1-mini
- claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-5, claude-sonnet-4-5
- gemini-1.5-pro, gemini-1.5-flash
- deepseek-chat
- mistral-large-latest, mistral-medium-latest, mistral-small-latest, open-mixtral-8x7b, open-mixtral-8x22b

### Step 2: 更新 MODEL_CATEGORIES + provider 联合类型

- 移除: meta, baichuan, xunfei, microsoft
- 修改: moonshot → moonshotai, zhipu → zhipuai
- 新增: xai
- 同步更新 `libs/contracts/src/model.types.ts` 和 `frontend/src/types/index.ts`

### Step 3: 后端 getAvailableModels 接口补全 cost

在 `ModelManagementService.getAvailableModels()` 中，对返回的模型如果没有 DB 中的 cost，则从 `ModelPricingService` 补全。

### Step 4: 前端卡片内价格条形柱+色阶

- 在每张模型卡片中增加 Input/Output 价格展示
- 使用水平 bar，长度按全局最大值归一化
- 色阶：绿色(便宜) → 黄色(中等) → 红色(昂贵)
- 显示具体数字（$X.XX / 1M tokens）

### Step 5: 前端表格对比视图

- 新增 卡片/表格 视图切换按钮
- 表格列：模型名、Provider、Input Price、Output Price、Cache Read、Reasoning、Max Tokens
- 支持点击列头排序（升序/降序）
- 保持 provider 筛选和搜索功能

### Step 6: 前端 provider 映射更新

- 更新 getProviderStyle/getProviderName/getProviderLogo
- 新增 xai, moonshotai, zhipuai
- 移除 meta, baichuan, xunfei, microsoft

## 影响范围

- 后端: config/models.ts, libs/contracts/src/model.types.ts, model-management.service.ts
- 前端: types/index.ts, pages/Models.tsx
- 数据库: seed 新增模型会写入 agent_model_registry（增量，不删旧数据）
