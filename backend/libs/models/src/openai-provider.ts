import OpenAI from 'openai';
import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider } from './base-provider';

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  private shouldUseMaxCompletionTokens(modelName?: string): boolean {
    const normalized = String(modelName || '').trim().toLowerCase();
    return normalized.startsWith('gpt-5');
  }

  private buildTokenLimitParams(options?: any): { max_tokens?: number; max_completion_tokens?: number } {
    const tokenLimit = Number(options?.maxTokens || this.model.maxTokens);
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) {
      return {};
    }

    if (this.shouldUseMaxCompletionTokens(this.model.model)) {
      return { max_completion_tokens: tokenLimit };
    }

    return { max_tokens: tokenLimit };
  }

  private parseEnvInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(Math.floor(parsed), max));
  }

  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);
    const dispatcher = getProxyDispatcher();
    const timeoutMs = this.parseEnvInt('OPENAI_TIMEOUT_MS', 60000, 5000, 180000);
    const maxRetries = this.parseEnvInt('OPENAI_MAX_RETRIES', 1, 0, 3);

    const clientOptions: any = {
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      timeout: timeoutMs,
      maxRetries,
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
      ...this.buildTokenLimitParams(options),
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
    const stream = await this.client.chat.completions.create({
      model: this.model.model,
      messages: this.formatMessages(messages),
      ...this.buildTokenLimitParams(options),
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
