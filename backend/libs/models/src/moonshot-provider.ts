import OpenAI from 'openai';
import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider } from './base-provider';

const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';

export class MoonshotProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor(model: AIModel, apiKey?: string) {
    const resolvedApiKey = apiKey || process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY;
    super(model, resolvedApiKey);

    const dispatcher = getProxyDispatcher();
    const clientOptions: any = {
      apiKey: resolvedApiKey,
      baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
      timeout: 15000,
      maxRetries: 0,
    };

    if (dispatcher) {
      clientOptions.fetch = (url: any, init: any) =>
        undiciFetch(url, {
          ...init,
          dispatcher,
        });
    }

    this.client = new OpenAI(clientOptions);
  }

  async chat(messages: ChatMessage[], options?: any): Promise<string> {
    this.ensureApiKey();

    const response = await this.client.chat.completions.create({
      model: this.model.model,
      messages: this.formatMessages(messages),
      max_tokens: options?.maxTokens || this.model.maxTokens,
      temperature: options?.temperature || this.model.temperature || 0.7,
      top_p: options?.topP || this.model.topP || 1,
    });

    return response.choices[0]?.message?.content || '';
  }

  async streamingChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: any,
  ): Promise<void> {
    this.ensureApiKey();

    const stream = await this.client.chat.completions.create({
      model: this.model.model,
      messages: this.formatMessages(messages),
      max_tokens: options?.maxTokens || this.model.maxTokens,
      temperature: options?.temperature || this.model.temperature || 0.7,
      top_p: options?.topP || this.model.topP || 1,
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || '';
      if (token) {
        onToken(token);
      }
    }
  }

  private ensureApiKey(): void {
    if (!this.apiKey) {
      throw new Error('Missing MOONSHOT_API_KEY (or KIMI_API_KEY)');
    }
  }
}
