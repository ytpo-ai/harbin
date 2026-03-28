import OpenAI from 'openai';
import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider, LLMCallOptions, ProviderChatResult } from './base-provider';

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  private shouldUseMaxCompletionTokens(modelName?: string): boolean {
    const normalized = String(modelName || '').trim().toLowerCase();
    return normalized.startsWith('gpt-5');
  }

  private buildTokenLimitParams(options?: LLMCallOptions): { max_tokens?: number; max_completion_tokens?: number } {
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

  private normalizeFinishReason(reason: unknown): string | undefined {
    if (typeof reason !== 'string' || !reason.trim()) {
      return undefined;
    }
    const normalized = reason.trim().toLowerCase();
    if (normalized === 'tool_calls') {
      return 'tool_calls';
    }
    if (normalized === 'stop' || normalized === 'length' || normalized === 'content_filter') {
      return normalized;
    }
    return normalized;
  }

  async chatWithMeta(messages: ChatMessage[], options?: LLMCallOptions): Promise<ProviderChatResult> {
    const response = await this.client.chat.completions.create({
      model: this.model.model,
      messages: this.formatMessages(messages),
      ...this.buildTokenLimitParams(options),
      temperature: options?.temperature || this.model.temperature || 0.7,
      top_p: options?.topP || this.model.topP || 1,
      ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
    });

    const usage = response.usage;
    const inputTokens = Number(usage?.prompt_tokens || 0);
    const outputTokens = Number(usage?.completion_tokens || 0);
    const totalTokens = Number(usage?.total_tokens || inputTokens + outputTokens);
    const reasoningTokens = Number((usage as any)?.completion_tokens_details?.reasoning_tokens || 0) || undefined;
    const cachedInputTokens = Number((usage as any)?.prompt_tokens_details?.cached_tokens || 0) || undefined;

    return {
      response: response.choices[0]?.message?.content || '',
      usage: usage
        ? {
            inputTokens,
            outputTokens,
            totalTokens,
            reasoningTokens,
            cachedInputTokens,
          }
        : undefined,
      finishReason: this.normalizeFinishReason(response.choices?.[0]?.finish_reason),
    };
  }

  async chat(messages: ChatMessage[], options?: LLMCallOptions): Promise<string> {
    const result = await this.chatWithMeta(messages, options);
    return result.response;
  }

  async streamingChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: LLMCallOptions,
  ): Promise<void> {
    const stream = await this.client.chat.completions.create({
      model: this.model.model,
      messages: this.formatMessages(messages),
      ...this.buildTokenLimitParams(options),
      temperature: options?.temperature || this.model.temperature || 0.7,
      top_p: options?.topP || this.model.topP || 1,
      ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
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
