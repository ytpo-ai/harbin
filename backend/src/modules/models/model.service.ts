import { Injectable } from '@nestjs/common';
import { AnthropicProvider, BaseAIProvider, GoogleAIProvider, MoonshotProvider, OpenAIProvider } from '@libs/models';
import { AIModel, ChatMessage } from '../../shared/types';

@Injectable()
export class ModelService {
  private providers = new Map<string, BaseAIProvider>();

  constructor() {
    // 注册所有可用的模型提供商
  }

  ensureProvider(model: AIModel): void {
    if (!this.providers.has(model.id)) {
      this.registerProvider(model);
    }
  }

  registerProvider(model: AIModel, apiKey?: string): void {
    let provider: BaseAIProvider;

    switch (model.provider) {
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
        provider = new MoonshotProvider(model, apiKey);
        break;
      default:
        // 对于不直接支持的提供商，使用通用的API调用方式
        provider = this.createGenericProvider(model);
        break;
    }

    this.providers.set(model.id, provider);
  }

  ensureProviderWithKey(model: AIModel, apiKey?: string): void {
    if (apiKey) {
      // Always override current provider for this model with the supplied key.
      this.registerProvider(model, apiKey);
      return;
    }

    if (!this.providers.has(model.id)) {
      this.registerProvider(model);
    }
  }

  private createGenericProvider(model: AIModel): BaseAIProvider {
    // 创建一个通用的provider，使用axios直接调用API
    return new (class extends BaseAIProvider {
      async chat(messages: ChatMessage[], options?: any): Promise<string> {
        return `[${model.provider} - ${model.name}] API调用暂未实现。请确保已配置 ${model.provider.toUpperCase()}_API_KEY 环境变量`;
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

  async chat(modelId: string, messages: ChatMessage[], options?: any): Promise<string> {
    const provider = this.getProvider(modelId);
    return provider.chat(messages, options);
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
