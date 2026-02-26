import OpenAI from 'openai';
import { fetch as undiciFetch } from 'undici';
import { BaseAIProvider } from './base-provider';
import { AIModel, ChatMessage } from '../../shared/types';
import { getProxyDispatcher } from '../../shared/utils/proxy.util';

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);
    const dispatcher = getProxyDispatcher();

    const clientOptions: any = {
      apiKey: apiKey || process.env.OPENAI_API_KEY,
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
    options?: any
  ): Promise<void> {
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
}
