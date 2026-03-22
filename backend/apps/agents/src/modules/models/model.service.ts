import { Injectable, Logger } from '@nestjs/common';
import { AIV2Provider, AnthropicProvider, BaseAIProvider, GoogleAIProvider, MoonshotProvider, OpenAIProvider, ProviderChatResult } from '@libs/models';
import { AIModel, ChatMessage } from '../../../../../src/shared/types';
import { ModelPricingService } from './model-pricing.service';

export interface ModelChatResult {
  response: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens: number;
  };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  cost?: number;
}

@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);
  private providers = new Map<string, BaseAIProvider>();

  private normalizeFinishReason(reason: unknown): ModelChatResult['finishReason'] {
    if (typeof reason !== 'string' || !reason.trim()) {
      return undefined;
    }
    const normalized = reason.trim().toLowerCase();
    if (normalized === 'stop' || normalized === 'tool_calls' || normalized === 'length' || normalized === 'content_filter') {
      return normalized as ModelChatResult['finishReason'];
    }
    if (normalized === 'tool-calls') {
      return 'tool_calls';
    }
    return undefined;
  }

  private normalizeUsage(providerName: string, usage: ProviderChatResult['usage']): ModelChatResult['usage'] {
    if (!usage) {
      return undefined;
    }

    const inputTokens = Number(usage.inputTokens || 0);
    const outputTokens = Number(usage.outputTokens || 0);
    const reasoningTokens = Number(usage.reasoningTokens || 0) || undefined;
    const cacheRead = Number(usage.cachedInputTokens || 0) || undefined;
    const cacheWrite = Number(usage.cacheWriteTokens || 0) || undefined;

    const cacheInInputProviders = new Set(['openai', 'openrouter']);
    const includesCacheInInput = cacheInInputProviders.has(providerName.toLowerCase());
    const adjustedInputTokens = includesCacheInInput
      ? Math.max(0, inputTokens - (cacheRead || 0) - (cacheWrite || 0))
      : inputTokens;

    const totalTokens = adjustedInputTokens + outputTokens + (reasoningTokens || 0);

    return {
      inputTokens: adjustedInputTokens,
      outputTokens,
      reasoningTokens,
      cacheRead,
      cacheWrite,
      totalTokens,
    };
  }

  constructor(private readonly modelPricingService: ModelPricingService) {
    // 注册所有可用的模型提供商
  }

  ensureProvider(model: AIModel): void {
    if (!this.providers.has(model.id)) {
      this.registerProvider(model);
    }
  }

  registerProvider(model: AIModel, apiKey?: string): void {
    let provider: BaseAIProvider;
    const normalizedProvider = (model.provider || '').toLowerCase().trim();
    const useV2 = this.shouldUseAIV2Provider(model);

    if (useV2) {
      provider = new AIV2Provider(model, apiKey);
      this.providers.set(model.id, provider);
      this.logger.log(`model=${model.model} provider=${normalizedProvider} route=v2`);
      return;
    }

    switch (normalizedProvider) {
      case 'openai':
        provider = new OpenAIProvider(model, apiKey);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(model, apiKey);
        break;
      case 'google':
        provider = new GoogleAIProvider(model, apiKey);
        break;
      case 'moonshot':
      case 'kimi':
        provider = new MoonshotProvider(model, apiKey);
        break;
      default:
        provider = this.createGenericProvider(model);
        break;
    }

    this.providers.set(model.id, provider);
    this.logger.log(`model=${model.model} provider=${normalizedProvider} route=v1`);
  }

  private shouldUseAIV2Provider(model: AIModel): boolean {
    const provider = String(model.provider || '').toLowerCase().trim();
    const modelName = String(model.model || '').toLowerCase().trim();

    if (provider === 'alibaba' || provider === 'qwen') {
      return true;
    }

    const enabled = String(process.env.LLM_PROVIDER_V2_ENABLED || '').toLowerCase();
    if (!['1', 'true', 'yes', 'on'].includes(enabled)) {
      return false;
    }

    const providerAllowlist = this.parseCsvEnv('LLM_PROVIDER_V2_PROVIDERS');
    const modelAllowlist = this.parseCsvEnv('LLM_PROVIDER_V2_MODELS');

    const isProviderMatched =
      providerAllowlist.length === 0 ||
      providerAllowlist.includes('*') ||
      providerAllowlist.includes(provider);

    const isModelMatched =
      modelAllowlist.length === 0 ||
      modelAllowlist.includes('*') ||
      modelAllowlist.includes(modelName);

    return isProviderMatched && isModelMatched;
  }

  private parseCsvEnv(name: string): string[] {
    const raw = String(process.env[name] || '').trim();
    if (!raw) {
      return [];
    }

    return raw
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  ensureProviderWithKey(model: AIModel, apiKey?: string): void {
    if (apiKey) {
      this.registerProvider(model, apiKey);
      return;
    }

    if (!this.providers.has(model.id)) {
      this.registerProvider(model);
    }
  }

  private createGenericProvider(model: AIModel): BaseAIProvider {
    return new (class extends BaseAIProvider {
      async chat(messages: ChatMessage[], options?: any): Promise<string> {
        const envKey = model.provider.toLowerCase() === 'moonshot'
          ? 'MOONSHOT_API_KEY (or KIMI_API_KEY)'
          : `${model.provider.toUpperCase()}_API_KEY`;
        return `[${model.provider} - ${model.name}] API调用暂未实现。请确保已配置 ${envKey} 环境变量`;
      }
      async streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void> {
        onToken(`[${model.provider} - ${model.name}] 流式响应暂未实现`);
      }
    })(model);
  }

  getProvider(modelId: string): BaseAIProvider {
    const provider = this.providers.get(modelId);
    if (!provider) {
      throw new Error(`Provider not found for model: ${modelId}`);
    }
    return provider;
  }

  async chat(modelId: string, messages: ChatMessage[], options?: any): Promise<ModelChatResult> {
    const provider = this.getProvider(modelId);
    const result = await provider.chatWithMeta(messages, options);
    const providerName = String(provider.modelInfo.provider || '').toLowerCase();
    const usage = this.normalizeUsage(providerName, result.usage);

    let cost = typeof result.cost === 'number' && Number.isFinite(result.cost) ? result.cost : undefined;
    if (cost === undefined && usage) {
      const pricing = await this.modelPricingService.getPricing(providerName, provider.modelInfo.model);
      if (pricing) {
        cost = this.modelPricingService.calculateCost(pricing, {
          input: usage.inputTokens,
          output: usage.outputTokens,
          reasoning: usage.reasoningTokens,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
        });
      }
    }

    return {
      response: result.response,
      usage,
      finishReason: this.normalizeFinishReason(result.finishReason),
      cost,
    };
  }

  async streamingChat(
    modelId: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: any
  ): Promise<void> {
    const provider = this.getProvider(modelId);
    return provider.streamingChat(messages, onToken, options);
  }

  getAvailableModels(): AIModel[] {
    return Array.from(this.providers.values()).map(provider => provider.modelInfo);
  }

  initializeDefaultModels(): void {
    const defaultModels: AIModel[] = [
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: 'openai',
        model: 'gpt-4-turbo-preview',
        maxTokens: 4096,
        temperature: 0.7,
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        maxTokens: 64000,
        temperature: 0.7,
      },
      {
        id: 'gemini-pro',
        name: 'Gemini Pro',
        provider: 'google',
        model: 'gemini-pro',
        maxTokens: 4096,
        temperature: 0.7,
      },
    ];

    defaultModels.forEach(model => this.registerProvider(model));
  }
}
