import { AIModel, ChatMessage } from '@libs/contracts';

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderChatResult {
  response: string;
  usage?: ProviderUsage;
  finishReason?: string;
  cost?: number;
}

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: { type: 'json_object' | 'text' };
}

export abstract class BaseAIProvider {
  protected model: AIModel;
  protected apiKey?: string;

  constructor(model: AIModel, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey;
  }

  abstract chat(messages: ChatMessage[], options?: LLMCallOptions): Promise<string>;
  abstract streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: LLMCallOptions): Promise<void>;

  async chatWithMeta(messages: ChatMessage[], options?: LLMCallOptions): Promise<ProviderChatResult> {
    const response = await this.chat(messages, options);
    return { response };
  }

  protected formatMessages(messages: ChatMessage[]): any[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  get modelInfo(): AIModel {
    return this.model;
  }
}
