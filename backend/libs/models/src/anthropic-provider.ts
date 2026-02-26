import { fetch as undiciFetch } from 'undici';
import { AIModel, ChatMessage } from '@libs/contracts';
import { getProxyDispatcher } from '@libs/infra';
import { BaseAIProvider } from './base-provider';

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicTextBlock[];
}

export class AnthropicProvider extends BaseAIProvider {
  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
  }

  async chat(messages: ChatMessage[], options?: any): Promise<string> {
    const payload = this.buildMessagePayload(messages, options, false);
    const response = await this.requestAnthropic(payload);
    const data = (await response.json()) as AnthropicMessageResponse;

    return (data.content || [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
  }

  async streamingChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: any,
  ): Promise<void> {
    const payload = this.buildMessagePayload(messages, options, true);
    const response = await this.requestAnthropic(payload);

    if (!response.body) {
      throw new Error('Anthropic streaming response body is empty');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body as any) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const lines = event.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;

          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;

          try {
            const parsed = JSON.parse(raw) as any;
            const token = parsed?.delta?.text || parsed?.text || '';
            if (token) {
              onToken(token);
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }
    }
  }

  private buildMessagePayload(messages: ChatMessage[], options: any, stream: boolean) {
    const { systemMessages, chatMessages } = this.separateMessages(messages);

    return {
      model: this.model.model,
      max_tokens: options?.maxTokens || this.model.maxTokens || 1024,
      temperature: options?.temperature ?? this.model.temperature ?? 0.7,
      system: systemMessages.length > 0 ? systemMessages.join('\n') : undefined,
      messages: chatMessages,
      stream,
    };
  }

  private async requestAnthropic(payload: Record<string, unknown>) {
    if (!this.apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }

    const dispatcher = getProxyDispatcher();
    const response = await undiciFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      ...(dispatcher ? { dispatcher } : {}),
    } as any);

    if (!response.ok) {
      const detail = await response.text();
      let modelErrorMessage: string | null = null;

      try {
        const parsed = JSON.parse(detail) as any;
        const type = parsed?.error?.type;
        const message = parsed?.error?.message || detail;
        if (response.status === 404 && type === 'not_found_error' && String(message).includes('model')) {
          modelErrorMessage = `Anthropic 模型不可用: ${message}`;
        }
      } catch {
        // keep raw detail
      }

      if (modelErrorMessage) {
        throw new Error(modelErrorMessage);
      }

      throw new Error(`Anthropic API ${response.status}: ${detail}`);
    }

    return response;
  }

  private separateMessages(messages: ChatMessage[]) {
    const systemMessages: string[] = [];
    const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessages.push(message.content);
        continue;
      }

      if (message.role === 'assistant') {
        chatMessages.push({ role: 'assistant', content: message.content });
      } else {
        chatMessages.push({ role: 'user', content: message.content });
      }
    }

    if (chatMessages.length === 0) {
      chatMessages.push({ role: 'user', content: 'Hello' });
    }

    return { systemMessages, chatMessages };
  }
}
