import { AIModel, ChatMessage } from '@libs/contracts';

export abstract class BaseAIProvider {
  protected model: AIModel;
  protected apiKey?: string;

  constructor(model: AIModel, apiKey?: string) {
    this.model = model;
    this.apiKey = apiKey;
  }

  abstract chat(messages: ChatMessage[], options?: any): Promise<string>;
  abstract streamingChat(messages: ChatMessage[], onToken: (token: string) => void, options?: any): Promise<void>;

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
