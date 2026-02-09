import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseAIProvider } from './base-provider';
import { AIModel, ChatMessage } from '../../shared/types';

export class GoogleAIProvider extends BaseAIProvider {
  private client: GoogleGenerativeAI;

  constructor(model: AIModel) {
    super(model);
    this.client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  }

  async chat(messages: ChatMessage[], options?: any): Promise<string> {
    const genAI = this.client.getGenerativeModel({ 
      model: this.model.model,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.model.maxTokens,
        temperature: options?.temperature || this.model.temperature || 0.7,
        topP: options?.topP || this.model.topP || 1,
      },
    });

    const prompt = this.formatGeminiMessages(messages);
    const result = await genAI.generateContent(prompt);
    
    return result.response.text() || '';
  }

  async streamingChat(
    messages: ChatMessage[], 
    onToken: (token: string) => void, 
    options?: any
  ): Promise<void> {
    const genAI = this.client.getGenerativeModel({ 
      model: this.model.model,
      generationConfig: {
        maxOutputTokens: options?.maxTokens || this.model.maxTokens,
        temperature: options?.temperature || this.model.temperature || 0.7,
        topP: options?.topP || this.model.topP || 1,
      },
    });

    const prompt = this.formatGeminiMessages(messages);
    const result = await genAI.generateContentStream(prompt);
    
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        onToken(chunkText);
      }
    }
  }

  private formatGeminiMessages(messages: ChatMessage[]): string {
    let prompt = '';
    
    for (const message of messages) {
      if (message.role === 'system') {
        prompt += `System: ${message.content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`;
      }
    }
    
    prompt += 'Assistant: ';
    return prompt;
  }
}