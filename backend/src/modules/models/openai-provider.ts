import OpenAI from 'openai';
import { BaseAIProvider } from './base-provider';
import { AIModel, ChatMessage } from '../../shared/types';

export class OpenAIProvider extends BaseAIProvider {
  private client: OpenAI;

  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
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