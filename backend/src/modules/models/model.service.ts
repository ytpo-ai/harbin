import { Injectable } from '@nestjs/common';
import { BaseAIProvider } from './base-provider';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';
import { GoogleAIProvider } from './google-provider';
import { AIModel, ChatMessage } from '../../shared/types';

@Injectable()
export class ModelService {
  private providers = new Map<string, BaseAIProvider>();

  constructor() {
    // 注册所有可用的模型提供商
  }

  registerProvider(model: AIModel): void {
    let provider: BaseAIProvider;

    switch (model.provider) {
      case 'openai':
        provider = new OpenAIProvider(model);
        break;
      case 'anthropic':
        provider = new AnthropicProvider(model);
        break;
      case 'google':
        provider = new GoogleAIProvider(model);
        break;
      default:
        throw new Error(`Unsupported provider: ${model.provider}`);
    }

    this.providers.set(model.id, provider);
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
        id: 'claude-3-sonnet',
        name: 'Claude 3 Sonnet',
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 4096,
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