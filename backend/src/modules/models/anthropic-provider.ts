import Anthropic from '@anthropic-ai/sdk';
import { BaseAIProvider } from './base-provider';
import { AIModel, ChatMessage } from '../../shared/types';

export class AnthropicProvider extends BaseAIProvider {
  private client: Anthropic;

  constructor(model: AIModel, apiKey?: string) {
    super(model, apiKey);
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(messages: ChatMessage[], options?: any): Promise<string> {
    const { systemMessages, userMessages } = this.separateMessages(messages);
    
    const response = await (this.client as any).messages.create({
      model: this.model.model,
      max_tokens: options?.maxTokens || this.model.maxTokens,
      temperature: options?.temperature || this.model.temperature || 0.7,
      system: systemMessages.join('\n'),
      messages: userMessages,
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  async streamingChat(
    messages: ChatMessage[], 
    onToken: (token: string) => void, 
    options?: any
  ): Promise<void> {
    const { systemMessages, userMessages } = this.separateMessages(messages);
    
    const stream = await (this.client as any).messages.create({
      model: this.model.model,
      max_tokens: options?.maxTokens || this.model.maxTokens,
      temperature: options?.temperature || this.model.temperature || 0.7,
      system: systemMessages.join('\n'),
      messages: userMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        onToken(chunk.delta.text);
      }
    }
  }

  private separateMessages(messages: ChatMessage[]) {
    const systemMessages: string[] = [];
    const userMessages: any[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemMessages.push(message.content);
      } else {
        userMessages.push({
          role: message.role,
          content: message.content,
        });
      }
    }

    return { systemMessages, userMessages };
  }
}